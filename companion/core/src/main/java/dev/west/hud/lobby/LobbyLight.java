package dev.west.hud.lobby;

import java.util.ArrayDeque;

import static dev.west.hud.lobby.LobbyScene.*;

/**
 * Sahnenin ışığı: oyundaki gibi gökyüzü ışığı (yukarıdan iner, yana yayılırken azalır) ve
 * blok ışığı (meşale, fener, lav, ışık taşı… çevresine yayılır). Değerler 0–15.
 */
public final class LobbyLight {
    private final byte[] sky, block;

    private LobbyLight(byte[] sky, byte[] block) {
        this.sky = sky;
        this.block = block;
    }

    private static int at(int x, int y, int z) {
        return ((x - MIN_X) * SZ + (z - MIN_Z)) * SY + (y - MIN_Y);
    }

    public int sky(int x, int y, int z) {
        if (y > MAX_Y) return 15;
        if (!inside(x, y, z)) return inside(clampX(x), y, clampZ(z)) ? sky(clampX(x), y, clampZ(z)) : 15;
        return sky[at(x, y, z)];
    }

    public int block(int x, int y, int z) {
        if (!inside(x, y, z)) return 0;
        return block[at(x, y, z)];
    }

    private static int clampX(int x) {
        return Math.max(MIN_X, Math.min(MAX_X, x));
    }

    private static int clampZ(int z) {
        return Math.max(MIN_Z, Math.min(MAX_Z, z));
    }

    /**
     * @param emission  palet sırasına göre bloğun yaydığı ışık (0–15)
     * @param dampening palet sırasına göre bloğun ışığı ne kadar kestiği (hava 0, yaprak 1, dolu blok 15)
     */
    public static LobbyLight compute(LobbyScene s, int[] emission, int[] dampening) {
        int n = SX * SY * SZ;
        byte[] sky = new byte[n], block = new byte[n];
        ArrayDeque<int[]> q = new ArrayDeque<>();
        // Gökyüzü: her sütunda yukarıdan aşağı, kesilene dek 15
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int light = 15;
                for (int y = MAX_Y; y >= MIN_Y && light > 0; y--) {
                    int d = dampening[s.id(x, y, z)];
                    if (d > 0) light = Math.max(0, light - Math.max(1, d));
                    if (light <= 0) break;
                    sky[at(x, y, z)] = (byte) light;
                    q.add(new int[] { x, y, z });
                }
            }
        spread(s, sky, q, dampening);
        // Blok ışığı
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++)
                for (int y = MIN_Y; y <= MAX_Y; y++) {
                    int e = emission[s.id(x, y, z)];
                    if (e <= 0) continue;
                    block[at(x, y, z)] = (byte) e;
                    q.add(new int[] { x, y, z });
                }
        spread(s, block, q, dampening);
        return new LobbyLight(sky, block);
    }

    private static final int[][] DIRS = { { 1, 0, 0 }, { -1, 0, 0 }, { 0, 1, 0 }, { 0, -1, 0 }, { 0, 0, 1 }, { 0, 0, -1 } };

    private static void spread(LobbyScene s, byte[] light, ArrayDeque<int[]> q, int[] dampening) {
        while (!q.isEmpty()) {
            int[] p = q.poll();
            int l = light[at(p[0], p[1], p[2])];
            if (l <= 1) continue;
            for (int[] d : DIRS) {
                int x = p[0] + d[0], y = p[1] + d[1], z = p[2] + d[2];
                if (!inside(x, y, z)) continue;
                int damp = dampening[s.id(x, y, z)];
                if (damp >= 15) continue;
                int nl = l - Math.max(1, damp);
                int i = at(x, y, z);
                if (nl > light[i]) {
                    light[i] = (byte) nl;
                    q.add(new int[] { x, y, z });
                }
            }
        }
    }
}
