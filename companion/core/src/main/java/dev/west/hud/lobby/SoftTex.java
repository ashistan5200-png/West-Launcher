package dev.west.hud.lobby;

import dev.west.hud.api.Gfx;

/**
 * Lobi efektlerinin yumuşak dokuları (alfa 0–255). Sürüm adaptörleri bunları bir kez dokuya çevirip
 * doğrusal süzgeçle büyüterek çizer: ışık parıltısı, vinyet, ışık huzmesi/sis şeridi.
 */
public final class SoftTex {
    private SoftTex() {}

    public static int width(int kind) {
        return kind == Gfx.SOFT_BAND ? 64 : kind == Gfx.SOFT_VIGNETTE ? 256 : 128;
    }

    public static int height(int kind) {
        return kind == Gfx.SOFT_BAND ? 256 : kind == Gfx.SOFT_VIGNETTE ? 256 : 128;
    }

    public static byte[] alpha(int kind) {
        int w = width(kind), h = height(kind);
        byte[] a = new byte[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++) {
                float u = (x + 0.5f) / w * 2 - 1, v = (y + 0.5f) / h * 2 - 1;
                float k = switch (kind) {
                    case Gfx.SOFT_VIGNETTE -> vignette(u, v);
                    case Gfx.SOFT_BAND -> band(u, v);
                    default -> glow(u, v);
                };
                a[y * w + x] = (byte) Math.max(0, Math.min(255, Math.round(k * 255)));
            }
        return a;
    }

    /** Merkezde parlak, dışa doğru Gauss gibi sönen; kenarda tam sıfır (kare izi kalmaz) */
    private static float glow(float u, float v) {
        float r = (float) Math.sqrt(u * u + v * v);
        if (r >= 1) return 0;
        float g = (float) Math.exp(-r * r * 4.2f);
        float edge = 1 - r;
        return g * Math.min(1, edge * 3.5f);
    }

    /** Kenarlar ve özellikle köşeler koyu; orta tamamen açık */
    private static float vignette(float u, float v) {
        // Süper elips: köşeler kenarlardan daha koyu
        float d = (float) Math.pow(Math.pow(Math.abs(u), 2.6) + Math.pow(Math.abs(v), 2.6), 1 / 2.6);
        return smooth(0.52f, 1.22f, d);
    }

    /** Uzunlamasına şerit: enine Gauss, iki ucu yumuşakça söner */
    private static float band(float u, float v) {
        float across = (float) Math.exp(-u * u * 5.5f) * Math.min(1, (1 - Math.abs(u)) * 4);
        float along = (float) Math.pow(Math.max(0, Math.cos(v * Math.PI / 2)), 0.8);
        return across * along;
    }

    /**
     * Kenar bulanıklığı maskesi: (fx, fy) ekran oranı (0–1). 1 = keskin sahne, 0 = bulanık. Orta elips
     * (yarıçaplar rx, ry) keskin; kenara ve köşelere doğru bulanıklığa geçer.
     */
    public static float sharp(float fx, float fy, float rx, float ry) {
        float u = (fx - 0.5f) / Math.max(0.05f, rx), v = (fy - 0.52f) / Math.max(0.05f, ry);
        float d = (float) Math.sqrt(u * u + v * v);
        return 1 - smooth(0.62f, 1.18f, d);
    }

    private static float smooth(float a, float b, float x) {
        float t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    }
}
