package dev.west.hud.lobby;

/**
 * Lobi biyomları. Her biri kendi küçük dünyasını ({@link SceneGen}), gökyüzü/sis renklerini,
 * gökyüzü ışığını ve parçacığını tanımlar.
 */
public enum LobbyBiome {
    //        id          ad (Türkçe anahtar)  gök üst    gök ufuk   sis        sisBaş sisSon  gökIşığı parçacık
    SNOWY("snowy", "Karlı", 0xFF6F8FB5, 0xFFC7D5E4, 0xFFC3D1E0, 18f, 54f, 0.86f, Particle.SNOW),
    BADLANDS("badlands", "Badlands", 0xFF6FA0D8, 0xFFF0C69A, 0xFFEBC196, 22f, 60f, 1.0f, Particle.DUST),
    DESERT("desert", "Çöl", 0xFF7BB1E6, 0xFFF1E3BC, 0xFFEDDFB8, 22f, 60f, 1.0f, Particle.NONE),
    CHERRY("cherry", "Kiraz Bahçesi", 0xFF86B9EC, 0xFFF6DCE6, 0xFFF3D6E2, 20f, 58f, 0.97f, Particle.PETALS),
    END("end", "End", 0xFF07050D, 0xFF1E1530, 0xFF1B1329, 18f, 56f, 0.55f, Particle.ENDER),
    NETHER("nether", "Nether", 0xFF1C0505, 0xFF4A1210, 0xFF4A1512, 14f, 48f, 0.0f, Particle.EMBERS);

    public enum Particle { NONE, SNOW, DUST, PETALS, ENDER, EMBERS }

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
        return SNOWY;
    }

    /** Nether'de yüzler daha eşit aydınlanır (oyundaki gibi) */
    public boolean netherShading() {
        return this == NETHER;
    }
}
