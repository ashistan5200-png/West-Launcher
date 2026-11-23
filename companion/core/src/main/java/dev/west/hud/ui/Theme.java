package dev.west.hud.ui;

/**
 * West arayüz renkleri. Dört tema: gece/gün camı ve piksel gece/gün. Vurgu rengi kullanıcıdan.
 */
public final class Theme {
    public final String id;
    public final int backdrop, panel, side, card, cardHover, line, text, muted, accent, onAccent, danger, ok;
    /** Köşe yuvarlaklığı (piksel temalarda 0) */
    public final int radius;
    public final boolean pixel;

    private Theme(String id, int backdrop, int panel, int side, int card, int cardHover, int line, int text, int muted, int accent, int radius, boolean pixel) {
        this.id = id;
        this.backdrop = backdrop;
        this.panel = panel;
        this.side = side;
        this.card = card;
        this.cardHover = cardHover;
        this.line = line;
        this.text = text;
        this.muted = muted;
        this.accent = accent;
        this.onAccent = luminance(accent) > 0.55 ? 0xFF1A140C : 0xFFFFFFFF;
        this.danger = 0xFFE5566E;
        this.ok = 0xFF4ADE80;
        this.radius = radius;
        this.pixel = pixel;
    }

    public static Theme of(String id, int accent) {
        accent = 0xFF000000 | (accent & 0xFFFFFF);
        return switch (id) {
            case "day" -> new Theme(id, 0x66000000, 0xF5F4F4F8, 0xF0EBEBF1, 0x0C000000, 0x16000000, 0x1A000000, 0xFF18181F, 0xFF62627A, accent, 6, false);
            case "pixel-night" -> new Theme(id, 0x88000000, 0xF2181621, 0xF21F1C2A, 0x14FFFFFF, 0x22FFFFFF, 0x30FFFFFF, 0xFFECEAF2, 0xFFA09CB2, accent, 0, true);
            case "pixel-day" -> new Theme(id, 0x66000000, 0xF5ECE7DC, 0xF5E2DCCF, 0x10000000, 0x1C000000, 0x30000000, 0xFF1E1A16, 0xFF6A6056, accent, 0, true);
            default -> new Theme("night", 0x88000000, 0xEE12121A, 0xEE17171F, 0x0EFFFFFF, 0x18FFFFFF, 0x16FFFFFF, 0xFFECECF2, 0xFFA0A0B2, accent, 6, false);
        };
    }

    public static double luminance(int argb) {
        int r = (argb >> 16) & 255, g = (argb >> 8) & 255, b = argb & 255;
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
    }

    /** Rengin saydamlığını değiştir (0–255). */
    public static int alpha(int argb, int a) {
        return (Math.max(0, Math.min(255, a)) << 24) | (argb & 0xFFFFFF);
    }

    /** İki rengi karıştır (t = 0 → a, 1 → b). */
    public static int mix(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int aa = (a >>> 24), ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
        int ba = (b >>> 24), br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return ((int) (aa + (ba - aa) * t) << 24) | ((int) (ar + (br - ar) * t) << 16) | ((int) (ag + (bg - ag) * t) << 8) | (int) (ab + (bb - ab) * t);
    }

    public static final int[] ACCENTS = { 0xE8A25C, 0x6EA8D6, 0x70C48E, 0x5BB5B0, 0x7F9CF5, 0xA08CB8, 0xEC5A82, 0xE5566E, 0xF2C14E, 0xD9D9E0 };
}
