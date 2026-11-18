package dev.west.hud.lobby;

import java.util.Random;

import static dev.west.hud.lobby.LobbyScene.*;

/**
 * Biyom sahnelerini üretir. Sahneler sabit tohumla üretilir: herkes aynı biyomda aynı dünyayı görür.
 * Kural: karakterlerin durduğu alan (x -9…9, z -5…7) düz ve boş; kameranın baktığı ön taraf (z > 2)
 * alçak kalır (yalnızca çiçek, ot, kar gibi şeyler), yüksek ağaç ve yapılar arkada ve yanlarda.
 */
public final class SceneGen {
    private SceneGen() {}

    private static final java.util.Map<LobbyBiome, LobbyScene> CACHE = new java.util.EnumMap<>(LobbyBiome.class);

    /** Önbellekli sahne (aynı biyom her seferinde yeniden üretilmez) */
    public static synchronized LobbyScene cached(LobbyBiome b) {
        return CACHE.computeIfAbsent(b, SceneGen::generate);
    }

    /** Lobi kapanınca sahneleri bellekten bırak */
    public static synchronized void clearCache() {
        CACHE.clear();
    }

    public static LobbyScene generate(LobbyBiome b) {
        LobbyScene s = new LobbyScene(b);
        Random r = new Random(0x5EED_0000L + b.ordinal() * 7919L);
        switch (b) {
            case FOREST -> forest(s, r);
            case SNOWY -> snowy(s, r);
            case BADLANDS -> badlands(s, r);
            case DESERT -> desert(s, r);
            case CHERRY -> cherry(s, r);
            case END -> end(s, r);
            case NETHER -> nether(s, r);
        }
        return s;
    }

    // ───────── Ortak yardımcılar ─────────

    /** 0: karakter alanının içi (tamamen düz), 1: alandan uzak */
    static double open(int x, int z) {
        double dx = Math.max(0, Math.abs(x) - 9), dz = z < -5 ? -5 - z : z > 7 ? z - 7 : 0;
        double d = Math.sqrt(dx * dx + dz * dz);
        return Math.min(1, d / 9.0);
    }

    /** Yüksek şeyler (ağaç, kule) buraya konmaz: karakterlerin çevresi ve kameranın görüş hattı */
    static boolean keepLow(int x, int z, int margin) {
        if (Math.abs(x) <= 12 + margin && z >= -8 - margin) return true;
        return z >= 1 - margin && Math.abs(x) <= 30 + margin;
    }

    private static double hash(int x, int z, long seed) {
        long h = seed ^ (x * 0x9E3779B97F4A7C15L) ^ (z * 0xC2B2AE3D27D4EB4FL);
        h ^= h >>> 31;
        h *= 0xBF58476D1CE4E5B9L;
        h ^= h >>> 29;
        return (h & 0xFFFFFF) / (double) 0xFFFFFF;
    }

    /** Pürüzsüz değer gürültüsü (0–1) */
    static double noise(double x, double z, long seed) {
        int x0 = (int) Math.floor(x), z0 = (int) Math.floor(z);
        double fx = x - x0, fz = z - z0;
        fx = fx * fx * (3 - 2 * fx);
        fz = fz * fz * (3 - 2 * fz);
        double a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed), c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
        return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
    }

    static double fbm(double x, double z, long seed) {
        return noise(x / 16, z / 16, seed) * 0.55 + noise(x / 7, z / 7, seed + 1) * 0.3 + noise(x / 3, z / 3, seed + 2) * 0.15;
    }

    /** Arazi yüksekliği: karakter alanında GROUND, uzaklaştıkça tepeler (arkada daha yüksek) */
    static int height(int x, int z, long seed, double relief) {
        double o = open(x, z);
        double back = z < -10 ? Math.min(1.6, 1 + (-10 - z) / 30.0) : 1;
        double n = fbm(x, z, seed) - 0.38;
        int h = GROUND + (int) Math.round(o * Math.max(-1, n * relief * back));
        return Math.max(2, h);
    }

    private static void column(LobbyScene s, int x, int z, int h, String top, String sub, String deep) {
        for (int y = 1; y <= h; y++) s.set(x, y, z, y == h ? top : y >= h - 3 ? sub : deep);
    }

    private static String pick(Random r, String... a) {
        return a[r.nextInt(a.length)];
    }

    /** Karakter alanında ve görüş hattında olmayan rastgele bir nokta */
    private static int[] spot(Random r, int margin, boolean wide) {
        for (int i = 0; i < 200; i++) {
            int x = MIN_X + 2 + r.nextInt(SX - 4);
            int z = MIN_Z + 2 + r.nextInt(wide ? SZ - 4 : (SZ - 4) / 2 + 10);
            if (!keepLow(x, z, margin)) return new int[] { x, z };
        }
        return new int[] { MIN_X + 3, MIN_Z + 3 };
    }

    private static boolean near(int[][] list, int n, int x, int z, int dist) {
        for (int i = 0; i < n; i++) {
            int dx = list[i][0] - x, dz = list[i][1] - z;
            if (dx * dx + dz * dz < dist * dist) return true;
        }
        return false;
    }

    // ───────── Gece ormanı ─────────

    private static void forest(LobbyScene s, Random r) {
        long seed = 91;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int h = height(x, z, seed, 7);
                column(s, x, z, h, "grass_block[snowy=false]", "dirt", "stone");
            }
        // Dere: karakterlerin arkasından yatay geçer, solda öne kıvrılır
        for (int x = MIN_X; x <= MAX_X; x++) {
            double cz = (x < 0 ? -7.6 : -7.6 - x * 0.6) + Math.sin(x * 0.21) * 0.8;
            if (x < -9) cz += (-9 - x) * 0.85;
            double w = 1.3 + Math.sin(x * 0.17 + 1) * 0.4;
            for (int z = (int) Math.floor(cz - w - 1); z <= cz + w + 1; z++) {
                if (z < MIN_Z || z > MAX_Z) continue;
                double d = Math.abs(z - cz);
                if (d > w + 0.5) continue;
                if (x >= 2 && x <= 7 && z >= -8) continue;
                int top = s.top(x, z);
                for (int y = GROUND; y <= top; y++) s.set(x, y, z, "air");
                s.set(x, GROUND - 1, z, d < w - 0.6 ? "gravel" : "dirt");
                s.set(x, GROUND, z, "water");
                if (d > w - 0.2 && r.nextInt(5) == 0) s.set(x, GROUND, z, "mossy_cobblestone");
            }
        }
        // Karakterlerle dere arasını düzle: dere ön plandan görünsün
        for (int x = -16; x <= 16; x++)
            for (int z = -9; z <= -1; z++) {
                if (s.get(x, GROUND, z).contains("water")) continue;
                int top = s.top(x, z);
                if (top <= GROUND) continue;
                for (int y = GROUND + 1; y <= top; y++) s.set(x, y, z, "air");
                s.set(x, GROUND, z, "grass_block[snowy=false]");
            }
        // Ağaçlar: meşe, huş, koyu meşe — arkada ve yanlarda
        int[][] trees = new int[70][];
        int n = 0;
        for (int i = 0; i < 500 && n < trees.length; i++) {
            int[] p = spot(r, 2, true);
            if (near(trees, n, p[0], p[1], 5)) continue;
            int y = s.top(p[0], p[1]);
            if (!s.get(p[0], y, p[1]).startsWith("minecraft:grass_block")) continue;
            trees[n++] = p;
            int k = r.nextInt(10);
            if (k < 4) roundTree(s, r, p[0], y, p[1], "birch_log[axis=y]", "birch_leaves[persistent=true]", 5 + r.nextInt(3), 2.4);
            else if (k < 8) roundTree(s, r, p[0], y, p[1], "oak_log[axis=y]", "oak_leaves[persistent=true]", 4 + r.nextInt(3), 2.8);
            else roundTree(s, r, p[0], y, p[1], "dark_oak_log[axis=y]", "dark_oak_leaves[persistent=true]", 6 + r.nextInt(3), 3.4);
        }
        // Yerde çiçek, ot, eğrelti
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int y = s.top(x, z);
                if (!s.get(x, y, z).startsWith("minecraft:grass_block")) continue;
                if (Math.abs(x) <= 3 && z >= -2 && z <= 3) continue;
                double k = r.nextDouble();
                if (k < 0.16) s.set(x, y + 1, z, "short_grass");
                else if (k < 0.19) s.set(x, y + 1, z, "fern");
                else if (k < 0.215) s.set(x, y + 1, z, pick(r, "poppy", "dandelion", "poppy", "cornflower"));
                else if (k < 0.225) {
                    s.set(x, y + 1, z, "tall_grass[half=lower]");
                    s.set(x, y + 2, z, "tall_grass[half=upper]");
                }
            }
        // Kamp ateşi ve oturma kütükleri: liderin arkasında, biraz sağda (örnekteki gibi görünür yerde)
        // Zemini kamp alanında düzle (tepeler ateşi gömmesin)
        for (int x = 2; x <= 7; x++)
            for (int z = -9; z <= -4; z++) {
                for (int y = GROUND + 1; y <= GROUND + 8; y++) s.set(x, y, z, "air");
                if (!s.get(x, GROUND, z).contains("water")) s.set(x, GROUND, z, "grass_block[snowy=false]");
            }
        int g = GROUND + 1;
        s.set(4, g, -6, "campfire[lit=true,facing=south]");
        s.set(6, g, -6, "oak_log[axis=z]");
        s.set(6, g, -7, "oak_log[axis=z]");
        s.set(3, g, -8, "oak_log[axis=x]");
        s.set(4, g, -8, "oak_log[axis=x]");
        // Çit üstünde fenerler
        int[][] posts = { { 9, -7 }, { -9, -4 }, { 11, 2 }, { -12, 5 }, { 16, -14 } };
        for (int[] p : posts) {
            int y = s.top(p[0], p[1]);
            String b = s.get(p[0], y, p[1]);
            if (!b.startsWith("minecraft:grass_block") && !b.startsWith("minecraft:dirt")) {
                s.set(p[0], y, p[1], "air");
                y = s.top(p[0], p[1]);
            }
            if (s.get(p[0], y, p[1]).contains("water")) continue;
            s.set(p[0], y + 1, p[1], "oak_fence");
            s.set(p[0], y + 2, p[1], "oak_fence");
            s.set(p[0], y + 3, p[1], "lantern");
        }
    }

    /** Dikdörtgen alanı zemin üstünden temizler (bitkileri kaldırır) */
    private static void clear(LobbyScene s, int x0, int x1, int z0, int z1) {
        for (int x = x0; x <= x1; x++)
            for (int z = z0; z <= z1; z++)
                for (int y = GROUND + 1; y <= GROUND + 3; y++) s.set(x, y, z, "air");
    }

    private static void roundTree(LobbyScene s, Random r, int x, int ground, int z, String log, String leaves, int h, double rad) {
        for (int y = 1; y <= h; y++) s.set(x, ground + y, z, log);
        int cy = ground + h;
        int ri = (int) Math.ceil(rad);
        for (int dx = -ri; dx <= ri; dx++)
            for (int dy = -2; dy <= 2; dy++)
                for (int dz = -ri; dz <= ri; dz++) {
                    double d = dx * dx + dz * dz + dy * dy * 1.8 + (dy > 0 ? dy * 1.5 : 0);
                    if (d > rad * rad + r.nextDouble() * 1.2) continue;
                    s.setIfAir(x + dx, cy + dy, z + dz, leaves);
                }
    }

    // ───────── Karlı ─────────

    private static void snowy(LobbyScene s, Random r) {
        long seed = 11;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int h = height(x, z, seed, 9);
                boolean stone = h > GROUND + 4 && noise(x / 4.0, z / 4.0, 5) > 0.62;
                column(s, x, z, h, stone ? "stone" : "grass_block[snowy=true]", stone ? "stone" : "dirt", "stone");
                if (!stone || noise(x / 3.0, z / 3.0, 6) > 0.4) s.set(x, h + 1, z, "snow[layers=" + (noise(x / 5.0, z / 5.0, 8) > 0.6 ? 2 : 1) + "]");
            }
        // Donmuş gölet (sol önde, karakterlerin yanında düz)
        for (int x = -24; x <= -11; x++)
            for (int z = -6; z <= 9; z++) {
                double dx = (x + 17.5) / 7.5, dz = (z - 1.5) / 8.5;
                double d = dx * dx + dz * dz + (noise(x / 3.0, z / 3.0, 9) - 0.5) * 0.35;
                if (d > 1) continue;
                int top = s.top(x, z);
                for (int y = GROUND - 1; y <= top; y++) s.set(x, y, z, "air");
                s.set(x, GROUND - 2, z, "packed_ice");
                s.set(x, GROUND - 1, z, d > 0.75 ? "packed_ice" : "ice");
            }
        // Eğrelti, böğürtlen çalısı (karın arasından çıkan)
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                if (Math.abs(x) <= 5 && z >= -3 && z <= 4) continue;
                int y = s.top(x, z);
                if (!s.get(x, y, z).startsWith("minecraft:snow") || !s.get(x, y - 1, z).startsWith("minecraft:grass_block")) continue;
                double k = r.nextDouble();
                if (k > 0.085) continue;
                s.set(x, y - 1, z, "grass_block[snowy=false]");
                s.set(x, y, z, k < 0.05 ? "fern" : k < 0.07 ? "short_grass" : "sweet_berry_bush[age=" + (2 + r.nextInt(2)) + "]");
            }
        // Ladin ağaçları
        int[][] trees = new int[60][];
        int n = 0;
        for (int i = 0; i < 400 && n < trees.length; i++) {
            int[] p = spot(r, 2, true);
            if (near(trees, n, p[0], p[1], 5)) continue;
            int top = s.top(p[0], p[1]);
            if (!s.get(p[0], top, p[1]).startsWith("minecraft:snow")) continue;
            trees[n++] = p;
            spruce(s, r, p[0], top, p[1], 7 + r.nextInt(7));
        }
        // Kayalar
        for (int i = 0; i < 14; i++) {
            int[] p = spot(r, 0, true);
            boulder(s, r, p[0], s.top(p[0], p[1]) - 1, p[1], 1 + r.nextInt(2), "cobblestone", "mossy_cobblestone", true);
        }
        // Kamp ateşi ve oturma kütükleri (karakterlerin solunda, biraz geride)
        int g = GROUND + 1;
        s.set(-6, g, -3, "campfire[lit=true,facing=south]");
        s.set(-6, g - 1, -3, "dirt");
        for (int x = -8; x <= -7; x++) s.set(x, g, -1, "stripped_spruce_log[axis=x]");
        s.set(-4, g, -5, "stripped_spruce_log[axis=z]");
        s.set(-4, g, -6, "stripped_spruce_log[axis=z]");
        // Fener direkleri
        lampPost(s, 8, -2);
        lampPost(s, -12, -9);
        lampPost(s, 14, -12);
        lampPost(s, -3, -15);
        lampPost(s, 19, 1);
        for (int x = -9; x <= 9; x++)
            for (int z = -5; z <= 7; z++)
                if (s.get(x, g, z).startsWith("minecraft:snow")) s.set(x, g, z, "snow[layers=1]");
    }

    private static void lampPost(LobbyScene s, int x, int z) {
        int y = s.top(x, z);
        if (s.get(x, y, z).startsWith("minecraft:snow")) s.set(x, y, z, "air");
        y = s.top(x, z);
        s.set(x, y + 1, z, "spruce_fence");
        s.set(x, y + 2, z, "spruce_fence");
        s.set(x, y + 3, z, "lantern");
    }

    private static void spruce(LobbyScene s, Random r, int x, int ground, int z, int h) {
        if (s.get(x, ground, z).startsWith("minecraft:snow")) s.set(x, ground, z, "air");
        int base = s.top(x, z);
        for (int y = 1; y <= h; y++) s.set(x, base + y, z, "spruce_log[axis=y]");
        int start = base + 3;
        int top = base + h + 1;
        for (int y = start; y <= top; y++) {
            double t = (double) (y - start) / (top - start);
            int rad = (int) Math.round((1 - t) * 3.2 + ((top - y) % 2 == 0 ? 0.4 : -0.3));
            rad = Math.max(y == top ? 0 : 1, rad);
            for (int dx = -rad; dx <= rad; dx++)
                for (int dz = -rad; dz <= rad; dz++) {
                    if (Math.abs(dx) + Math.abs(dz) > rad + (rad > 1 ? 1 : 0)) continue;
                    if (rad > 1 && Math.abs(dx) == rad && Math.abs(dz) == rad) continue;
                    s.setIfAir(x + dx, y, z + dz, "spruce_leaves[persistent=true]");
                }
        }
        s.set(x, top + 1, z, "spruce_leaves[persistent=true]");
        // Yapraklara kar
        for (int dx = -4; dx <= 4; dx++)
            for (int dz = -4; dz <= 4; dz++) {
                int ty = s.top(x + dx, z + dz);
                if (s.get(x + dx, ty, z + dz).equals("minecraft:spruce_leaves[persistent=true]") && r.nextInt(3) > 0) s.set(x + dx, ty + 1, z + dz, "snow[layers=1]");
            }
    }

    private static void boulder(LobbyScene s, Random r, int x, int y, int z, int rad, String a, String b, boolean snow) {
        for (int dx = -rad; dx <= rad; dx++)
            for (int dy = 0; dy <= rad; dy++)
                for (int dz = -rad; dz <= rad; dz++) {
                    if (dx * dx + dy * dy * 1.6 + dz * dz > rad * rad + 0.6 + r.nextDouble()) continue;
                    s.set(x + dx, y + dy, z + dz, r.nextInt(3) == 0 ? b : a);
                }
        if (snow)
            for (int dx = -rad; dx <= rad; dx++)
                for (int dz = -rad; dz <= rad; dz++) {
                    int ty = s.top(x + dx, z + dz);
                    String t = s.get(x + dx, ty, z + dz);
                    if (t.contains("cobblestone")) s.set(x + dx, ty + 1, z + dz, "snow[layers=1]");
                }
    }

    // ───────── Badlands ─────────

    private static final String[] BANDS = { "terracotta", "orange_terracotta", "orange_terracotta", "yellow_terracotta", "terracotta", "white_terracotta",
            "orange_terracotta", "red_terracotta", "terracotta", "brown_terracotta", "light_gray_terracotta", "orange_terracotta", "terracotta", "red_terracotta" };

    private static String band(int y) {
        return BANDS[Math.floorMod(y, BANDS.length)];
    }

    private static void badlands(LobbyScene s, Random r) {
        long seed = 21;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int h = height(x, z, seed, 5);
                double p = noise(x / 5.0, z / 5.0, 3);
                String top = p > 0.84 && open(x, z) > 0.5 ? "coarse_dirt" : p < 0.12 && open(x, z) > 0.5 ? "terracotta" : "red_sand";
                for (int y = 1; y <= h; y++) s.set(x, y, z, y == h ? top : y >= h - 2 ? "red_sandstone" : band(y));
            }
        // Arkada mesa platoları
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= -22; z++) {
                double m = noise(x / 13.0, z / 9.0, 31) + (-22 - z) / 70.0;
                if (m < 0.62) continue;
                int h = GROUND + 6 + (int) ((m - 0.62) * 40);
                h = Math.min(MAX_Y - 4, h);
                for (int y = s.top(x, z) + 1; y <= h; y++) s.set(x, y, z, band(y));
                s.set(x, h + 1, z, noise(x / 4.0, z / 4.0, 32) > 0.5 ? "red_sand" : "coarse_dirt");
            }
        // Çizgili terrakota kuleleri (hoodoo)
        int[][] towers = new int[26][];
        int n = 0;
        for (int i = 0; i < 300 && n < towers.length; i++) {
            int[] p = spot(r, 3, true);
            if (near(towers, n, p[0], p[1], 7)) continue;
            towers[n++] = p;
            int base = s.top(p[0], p[1]);
            int h = 6 + r.nextInt(p[1] < -15 ? 15 : 9);
            double rad0 = 1.4 + r.nextDouble() * 1.8;
            for (int y = 0; y <= h; y++) {
                double t = (double) y / h;
                double rad = rad0 * (1 - t * 0.45) + Math.sin(y * 0.9 + p[0]) * 0.25;
                int ri = (int) Math.ceil(rad);
                for (int dx = -ri; dx <= ri; dx++)
                    for (int dz = -ri; dz <= ri; dz++)
                        if (dx * dx + dz * dz <= rad * rad) s.set(p[0] + dx, base + y, p[1] + dz, band(base + y));
            }
            // Tepede biraz kızıl kum
            int ty = s.top(p[0], p[1]);
            s.set(p[0], ty + 1, p[1], "red_sand");
        }
        // Kaktüs, ölü çalı
        for (int i = 0; i < 70; i++) {
            int x = MIN_X + 2 + r.nextInt(SX - 4), z = MIN_Z + 2 + r.nextInt(SZ - 4);
            if (open(x, z) < 0.3) continue;
            int y = s.top(x, z);
            if (!s.get(x, y, z).contains("red_sand") && !s.get(x, y, z).contains("coarse_dirt")) continue;
            if (keepLow(x, z, 0) || r.nextInt(3) > 0) s.set(x, y + 1, z, "dead_bush");
            else if (s.get(x, y, z).contains("sand")) cactus(s, r, x, y, z);
        }
    }

    private static void cactus(LobbyScene s, Random r, int x, int y, int z) {
        if (!s.air(x + 1, y + 1, z) || !s.air(x - 1, y + 1, z) || !s.air(x, y + 1, z + 1) || !s.air(x, y + 1, z - 1)) return;
        int h = 1 + r.nextInt(3);
        for (int i = 1; i <= h; i++) s.set(x, y + i, z, "cactus");
        if (r.nextInt(3) == 0) s.set(x, y + h + 1, z, "cactus_flower");
    }

    // ───────── Çöl ─────────

    private static void desert(LobbyScene s, Random r) {
        long seed = 41;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                double o = open(x, z);
                double dune = Math.sin((x * 0.22 + z * 0.12) + fbm(x, z, seed) * 3) * 0.5 + 0.5;
                double back = z < -8 ? 1 + (-8 - z) / 26.0 : 1;
                int h = GROUND + (int) Math.round(o * (dune * 4.5 + fbm(x, z, seed + 9) * 3 - 1.5) * back);
                h = Math.max(3, h);
                column(s, x, z, h, "sand", "sand", "sandstone");
            }
        // Kumtaşı kayalıkları
        for (int i = 0; i < 9; i++) {
            int[] p = spot(r, 4, false);
            int base = s.top(p[0], p[1]);
            int rad = 2 + r.nextInt(3), h = 3 + r.nextInt(6);
            for (int dx = -rad; dx <= rad; dx++)
                for (int dz = -rad; dz <= rad; dz++) {
                    double d = Math.sqrt(dx * dx + dz * dz) + r.nextDouble() * 0.8;
                    if (d > rad + 0.3) continue;
                    int top = base + (int) Math.round(h * (1 - d / (rad + 1.2)));
                    for (int y = base - 1; y <= top; y++) {
                        String b = (y - base) % 4 == 3 ? "cut_sandstone" : y == top ? "smooth_sandstone" : "sandstone";
                        s.set(p[0] + dx, y, p[1] + dz, b);
                    }
                }
        }
        // Yıkık sütunlar (arkada)
        int[][] cols = { { -15, -20 }, { -10, -21 }, { 12, -18 }, { 18, -24 } };
        for (int[] c : cols) {
            int base = s.top(c[0], c[1]);
            int h = 3 + r.nextInt(5);
            for (int y = 1; y <= h; y++) s.set(c[0], base + y, c[1], y == h ? "chiseled_sandstone" : "cut_sandstone");
            if (r.nextBoolean()) s.set(c[0] + 1, base + 1, c[1], "sandstone_slab[type=bottom]");
        }
        // Kaktüs, ölü çalı
        for (int i = 0; i < 90; i++) {
            int x = MIN_X + 2 + r.nextInt(SX - 4), z = MIN_Z + 2 + r.nextInt(SZ - 4);
            if (open(x, z) < 0.25) continue;
            int y = s.top(x, z);
            if (!s.get(x, y, z).equals("minecraft:sand")) continue;
            if (keepLow(x, z, 0) || r.nextInt(5) < 3) {
                if (r.nextInt(3) == 0) s.set(x, y + 1, z, "dead_bush");
                else if (!keepLow(x, z, 0)) cactus(s, r, x, y, z);
            } else cactus(s, r, x, y, z);
        }
        // Gece: sütunların tepesinde meşaleler, karakterlerin yanında kamp ateşi ve fenerler
        for (int[] c : cols) s.set(c[0], s.top(c[0], c[1]) + 1, c[1], "torch");
        int g = GROUND + 1;
        for (int x = 3; x <= 8; x++)
            for (int z = -8; z <= -3; z++) {
                for (int y = GROUND + 1; y <= GROUND + 8; y++) s.set(x, y, z, "air");
                s.set(x, GROUND, z, "sand");
            }
        s.set(5, g, -6, "campfire[lit=true,facing=south]");
        s.set(7, g, -5, "smooth_sandstone_slab[type=bottom]");
        s.set(3, g, -7, "smooth_sandstone_slab[type=bottom]");
        int[][] posts = { { -9, -5 }, { 10, -1 }, { -14, -12 }, { 15, -13 }, { -3, -15 } };
        for (int[] p : posts) {
            int y = s.top(p[0], p[1]);
            if (!s.get(p[0], y, p[1]).contains("sand")) {
                s.set(p[0], y, p[1], "air");
                y = s.top(p[0], p[1]);
            }
            s.set(p[0], y + 1, p[1], "cut_sandstone");
            s.set(p[0], y + 2, p[1], "sandstone_wall");
            s.set(p[0], y + 3, p[1], "lantern");
        }
    }

    // ───────── Kiraz bahçesi ─────────

    private static void cherry(LobbyScene s, Random r) {
        long seed = 51;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int h = height(x, z, seed, 8);
                column(s, x, z, h, "grass_block[snowy=false]", "dirt", "stone");
            }
        int[][] trees = new int[44][];
        int n = 0;
        for (int i = 0; i < 400 && n < trees.length; i++) {
            int[] p = spot(r, 3, true);
            if (near(trees, n, p[0], p[1], 7)) continue;
            trees[n++] = p;
            cherryTree(s, r, p[0], s.top(p[0], p[1]), p[1]);
        }
        // Yerde pembe yapraklar, çiçekler ve ot
        String[] facings = { "north", "south", "east", "west" };
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int y = s.top(x, z);
                if (!s.get(x, y, z).startsWith("minecraft:grass_block")) continue;
                double petals = noise(x / 4.0, z / 4.0, 55);
                double k = r.nextDouble();
                if (petals > 0.5 && k < 0.75) s.set(x, y + 1, z, "pink_petals[flower_amount=" + (1 + r.nextInt(4)) + ",facing=" + facings[r.nextInt(4)] + "]");
                else if (k < 0.12) s.set(x, y + 1, z, "short_grass");
                else if (k < 0.15) s.set(x, y + 1, z, pick(r, "pink_tulip", "allium", "lily_of_the_valley", "white_tulip"));
            }
        // Karakter alanının ortası daha sade kalsın
        for (int x = -4; x <= 4; x++)
            for (int z = -2; z <= 3; z++) {
                String b = s.get(x, GROUND + 1, z);
                if (b.contains("short_grass") || b.contains("tulip") || b.contains("allium") || b.contains("lily")) s.set(x, GROUND + 1, z, "air");
            }
    }

    private static void cherryTree(LobbyScene s, Random r, int x, int ground, int z) {
        int h = 4 + r.nextInt(3);
        for (int y = 1; y <= h; y++) s.set(x, ground + y, z, "cherry_log[axis=y]");
        // Yana uzanan dal
        int dir = r.nextInt(4);
        int bx = dir == 0 ? 1 : dir == 1 ? -1 : 0, bz = dir == 2 ? 1 : dir == 3 ? -1 : 0;
        int cx = x, cy = ground + h, cz = z;
        for (int i = 1; i <= 2 + r.nextInt(2); i++) {
            cx += bx;
            cz += bz;
            cy += i % 2;
            s.set(cx, cy, cz, "cherry_log[axis=" + (bx != 0 ? "x" : "z") + "]");
        }
        canopy(s, r, x, ground + h + 1, z, 3.4);
        canopy(s, r, cx, cy + 1, cz, 2.6);
    }

    private static void canopy(LobbyScene s, Random r, int x, int y, int z, double rad) {
        int ri = (int) Math.ceil(rad);
        for (int dx = -ri; dx <= ri; dx++)
            for (int dy = -2; dy <= 2; dy++)
                for (int dz = -ri; dz <= ri; dz++) {
                    double d = dx * dx + dz * dz + dy * dy * 2.4;
                    if (d > rad * rad + r.nextDouble() * 1.5) continue;
                    s.setIfAir(x + dx, y + dy, z + dz, "cherry_leaves[persistent=true]");
                }
    }

    // ───────── End ─────────

    private static void end(LobbyScene s, Random r) {
        long seed = 61;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                // Ada: uzakta ve kenarlarda boşluğa düşer
                double edge = Math.max(Math.abs(x) / 40.0, z < 0 ? -z / 46.0 : z / 22.0) + (noise(x / 9.0, z / 9.0, seed + 4) - 0.5) * 0.25;
                if (edge > 1) continue;
                int h = height(x, z, seed, 6);
                int depth = (int) Math.round((1 - edge) * 9) + 2;
                for (int y = Math.max(1, h - depth); y <= h; y++) s.set(x, y, z, "end_stone");
            }
        // Obsidyen sütunlar (arkada, yarım daire)
        for (int i = 0; i < 7; i++) {
            double a = Math.PI * (0.12 + i * 0.127);
            int px = (int) Math.round(Math.cos(a) * 30), pz = -12 - (int) Math.round(Math.sin(a) * 26);
            int base = s.top(px, pz);
            if (base < 2) base = GROUND;
            int h = 12 + r.nextInt(14);
            int rad = 2 + r.nextInt(2);
            for (int dx = -rad; dx <= rad; dx++)
                for (int dz = -rad; dz <= rad; dz++) {
                    if (dx * dx + dz * dz > rad * rad + 1) continue;
                    for (int y = 1; y <= base + h; y++) s.set(px + dx, y, pz + dz, "obsidian");
                }
            if (i % 2 == 0) s.set(px, base + h + 1, pz, "end_rod[facing=up]");
        }
        // Koro bitkileri
        for (int i = 0; i < 26; i++) {
            int[] p = spot(r, 1, true);
            int y = s.top(p[0], p[1]);
            if (!s.get(p[0], y, p[1]).equals("minecraft:end_stone")) continue;
            chorus(s, r, p[0], y + 1, p[1], 0, 3 + r.nextInt(3));
        }
        chorusConnections(s);
        // Karakter alanını çevreleyen End çubukları (ışık)
        int[][] rods = { { -10, -4 }, { 10, -4 }, { -11, 4 }, { 11, 4 } };
        for (int[] p : rods) s.set(p[0], s.top(p[0], p[1]) + 1, p[1], "end_rod[facing=up]");
        // Küçük purpur kalıntısı
        for (int y = 0; y < 5; y++) s.set(-20, s.top(-20, -16) + 1, -16, y == 4 ? "purpur_pillar[axis=y]" : "purpur_block");
    }

    private static void chorus(LobbyScene s, Random r, int x, int y, int z, int depth, int len) {
        for (int i = 0; i < len; i++) {
            if (!s.air(x, y, z) || y >= MAX_Y - 1) return;
            s.set(x, y, z, "chorus_plant");
            if (i == len - 1) break;
            y++;
        }
        if (depth >= 3) {
            s.setIfAir(x, y + 1, z, "chorus_flower[age=5]");
            return;
        }
        int branches = 1 + r.nextInt(3);
        boolean any = false;
        for (int b = 0; b < branches; b++) {
            int d = r.nextInt(4);
            int nx = x + (d == 0 ? 1 : d == 1 ? -1 : 0), nz = z + (d == 2 ? 1 : d == 3 ? -1 : 0);
            if (!s.air(nx, y, nz) || !s.air(nx, y - 1, nz)) continue;
            any = true;
            chorus(s, r, nx, y, nz, depth + 1, 1 + r.nextInt(3));
        }
        if (!any) s.setIfAir(x, y + 1, z, "chorus_flower[age=5]");
    }

    private static boolean chorusPart(String b) {
        return b.startsWith("minecraft:chorus_plant") || b.startsWith("minecraft:chorus_flower");
    }

    private static void chorusConnections(LobbyScene s) {
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++)
                for (int y = MIN_Y; y <= MAX_Y; y++) {
                    if (!s.get(x, y, z).startsWith("minecraft:chorus_plant")) continue;
                    String down = s.get(x, y - 1, z);
                    boolean d = chorusPart(down) || down.equals("minecraft:end_stone");
                    s.set(x, y, z, "chorus_plant[down=" + d + ",up=" + chorusPart(s.get(x, y + 1, z)) + ",north=" + chorusPart(s.get(x, y, z - 1)) + ",south="
                            + chorusPart(s.get(x, y, z + 1)) + ",west=" + chorusPart(s.get(x - 1, y, z)) + ",east=" + chorusPart(s.get(x + 1, y, z)) + "]");
                }
    }

    // ───────── Nether ─────────

    private static void nether(LobbyScene s, Random r) {
        long seed = 71;
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int h = height(x, z, seed, 10);
                double p = noise(x / 6.0, z / 6.0, 4);
                column(s, x, z, h, p < 0.2 ? "netherrack" : "crimson_nylium", "netherrack", "netherrack");
            }
        // Lav gölü (sol arkada) ve sağ arkada küçük bir lav birikintisi
        lavaPool(s, -18, -12, 7.5, 5.5);
        lavaPool(s, 20, -20, 5, 4);
        // Netherrack sivrileri, tepelerinde ışık taşı
        for (int i = 0; i < 12; i++) {
            int[] p = spot(r, 2, true);
            int base = s.top(p[0], p[1]);
            int h = 5 + r.nextInt(12);
            for (int y = 1; y <= h; y++) {
                double rad = 1.8 * (1 - (double) y / (h + 1)) + 0.4;
                int ri = (int) Math.ceil(rad);
                for (int dx = -ri; dx <= ri; dx++)
                    for (int dz = -ri; dz <= ri; dz++) if (dx * dx + dz * dz <= rad * rad) s.set(p[0] + dx, base + y, p[1] + dz, "netherrack");
            }
            s.set(p[0], base + h + 1, p[1], "glowstone");
            if (r.nextBoolean()) s.set(p[0] + 1, base + h, p[1], "glowstone");
        }
        // Kızıl mantar ağaçları
        int[][] trees = new int[40][];
        int n = 0;
        for (int i = 0; i < 400 && n < trees.length; i++) {
            int[] p = spot(r, 3, true);
            if (near(trees, n, p[0], p[1], 6)) continue;
            int y = s.top(p[0], p[1]);
            if (!s.get(p[0], y, p[1]).equals("minecraft:crimson_nylium")) continue;
            trees[n++] = p;
            fungus(s, r, p[0], y, p[1]);
        }
        // Yerde kızıl kökler ve mantarlar
        for (int x = MIN_X; x <= MAX_X; x++)
            for (int z = MIN_Z; z <= MAX_Z; z++) {
                int y = s.top(x, z);
                if (!s.get(x, y, z).equals("minecraft:crimson_nylium")) continue;
                double k = r.nextDouble();
                boolean centre = Math.abs(x) <= 4 && z >= -2 && z <= 3;
                if (k < 0.16 && !centre) s.set(x, y + 1, z, "crimson_roots");
                else if (k < 0.18 && !centre) s.set(x, y + 1, z, "crimson_fungus");
            }
        // Karakter alanının yanında ışık taşı fenerleri
        int[][] lamps = { { -9, -4 }, { 9, -4 }, { -12, 3 }, { 12, 3 }, { 0, -9 } };
        for (int[] l : lamps) {
            int y = s.top(l[0], l[1]);
            if (!s.get(l[0], y, l[1]).equals("minecraft:crimson_nylium") && !s.get(l[0], y, l[1]).equals("minecraft:netherrack")) y--;
            s.set(l[0], y + 1, l[1], "shroomlight");
        }
    }

    private static void lavaPool(LobbyScene s, int cx, int cz, double rx, double rz) {
        for (int x = (int) (cx - rx - 1); x <= cx + rx + 1; x++)
            for (int z = (int) (cz - rz - 1); z <= cz + rz + 1; z++) {
                double dx = (x - cx) / rx, dz = (z - cz) / rz;
                double d = dx * dx + dz * dz + (noise(x / 2.5, z / 2.5, 77) - 0.5) * 0.4;
                if (d > 1) continue;
                int top = s.top(x, z);
                for (int y = GROUND - 1; y <= top; y++) s.set(x, y, z, "air");
                s.set(x, GROUND - 2, z, "netherrack");
                s.set(x, GROUND - 1, z, "lava");
            }
    }

    private static void fungus(LobbyScene s, Random r, int x, int ground, int z) {
        int h = 5 + r.nextInt(5);
        for (int y = 1; y <= h; y++) s.set(x, ground + y, z, "crimson_stem[axis=y]");
        int top = ground + h;
        int rad = 2 + (h > 7 ? 1 : 0);
        for (int dy = -2; dy <= 1; dy++) {
            int rr = dy == 1 ? rad - 1 : rad;
            for (int dx = -rr; dx <= rr; dx++)
                for (int dz = -rr; dz <= rr; dz++) {
                    boolean shell = Math.abs(dx) == rr || Math.abs(dz) == rr || dy == 1;
                    if (!shell) continue;
                    if (Math.abs(dx) == rr && Math.abs(dz) == rr && r.nextInt(3) > 0) continue;
                    s.setIfAir(x + dx, top + dy, z + dz, r.nextInt(14) == 0 ? "shroomlight" : "nether_wart_block");
                }
        }
        s.setIfAir(x, top + 1, z, "nether_wart_block");
        // Sarkan sarmaşıklar
        for (int dx = -rad; dx <= rad; dx++)
            for (int dz = -rad; dz <= rad; dz++) {
                if ((Math.abs(dx) != rad && Math.abs(dz) != rad) || r.nextInt(3) > 0) continue;
                int vy = top - 3;
                if (!s.get(x + dx, top - 2, z + dz).equals("minecraft:nether_wart_block")) continue;
                int len = 1 + r.nextInt(3);
                for (int i = 0; i < len; i++) {
                    if (!s.air(x + dx, vy - i, z + dz)) break;
                    s.set(x + dx, vy - i, z + dz, i == len - 1 ? "weeping_vines[age=25]" : "weeping_vines_plant");
                }
            }
    }
}
