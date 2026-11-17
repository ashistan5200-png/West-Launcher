package dev.west.hud.cosmetic;

import java.util.ArrayList;
import java.util.List;

/**
 * West Coin kozmetikleri: şekiller (küplerden), renk paletleri ve pelerin desenleri.
 * Sürümden bağımsızdır; her sürümün adaptörü bunları Minecraft modeline çevirip çizer.
 *
 * Koordinatlar Minecraft model pikselindedir (1/16 blok). Kafa için orijin boyundur: kafa
 * x -4..4, y -8..0, z -4..4 (ön yüz -z). Gövde için orijin boyundur: gövde x -4..4, y 0..12, z -2..2.
 */
public final class Cosmetics {
    private Cosmetics() {}

    /** Bir küp: konum, boyut ve palet rengi (0–7) */
    public record Box(float x, float y, float z, float w, float h, float d, int color) {}

    /** Hareket türü */
    public enum Anim { NONE, BOB, FLAP }

    /**
     * Bir parça: bağlandığı yer (kafa/gövde), dönme noktası, küpler.
     * side: kanatlarda -1 sol, 1 sağ (çırpma yönü); 0 diğerleri.
     */
    public record Part(String attach, float px, float py, float pz, List<Box> boxes, Anim anim, int side) {}

    /** Bir kozmetik: parçalar, 8 renklik palet, parlıyor mu (ışıktan bağımsız) */
    public record Model(List<Part> parts, int[] palette, boolean glow) {}

    private static Box b(float x, float y, float z, float w, float h, float d, int c) {
        return new Box(x, y, z, w, h, d, c);
    }

    private static Part head(Anim a, Box... boxes) {
        return new Part("head", 0, 0, 0, List.of(boxes), a, 0);
    }

    public static Model model(String id) {
        if (id == null) return null;
        return switch (id) {
            // ───── Şapkalar ─────
            case "hat_cap" -> new Model(List.of(head(Anim.NONE,
                    b(-4.25f, -9.6f, -4.25f, 8.5f, 2f, 8.5f, 0),
                    b(-4.25f, -8.1f, -8.2f, 8.5f, 0.6f, 4f, 1),
                    b(-1f, -9.9f, -1f, 2f, 0.4f, 2f, 1))),
                    new int[] { 0xFF23252E, 0xFFE8A25C, 0, 0, 0, 0, 0, 0 }, false);
            case "hat_catears" -> new Model(List.of(head(Anim.NONE,
                    b(-4f, -10.2f, -1f, 2.6f, 2.4f, 1.2f, 0),
                    b(1.4f, -10.2f, -1f, 2.6f, 2.4f, 1.2f, 0),
                    b(-3.4f, -9.6f, -1.15f, 1.4f, 1.6f, 0.2f, 1),
                    b(2f, -9.6f, -1.15f, 1.4f, 1.6f, 0.2f, 1),
                    b(-3.3f, -10.9f, -0.8f, 1.2f, 0.8f, 0.8f, 0),
                    b(2.1f, -10.9f, -0.8f, 1.2f, 0.8f, 0.8f, 0))),
                    new int[] { 0xFF3A2D33, 0xFFF2B8C6, 0, 0, 0, 0, 0, 0 }, false);
            case "hat_tophat" -> new Model(List.of(head(Anim.NONE,
                    b(-5.2f, -8.7f, -5.2f, 10.4f, 0.8f, 10.4f, 0),
                    b(-3.4f, -15.2f, -3.4f, 6.8f, 6.6f, 6.8f, 0),
                    b(-3.5f, -10.2f, -3.5f, 7f, 1.3f, 7f, 1))),
                    new int[] { 0xFF161616, 0xFFC43C3C, 0, 0, 0, 0, 0, 0 }, false);
            case "hat_wizard" -> new Model(List.of(head(Anim.NONE,
                    b(-5.6f, -8.7f, -5.6f, 11.2f, 0.8f, 11.2f, 0),
                    b(-3.6f, -11.7f, -3.6f, 7.2f, 3f, 7.2f, 0),
                    b(-2.6f, -14.6f, -2.4f, 5.2f, 3f, 5.2f, 0),
                    b(-1.6f, -17.2f, -1.2f, 3.2f, 2.8f, 3.2f, 0),
                    b(-0.8f, -19.4f, -0.2f, 1.6f, 2.4f, 1.6f, 0),
                    b(-3.65f, -10.2f, -3.65f, 7.3f, 0.9f, 7.3f, 1))),
                    new int[] { 0xFF2A1C5C, 0xFFF2C14E, 0, 0, 0, 0, 0, 0 }, false);
            case "hat_crown" -> {
                List<Box> c = new ArrayList<>();
                c.add(b(-4.4f, -10f, -4.4f, 8.8f, 2.2f, 0.7f, 0));
                c.add(b(-4.4f, -10f, 3.7f, 8.8f, 2.2f, 0.7f, 0));
                c.add(b(-4.4f, -10f, -3.7f, 0.7f, 2.2f, 7.4f, 0));
                c.add(b(3.7f, -10f, -3.7f, 0.7f, 2.2f, 7.4f, 0));
                // Sivri uçlar ve mücevherler
                for (int i = 0; i < 3; i++) {
                    float x = -3.9f + i * 3.4f;
                    c.add(b(x, -11.6f, -4.4f, 1.1f, 1.6f, 0.7f, 0));
                    c.add(b(x, -11.6f, 3.7f, 1.1f, 1.6f, 0.7f, 0));
                }
                c.add(b(-0.6f, -9.4f, -4.6f, 1.2f, 1.2f, 0.3f, 2));
                c.add(b(-3.1f, -9.2f, -4.55f, 0.9f, 0.9f, 0.2f, 3));
                c.add(b(2.2f, -9.2f, -4.55f, 0.9f, 0.9f, 0.2f, 3));
                yield new Model(List.of(new Part("head", 0, 0, 0, c, Anim.NONE, 0)), new int[] { 0xFFFFC93C, 0, 0xFFE0303F, 0xFF3F7FE0, 0, 0, 0, 0 }, false);
            }
            case "hat_halo" -> {
                List<Box> c = new ArrayList<>();
                for (int i = 0; i < 16; i++) {
                    double a = i * Math.PI * 2 / 16;
                    c.add(b((float) (Math.cos(a) * 4.2 - 0.6), -12.4f, (float) (Math.sin(a) * 4.2 - 0.6), 1.2f, 0.6f, 1.2f, 0));
                }
                yield new Model(List.of(new Part("head", 0, 0, 0, c, Anim.BOB, 0)), new int[] { 0xFFFFF3B0, 0, 0, 0, 0, 0, 0, 0 }, true);
            }
            // ───── Sırt ─────
            case "back_bag" -> new Model(List.of(new Part("body", 0, 0, 0, List.of(
                    b(-3.2f, 1.2f, 2f, 6.4f, 7.5f, 3.2f, 0),
                    b(-3.3f, 0.8f, 1.9f, 6.6f, 2.4f, 3.5f, 1),
                    b(-1.2f, 5f, 5.1f, 2.4f, 2.2f, 0.4f, 2),
                    b(-2.9f, -0.2f, -2.2f, 0.9f, 7.8f, 0.4f, 1),
                    b(2f, -0.2f, -2.2f, 0.9f, 7.8f, 0.4f, 1)), Anim.NONE, 0)),
                    new int[] { 0xFF8A5A30, 0xFF5E3B1E, 0xFFE8C26A, 0, 0, 0, 0, 0 }, false);
            case "back_wings" -> wings(new int[] { 0xFFF4F7FF, 0xFFD8DEEA, 0xFFB9C2D4, 0, 0, 0, 0, 0 }, false, false);
            case "back_dragon" -> wings(new int[] { 0xFF3A1F5C, 0xFF8A4AD6, 0xFF241238, 0, 0, 0, 0, 0 }, true, false);
            case "back_plus_wings" -> wings(new int[] { 0xFFFFE7A3, 0xFFF2B654, 0xFFC8782C, 0, 0, 0, 0, 0 }, false, true);
            default -> null;
        };
    }

    /** Kanatlar: iki parça, sırtta dönme noktası, katmanlı tüyler (ya da ejderhada kemik + zar) */
    private static Model wings(int[] pal, boolean dragon, boolean glow) {
        List<Part> parts = new ArrayList<>();
        for (int side = -1; side <= 1; side += 2) {
            List<Box> f = new ArrayList<>();
            if (dragon) {
                // Kemik ve zar
                f.add(b(0, -1f, 0, side * 13f, 1.2f, 1.2f, 2));
                f.add(b(0, 0f, 0.3f, side * 12f, 9f, 0.4f, 1));
                f.add(b(side * 12f, -1f, 0, side * 1.2f, 7f, 1.2f, 2));
            } else {
                // Üç kat tüy: kısa → uzun
                f.add(b(0, -1.5f, 0, side * 11f, 3.2f, 0.9f, 0));
                f.add(b(0, 1.7f, 0.15f, side * 9.5f, 3f, 0.8f, 1));
                f.add(b(0, 4.7f, 0.3f, side * 7.5f, 3f, 0.7f, 2));
                f.add(b(side * 9f, -2.2f, 0, side * 3.5f, 2.4f, 0.9f, 0));
            }
            // Negatif genişlik yerine konumu kaydır
            List<Box> norm = new ArrayList<>();
            for (Box x : f) norm.add(x.w < 0 ? b(x.x + x.w, x.y, x.z, -x.w, x.h, x.d, x.color) : x);
            parts.add(new Part("body", side * 1.5f, 2.5f, 2.2f, norm, Anim.FLAP, side));
        }
        return new Model(parts, pal, glow);
    }

    // ───── Pelerin desenleri (64x32 doku; pelerinin ön yüzü x 1..11, y 1..17) ─────

    /** Pelerin dokusu ARGB (64x32). Bilinmeyen kimlik → null. */
    public static int[] cape(String id) {
        if (id == null) return null;
        int[] px = new int[64 * 32];
        java.util.Random r = new java.util.Random(id.hashCode());
        switch (id) {
            case "cape_west" -> fill(px, (x, y) -> shade(0xFF1B1D24, r), (x, y) -> compass(x, y, 0xFFE8A25C));
            case "cape_sunset" -> fill(px, (x, y) -> shade(mix(0xFF3A1C3D, 0xFFFF9A5A, y / 16f), r), null);
            case "cape_ocean" -> fill(px, (x, y) -> shade(((x + y * 2) % 7 < 2) ? 0xFF7FD0E4 : mix(0xFF0C2A3D, 0xFF2F7C8F, y / 16f), r), null);
            case "cape_forest" -> fill(px, (x, y) -> shade(r.nextInt(5) == 0 ? 0xFF9AD69A : mix(0xFF13281A, 0xFF4E7D55, y / 16f), r), null);
            case "cape_sakura" -> fill(px, (x, y) -> shade(r.nextInt(6) == 0 ? 0xFFFFD6E6 : mix(0xFF5A2A44, 0xFFF2A6C4, y / 16f), r), null);
            case "cape_nether" -> fill(px, (x, y) -> shade(((x * 3 + y * 5) % 11 == 0 || (x + y) % 9 == 0) ? 0xFFFF7A45 : 0xFF2A0B0B, r), null);
            case "cape_end" -> fill(px, (x, y) -> shade(r.nextInt(9) == 0 ? 0xFFE9E2A8 : mix(0xFF140D24, 0xFF4D3D6E, y / 16f), r), null);
            case "cape_plus" -> fill(px, (x, y) -> shade(0xFF14100A, r), (x, y) -> plus(x, y));
            default -> {
                return null;
            }
        }
        return px;
    }

    private interface Px {
        int at(int x, int y);
    }

    /** Pelerinin tüm yüzlerini temel desenle, ön yüzü (varsa) amblemle boya */
    private static void fill(int[] px, Px base, Px emblem) {
        for (int y = 0; y < 17; y++) {
            for (int x = 0; x < 22; x++) {
                int lx = Math.min(x, 10), ly = Math.max(0, y - 1);
                int c = base.at(lx, ly);
                if (emblem != null && x >= 1 && x <= 10 && y >= 1 && y <= 16) {
                    int e = emblem.at(x - 1, y - 1);
                    if (e != 0) c = e;
                }
                px[y * 64 + x] = c;
            }
        }
    }

    private static int compass(int x, int y, int col) {
        double dx = x - 4.5, dy = y - 6.5, d = Math.sqrt(dx * dx + dy * dy);
        if (d > 3.4 && d < 4.4) return col;
        // Batıya eğik iğne
        double a = Math.toRadians(-35), ux = Math.sin(a), uy = -Math.cos(a);
        double along = dx * ux + dy * uy, across = Math.abs(dx * uy - dy * ux);
        if (Math.abs(along) < 3 && across < 0.9 - Math.abs(along) * 0.2) return along > 0 ? col : 0xFF6B6F7A;
        return 0;
    }

    private static int plus(int x, int y) {
        int cx = 4, cy = 7;
        int dx = Math.abs(x - cx), dy = Math.abs(y - cy);
        if (dx + dy <= 4) {
            if ((dx == 0 && dy <= 2) || (dy == 0 && dx <= 2)) return 0xFF2A1A08;
            return dx + dy == 4 ? 0xFFFFE7A3 : 0xFFF2B654;
        }
        return 0;
    }

    private static int shade(int c, java.util.Random r) {
        float k = 0.92f + r.nextFloat() * 0.12f;
        int a = c >>> 24, rr = Math.min(255, (int) (((c >> 16) & 255) * k)), g = Math.min(255, (int) (((c >> 8) & 255) * k)), b = Math.min(255, (int) ((c & 255) * k));
        return a << 24 | rr << 16 | g << 8 | b;
    }

    private static int mix(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255, br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
        return 0xFF000000 | (int) (ar + (br - ar) * t) << 16 | (int) (ag + (bg - ag) * t) << 8 | (int) (ab + (bb - ab) * t);
    }

    /** Modelin dokusu: 64x256, her palet rengi 32 piksellik bir şerit (hafif dokulu) */
    public static int[] atlas(Model m) {
        int[] px = new int[64 * 256];
        java.util.Random r = new java.util.Random(7);
        for (int band = 0; band < 8; band++) {
            int c = m.palette()[band];
            if (c == 0) continue;
            for (int y = 0; y < 32; y++) for (int x = 0; x < 64; x++) px[(band * 32 + y) * 64 + x] = shade(c, r);
        }
        return px;
    }

    /** Gardırop yuvaları: kimlik → başlık (Türkçe; Tr.t ile çevrilir) */
    public static final String[][] SLOTS = {
            { "cape", "Pelerin" }, { "hat", "Şapka" }, { "back", "Sırt" }, { "aura", "Aura" }, { "menuTheme", "Menü teması" } };

    /** Görünen adlar (Türkçe; Tr.t ile çevrilir) */
    public static final java.util.Map<String, String> NAMES = java.util.Map.ofEntries(
            java.util.Map.entry("cape_west", "West pelerini"), java.util.Map.entry("cape_sunset", "Gün batımı pelerini"),
            java.util.Map.entry("cape_ocean", "Okyanus pelerini"), java.util.Map.entry("cape_forest", "Orman pelerini"),
            java.util.Map.entry("cape_sakura", "Kiraz pelerini"), java.util.Map.entry("cape_nether", "Nether pelerini"),
            java.util.Map.entry("cape_end", "End pelerini"), java.util.Map.entry("cape_plus", "Plus pelerini"),
            java.util.Map.entry("hat_cap", "Kasket"), java.util.Map.entry("hat_catears", "Kedi kulakları"),
            java.util.Map.entry("hat_tophat", "Silindir şapka"), java.util.Map.entry("hat_wizard", "Büyücü şapkası"),
            java.util.Map.entry("hat_crown", "Taç"), java.util.Map.entry("hat_halo", "Hale"),
            java.util.Map.entry("back_bag", "Sırt çantası"), java.util.Map.entry("back_wings", "Melek kanatları"),
            java.util.Map.entry("back_dragon", "Ejderha kanatları"), java.util.Map.entry("back_plus_wings", "Altın kanatlar"),
            java.util.Map.entry("aura_hearts", "Kalp aurası"), java.util.Map.entry("aura_notes", "Nota aurası"),
            java.util.Map.entry("aura_flame", "Alev aurası"), java.util.Map.entry("aura_stars", "Yıldız aurası"),
            java.util.Map.entry("menu_ocean", "Okyanus menüsü"), java.util.Map.entry("menu_forest", "Orman menüsü"),
            java.util.Map.entry("menu_nether", "Nether menüsü"), java.util.Map.entry("menu_end", "End menüsü"),
            java.util.Map.entry("menu_gold", "Altın menü"));

    /** Kart rengi (önizleme) */
    public static int swatch(String id) {
        return switch (id) {
            case "cape_sunset" -> 0xFFFF9A5A; case "cape_ocean", "menu_ocean" -> 0xFF5FB2C9; case "cape_forest", "menu_forest" -> 0xFF79C08A;
            case "cape_sakura" -> 0xFFF2A6C4; case "cape_nether", "menu_nether", "aura_flame" -> 0xFFFF7A45; case "cape_end", "menu_end", "back_dragon" -> 0xFFB28CFF;
            case "cape_plus", "hat_halo", "back_plus_wings", "aura_stars", "menu_gold", "hat_crown" -> 0xFFF2B654;
            case "hat_tophat" -> 0xFFC43C3C; case "hat_wizard" -> 0xFF7B5CFF; case "hat_catears", "aura_hearts" -> 0xFFFF6F9C;
            case "back_wings" -> 0xFFF4F7FF; case "back_bag" -> 0xFFB07A45; case "aura_notes" -> 0xFF6AD0FF;
            default -> 0xFFE8A25C;
        };
    }

    /** Bir öğe hangi yuvaya takılır */
    public static String slotOf(String id) {
        if (id.startsWith("cape_")) return "cape";
        if (id.startsWith("hat_")) return "hat";
        if (id.startsWith("back_")) return "back";
        if (id.startsWith("aura_")) return "aura";
        if (id.startsWith("menu_")) return "menuTheme";
        return null;
    }

    /** Aura parçacığı türü: "heart" | "note" | "flame" | "star" */
    public static String aura(String id) {
        if (id == null) return null;
        return switch (id) {
            case "aura_hearts" -> "heart";
            case "aura_notes" -> "note";
            case "aura_flame" -> "flame";
            case "aura_stars" -> "star";
            default -> null;
        };
    }
}
