package dev.west.hud.lobby;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Lobinin küçük dünyası: sabit boyutlu bir blok ızgarası. Bloklar Minecraft blok durumu
 * dizesi olarak tutulur ("minecraft:spruce_leaves[persistent=true]"); sürüm adaptörü bunları
 * gerçek blok durumlarına çevirip oyunun kendi blok çizicisiyle çizer.
 * x sağa, y yukarı, z kameraya doğru (güney). Karakterler (0, GROUND+1, 0) çevresinde durur.
 */
public final class LobbyScene {
    public static final int MIN_X = -44, MAX_X = 44, MIN_Z = -52, MAX_Z = 16, MIN_Y = 0, MAX_Y = 34;
    public static final int SX = MAX_X - MIN_X + 1, SY = MAX_Y - MIN_Y + 1, SZ = MAX_Z - MIN_Z + 1;
    /** Karakterlerin durduğu zeminin üst bloğunun y'si */
    public static final int GROUND = 6;

    public final LobbyBiome biome;
    private final List<String> palette = new ArrayList<>();
    private final Map<String, Integer> index = new HashMap<>();
    private final short[] data = new short[SX * SY * SZ];

    LobbyScene(LobbyBiome biome) {
        this.biome = biome;
        palette.add("minecraft:air");
        index.put("minecraft:air", 0);
    }

    public static boolean inside(int x, int y, int z) {
        return x >= MIN_X && x <= MAX_X && y >= MIN_Y && y <= MAX_Y && z >= MIN_Z && z <= MAX_Z;
    }

    private static int at(int x, int y, int z) {
        return ((x - MIN_X) * SZ + (z - MIN_Z)) * SY + (y - MIN_Y);
    }

    public void set(int x, int y, int z, String block) {
        if (!inside(x, y, z)) return;
        if (!block.contains(":")) block = "minecraft:" + block;
        Integer i = index.get(block);
        if (i == null) {
            i = palette.size();
            palette.add(block);
            index.put(block, i);
        }
        data[at(x, y, z)] = (short) (int) i;
    }

    /** Yalnızca boşsa koy (dekorasyonlar başka şeyin üstüne yazmasın) */
    public void setIfAir(int x, int y, int z, String block) {
        if (inside(x, y, z) && data[at(x, y, z)] == 0) set(x, y, z, block);
    }

    /** Palet sırası (0 = hava) */
    public int id(int x, int y, int z) {
        return inside(x, y, z) ? data[at(x, y, z)] : 0;
    }

    public String get(int x, int y, int z) {
        return palette.get(id(x, y, z));
    }

    public boolean air(int x, int y, int z) {
        return id(x, y, z) == 0;
    }

    public List<String> palette() {
        return palette;
    }

    /** Bu sütundaki en üst dolu bloğun y'si (yoksa MIN_Y - 1) */
    public int top(int x, int z) {
        for (int y = MAX_Y; y >= MIN_Y; y--) if (!air(x, y, z)) return y;
        return MIN_Y - 1;
    }

    private List<float[]> lights;

    /**
     * Sahnedeki ışık kaynakları (fener, meşale, kamp ateşi, lav…): her biri {x, y, z, r, g, b, yarıçap, titreme}
     * (merkez dünya koordinatında, renk 0–1). Parıltı efekti için; ilk istekte bir kez hesaplanır.
     */
    public synchronized List<float[]> lights() {
        if (lights != null) return lights;
        List<float[]> out = new ArrayList<>();
        float[][] kind = new float[palette.size()][];
        for (int i = 1; i < palette.size(); i++) kind[i] = lightOf(palette.get(i));
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++)
                for (int y = MIN_Y; y <= MAX_Y; y++) {
                    float[] k = kind[data[at(x, y, z)]];
                    if (k == null) continue;
                    // Lav göllerinde her bloğa değil, seyrek noktalara parıltı
                    if (k[5] < 0 && ((x * 31 + z * 17) & 7) != 0) continue;
                    if (k[5] < 0 && !air(x, y + 1, z)) continue;
                    out.add(new float[] { x + 0.5f, y + k[6], z + 0.5f, k[0], k[1], k[2], k[3], Math.abs(k[4]) });
                }
        return lights = out;
    }

    /** {r, g, b, yarıçap, titreme, lav mı (-1), merkez yüksekliği} */
    private static float[] lightOf(String b) {
        String n = b.substring(b.indexOf(':') + 1);
        int br = n.indexOf('[');
        String id = br < 0 ? n : n.substring(0, br);
        if (id.equals("campfire")) return b.contains("lit=false") ? null : new float[] { 1f, 0.62f, 0.26f, 3.4f, 1f, 0, 0.45f };
        if (id.equals("soul_campfire")) return new float[] { 0.35f, 0.85f, 1f, 3.0f, 1f, 0, 0.45f };
        if (id.equals("soul_lantern") || id.equals("soul_torch") || id.equals("soul_wall_torch")) return new float[] { 0.4f, 0.85f, 1f, 2.0f, 0.4f, 0, 0.45f };
        if (id.equals("lantern")) return new float[] { 1f, 0.72f, 0.36f, 2.4f, 0.35f, 0, 0.4f };
        if (id.equals("torch") || id.equals("wall_torch")) return new float[] { 1f, 0.7f, 0.32f, 2.0f, 0.6f, 0, 0.7f };
        if (id.equals("lava")) return new float[] { 1f, 0.42f, 0.12f, 3.2f, 0.25f, -1, 0.9f };
        if (id.equals("magma_block")) return new float[] { 1f, 0.35f, 0.1f, 1.4f, 0.2f, -1, 1f };
        if (id.equals("glowstone")) return new float[] { 1f, 0.86f, 0.5f, 2.6f, 0.05f, 0, 0.5f };
        if (id.equals("shroomlight")) return new float[] { 1f, 0.66f, 0.34f, 2.4f, 0.05f, 0, 0.5f };
        if (id.equals("sea_lantern")) return new float[] { 0.7f, 0.95f, 1f, 2.4f, 0.05f, 0, 0.5f };
        if (id.equals("end_rod")) return new float[] { 0.95f, 0.85f, 1f, 2.0f, 0.15f, 0, 0.5f };
        if (id.equals("jack_o_lantern")) return new float[] { 1f, 0.62f, 0.2f, 2.2f, 0.4f, 0, 0.5f };
        if (id.endsWith("froglight")) return new float[] { 0.9f, 1f, 0.7f, 2.2f, 0.05f, 0, 0.5f };
        if (id.equals("crying_obsidian")) return new float[] { 0.6f, 0.25f, 1f, 1.2f, 0.3f, 0, 0.5f };
        return null;
    }

    /** Görüş hattı ışık kaynağına kadar katı bloklarla kesiliyor mu (0 açık … 1 tamamen kapalı) */
    public float occlusion(float ex, float ey, float ez, float lx, float ly, float lz) {
        float dx = lx - ex, dy = ly - ey, dz = lz - ez;
        float len = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
        int steps = Math.min(90, (int) (len * 2.2f));
        float occ = 0;
        for (int i = 2; i < steps - 2; i++) {
            float t = (float) i / steps;
            int x = (int) Math.floor(ex + dx * t), y = (int) Math.floor(ey + dy * t), z = (int) Math.floor(ez + dz * t);
            int id = id(x, y, z);
            if (id == 0) continue;
            String b = palette.get(id);
            if (b.contains("leaves")) occ += 0.22f;
            else if (b.contains("grass") || b.contains("fern") || b.contains("flower") || b.contains("bush") || b.contains("fence") || b.contains("snow[")
                    || b.contains("lantern") || b.contains("torch") || b.contains("campfire")) continue;
            else return 1;
            if (occ >= 1) return 1;
        }
        return occ;
    }

    /** Kaç blok dolu (testler ve günlük için) */
    public int count() {
        int n = 0;
        for (short s : data) if (s != 0) n++;
        return n;
    }
}
