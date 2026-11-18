package dev.west.hud.lobby;

import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Ui;

import java.util.List;

/**
 * Lobinin "shader" görünümü: gökte ay / güneş / kutup ışıkları, ışık kaynaklarının parıltısı (yerde ışık
 * havuzu ile), ışık huzmeleri, alçak sis şeritleri ve vinyet. Hepsi ekran uzayında, yumuşak dokularla
 * ({@link Gfx#soft}) çizilir; 3B sahneye ek yük getirmez.
 */
public final class LobbyFx {
    private LobbyFx() {}

    private static final float PI = (float) Math.PI;

    // ───────── Gök (sahneden önce: ağaçlar önünde kalır) ─────────

    public static void sky(Gfx g, LobbyFrame f, int sw, int sh, float hy, float t) {
        LobbyBiome b = f.scene == null ? LobbyBiome.FOREST : f.scene.biome;
        switch (b) {
            case FOREST, DESERT, SNOWY -> moon(g, sw, sh, hy, b == LobbyBiome.DESERT ? 0xFFF3E6C8 : 0xFFE6ECF8, b == LobbyBiome.DESERT ? 0x7A5A9A : 0x3C5AA8);
            default -> {
            }
        }
        if (b == LobbyBiome.SNOWY) aurora(g, sw, hy, t);
        if (b == LobbyBiome.END) {
            g.soft(Gfx.SOFT_GLOW, sw * 0.28f, hy * 0.45f, sw * 0.7f, hy * 0.9f, 0, argb(0.28f, 0x7A3BD0), true);
            g.soft(Gfx.SOFT_GLOW, sw * 0.76f, hy * 0.3f, sw * 0.55f, hy * 0.7f, 0, argb(0.22f, 0xC04AA8), true);
            g.soft(Gfx.SOFT_GLOW, sw * 0.62f, hy * 0.62f, sw * 0.9f, hy * 0.5f, 0, argb(0.18f, 0x3A2A9A), true);
        }
        if (b == LobbyBiome.BADLANDS || b == LobbyBiome.CHERRY) {
            int c = b == LobbyBiome.BADLANDS ? 0xFFB15A : 0xFFE3B8;
            float sx = sw * 0.16f, sy = hy * 0.62f;
            g.soft(Gfx.SOFT_GLOW, sx, sy, sh * 1.3f, sh * 1.0f, 0, argb(0.4f, c), true);
            g.soft(Gfx.SOFT_GLOW, sx, sy, sh * 0.32f, sh * 0.32f, 0, argb(0.75f, 0xFFF6E0), true);
            Ui.round(g, Math.round(sx - sh * 0.035f), Math.round(sy - sh * 0.035f), Math.round(sh * 0.07f), Math.round(sh * 0.07f), Math.round(sh * 0.035f), 0xFFFFF8EA);
        }
        if (b == LobbyBiome.NETHER) g.soft(Gfx.SOFT_GLOW, sw * 0.5f, hy * 1.05f, sw * 1.5f, hy * 1.1f, 0, argb(0.35f, 0xFF4A1A), true);
    }

    private static void moon(Gfx g, int sw, int sh, float hy, int disc, int halo) {
        float mx = sw * 0.74f, my = Math.max(sh * 0.12f, hy * 0.34f);
        float r = Math.max(5, sh * 0.032f);
        g.soft(Gfx.SOFT_GLOW, mx, my, sh * 0.9f, sh * 0.75f, 0, argb(0.32f, halo), true);
        g.soft(Gfx.SOFT_GLOW, mx, my, r * 7, r * 7, 0, argb(0.5f, 0xC8D6FF), true);
        int d = Math.round(r * 2);
        Ui.round(g, Math.round(mx - r), Math.round(my - r), d, d, Math.round(r), disc);
        // Kraterler
        int c = (0x38 << 24) | 0x8090B0;
        Ui.round(g, Math.round(mx - r * 0.45f), Math.round(my - r * 0.35f), Math.round(r * 0.55f), Math.round(r * 0.55f), Math.round(r * 0.27f), c);
        Ui.round(g, Math.round(mx + r * 0.15f), Math.round(my + r * 0.2f), Math.round(r * 0.4f), Math.round(r * 0.4f), Math.round(r * 0.2f), c);
    }

    /** Karlı gece: dalgalanan yeşil-mor kutup ışıkları */
    private static void aurora(Gfx g, int sw, float hy, float t) {
        int n = 26;
        for (int ribbon = 0; ribbon < 2; ribbon++) {
            float base = hy * (ribbon == 0 ? 0.3f : 0.46f);
            for (int i = 0; i <= n; i++) {
                float k = (float) i / n;
                float x = k * sw * 1.1f - sw * 0.05f;
                float y = base + (float) Math.sin(k * 5.2f + t * 0.22f + ribbon * 2) * hy * 0.07f + (float) Math.sin(k * 13f + t * 0.5f) * hy * 0.015f;
                float pulse = 0.55f + 0.45f * (float) Math.sin(t * 0.7f + k * 9 + ribbon);
                int c = mix(ribbon == 0 ? 0x3DF5A0 : 0x7A6BFF, ribbon == 0 ? 0x38C8E8 : 0xD05AE0, 0.5f + 0.5f * (float) Math.sin(k * 4 + t * 0.15f));
                float a = (ribbon == 0 ? 0.2f : 0.13f) * pulse * (float) Math.sin(k * PI);
                g.soft(Gfx.SOFT_BAND, x, y - hy * 0.08f, sw / (float) n * 2.6f, hy * 0.42f, 0, argb(a, c), true);
            }
        }
    }

    // ───────── Işık kaynakları (sahneden sonra) ─────────

    private static float[] occ = new float[0];
    private static List<float[]> occFor;
    private static int frames;

    public static void lights(Gfx g, LobbyFrame f, int sw, int sh, float t) {
        if (f.scene == null || f.light) return;
        LobbyBiome b = f.scene.biome;
        LobbyCamera cam = f.camera;
        List<float[]> lights = f.scene.lights();
        if (occFor != lights || occ.length != lights.size()) {
            occ = new float[lights.size()];
            occFor = lights;
            frames = 0;
        }
        boolean refresh = frames++ % 8 == 0;
        float strength = b.night() || b == LobbyBiome.NETHER ? 1f : 0.4f;
        float focal = (sh / 2f) / (float) Math.tan(Math.toRadians(cam.fov) / 2);
        for (int i = 0; i < lights.size(); i++) {
            float[] l = lights.get(i);
            float[] p = cam.project(l[0], l[1], l[2]);
            if (p == null || p[2] < 0.6f) continue;
            float ppu = focal / p[2];
            float rad = l[6] * ppu * 1.15f;
            if (p[0] < -rad || p[0] > sw + rad || p[1] < -rad || p[1] > sh + rad) continue;
            if (refresh) occ[i] = f.scene.occlusion(cam.eye.x, cam.eye.y, cam.eye.z, l[0], l[1], l[2]);
            float vis = 1 - occ[i];
            if (vis <= 0.02f) continue;
            float fog = 1 - Math.max(0, Math.min(1, (p[2] - b.fogStart) / Math.max(1, b.fogEnd - b.fogStart))) * 0.85f;
            float fl = l[7];
            float flick = 1 - fl * 0.22f * (0.5f + 0.5f * (float) Math.sin(t * 9.1f + i * 1.7f)) * (0.6f + 0.4f * (float) Math.sin(t * 13.7f + i));
            float k = strength * vis * fog * flick;
            // Kar ve kum gibi açık zeminlerde parıltı daha ölçülü (patlamasın)
            if (b == LobbyBiome.SNOWY || b == LobbyBiome.DESERT) k *= 0.72f;
            int col = rgb(l[3], l[4], l[5]);
            rad = Math.min(rad, sh * 0.6f);
            // Yerde ışık havuzu (yalnızca yere yakın kaynaklarda belirgin)
            float[] gp = cam.project(l[0], LobbyScene.GROUND + 1.02f, l[2]);
            if (gp != null && l[1] - LobbyScene.GROUND < 4.5f && fl >= 0.3f) {
                float gr = l[6] * 1.6f * focal / gp[2];
                g.soft(Gfx.SOFT_GLOW, gp[0], gp[1], gr * 2, gr * 0.8f, 0, argb(0.22f * k, col), true);
            }
            g.soft(Gfx.SOFT_GLOW, p[0], p[1], rad * 2, rad * 2, 0, argb(0.36f * k, col), true);
            g.soft(Gfx.SOFT_GLOW, p[0], p[1], rad * 0.7f, rad * 0.7f, 0, argb(0.42f * k, mix(col, 0xFFFFFF, 0.4f)), true);
        }
    }

    // ───────── Atmosfer (parçacıklardan sonra, arayüzden önce) ─────────

    public static void atmosphere(Gfx g, LobbyFrame f, int sw, int sh, float t, boolean vignette) {
        LobbyBiome b = f.scene == null ? LobbyBiome.FOREST : f.scene.biome;
        LobbyCamera cam = f.camera;
        float hy = cam.horizonY();
        if (!f.light) {
            // Alçak sis şeritleri: arka planda yere yakın
            if (b == LobbyBiome.FOREST || b == LobbyBiome.SNOWY || b == LobbyBiome.CHERRY || b == LobbyBiome.END) {
                float[] p = cam.project(0, LobbyScene.GROUND + 1.2f, -16);
                if (p != null) {
                    int c = b == LobbyBiome.END ? 0x6A4A9A : b == LobbyBiome.CHERRY ? 0xFFE6F0 : (b.fog & 0xFFFFFF);
                    c = mix(c, 0xFFFFFF, b == LobbyBiome.CHERRY ? 0 : 0.25f);
                    for (int i = 0; i < 3; i++) {
                        float drift = (float) Math.sin(t * 0.05f + i * 2.1f) * sw * 0.12f;
                        float y = p[1] + i * sh * 0.06f - sh * 0.03f;
                        g.soft(Gfx.SOFT_BAND, sw * (0.25f + i * 0.28f) + drift, y, sh * 0.16f, sw * 1.1f, PI / 2, argb(0.16f - i * 0.03f, c), false);
                    }
                }
            }
            // Gün ışığı huzmeleri (kiraz bahçesi, badlands)
            if (b == LobbyBiome.CHERRY || b == LobbyBiome.BADLANDS) {
                int c = b == LobbyBiome.BADLANDS ? 0xFFC88A : 0xFFF0D8;
                float sx = sw * 0.16f, sy = Math.max(-sh * 0.1f, hy * 0.62f);
                for (int i = 0; i < 6; i++) {
                    float ang = -0.95f + i * 0.21f + (float) Math.sin(t * 0.08f + i) * 0.03f;
                    float len = sh * 1.9f;
                    float cx = sx + (float) Math.sin(-ang) * len * 0.5f, cy = sy + (float) Math.cos(ang) * len * 0.5f;
                    float a = 0.13f * (0.6f + 0.4f * (float) Math.sin(t * 0.3f + i * 1.9f));
                    g.soft(Gfx.SOFT_BAND, cx, cy, sh * (0.1f + (i % 3) * 0.05f), len, ang, argb(a, c), true);
                }
            }
            // Nether: alttan lav ışığı ve sıcak hava titremesi
            if (b == LobbyBiome.NETHER) {
                float pulse = 0.8f + 0.2f * (float) Math.sin(t * 0.9f);
                g.soft(Gfx.SOFT_GLOW, sw * 0.5f, sh * 1.08f, sw * 1.7f, sh * 0.95f, 0, argb(0.32f * pulse, 0xFF5A1E), true);
            }
            // Ay ışığı: ekranın üstünden hafif soğuk ton
            if (b.night() && b != LobbyBiome.END) g.soft(Gfx.SOFT_GLOW, sw * 0.74f, 0, sw * 1.2f, sh * 1.1f, 0, argb(0.07f, 0x6080D0), true);
        }
        if (vignette) {
            float a = b.night() || b == LobbyBiome.NETHER ? 0.78f : 0.55f;
            g.soft(Gfx.SOFT_VIGNETTE, sw / 2f, sh / 2f, sw, sh, 0, argb(a, 0x05060C), false);
        }
    }

    // ───────── Yardımcılar ─────────

    private static int argb(float a, int rgb) {
        return (Math.max(0, Math.min(255, Math.round(a * 255))) << 24) | (rgb & 0xFFFFFF);
    }

    private static int rgb(float r, float g, float b) {
        return (Math.round(Math.min(1, r) * 255) << 16) | (Math.round(Math.min(1, g) * 255) << 8) | Math.round(Math.min(1, b) * 255);
    }

    private static int mix(int a, int b, float k) {
        int r = Math.round(((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k);
        int g = Math.round(((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k);
        int bl = Math.round((a & 255) * (1 - k) + (b & 255) * k);
        return (r << 16) | (g << 8) | bl;
    }
}
