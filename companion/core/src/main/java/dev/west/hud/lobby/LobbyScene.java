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

    /** Kaç blok dolu (testler ve günlük için) */
    public int count() {
        int n = 0;
        for (short s : data) if (s != 0) n++;
        return n;
    }
}
