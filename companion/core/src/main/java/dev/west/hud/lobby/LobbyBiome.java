package dev.west.hud.lobby;

/**
 * Lobi biyomları. Her biri kendi küçük dünyasını ({@link SceneGen}), gökyüzü/sis renklerini,
 * gökyüzü ışığını ve parçacığını tanımlar.
 */
public enum LobbyBiome {
    //        id          ad (Türkçe anahtar)  gök üst    gök ufuk   sis        sisBaş sisSon  gökIşığı parçacık
    FOREST("forest", "Gece Ormanı", 0xFF0A1226, 0xFF223355, 0xFF1C2A48, 18f, 56f, 0.6f, Particle.FIREFLIES),
    SNOWY("snowy", "Karlı", 0xFF081428, 0xFF1E3458, 0xFF1A2C4A, 18f, 54f, 0.58f, Particle.SNOW),
    BADLANDS("badlands", "Badlands", 0xFF6FA0D8, 0xFFF0C69A, 0xFFEBC196, 22f, 60f, 1.0f, Particle.DUST),
    DESERT("desert", "Çöl", 0xFF0A0C24, 0xFF33305A, 0xFF2A2846, 22f, 62f, 0.56f, Particle.DUST),
    CHERRY("cherry", "Kiraz Bahçesi", 0xFF86B9EC, 0xFFF6DCE6, 0xFFF3D6E2, 20f, 58f, 0.97f, Particle.PETALS),
    END("end", "End", 0xFF07050D, 0xFF1E1530, 0xFF1B1329, 18f, 56f, 0.55f, Particle.ENDER),
    NETHER("nether", "Nether", 0xFF1C0505, 0xFF4A1210, 0xFF4A1512, 14f, 48f, 0.0f, Particle.EMBERS);

    public enum Particle { NONE, SNOW, DUST, PETALS, ENDER, EMBERS, FIREFLIES }

    public final String id, name;
    public final int skyTop, skyHorizon, fog;
    public final float fogStart, fogEnd, skyLight;
    public final Particle particle;

    LobbyBiome(String id, String name, int skyTop, int skyHorizon, int fog, float fogStart, float fogEnd, float skyLight, Particle particle) {
        this.id = id;
        this.name = name;
        this.skyTop = skyTop;
        this.skyHorizon = skyHorizon;
        this.fog = fog;
        this.fogStart = fogStart;
        this.fogEnd = fogEnd;
        this.skyLight = skyLight;
        this.particle = particle;
    }

    public static LobbyBiome of(String id) {
        for (LobbyBiome b : values()) if (b.id.equals(id)) return b;
        return FOREST;
    }

    /** Gece biyomu: yıldızlar, ay, ışık kaynaklarının parıltısı belirgin */
    public boolean night() {
        return this == FOREST || this == SNOWY || this == DESERT || this == END;
    }

    /** Nether'de yüzler daha eşit aydınlanır (oyundaki gibi) */
    public boolean netherShading() {
        return this == NETHER;
    }
}
