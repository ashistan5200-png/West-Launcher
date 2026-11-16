package dev.west.hud.ui;

import dev.west.hud.api.Gfx;

/**
 * Pürüzsüz vektör ikonlar. Her ikon bir mesafe fonksiyonu (SDF) olarak tanımlıdır ve
 * ekran piksellerinde kenar yumuşatmalı çizilir; yazı tipinde olmayan simgeler (⚙ gibi)
 * böylece hiçbir GUI ölçeğinde pikselli görünmez.
 */
public final class Icons {
    private Icons() {}

    public enum Icon { GLOBE, GEAR, SLIDERS, FULLSCREEN, CLOSE, PLUS, ARROW, USER, USER_PLUS, CHART, PLAY, KEYBOARD, LOGO, CHECK, CLOCK, SERVER, WORLD,
        BACK, SEARCH, SHARE, STAR, STATS, LIST, EXIT, PAUSE, MOUSE, PIN, SIGNAL, GAUGE, CHIP, SHIELD, COMPASS, SUN, TEXT, MAGNET, HUD, BOX, EDIT, FOLDER,
        USERS, NOTE, NOTE_OFF, BELL, CHEVRON_DOWN, CHEVRON_RIGHT, GEM, CHAT, MOON }

    @FunctionalInterface
    private interface Sdf {
        /** u,v: ikon içinde -1..1; dönüş: aynı birimde işaretli mesafe (içeride negatif) */
        double d(double u, double v);
    }

    /** İkonu (x,y) GUI pikseline size×size boyutunda çiz. */
    public static void draw(Gfx g, Icon icon, int x, int y, int size, int color) {
        Sdf f = sdf(icon);
        int k = Math.max(1, g.guiScale());
        int S = size * k, X = x * k, Y = y * k;
        double unit = 2.0 / S; // bir ekran pikselinin ikon birimindeki boyu
        int a0 = color >>> 24, rgb = color & 0xFFFFFF;
        g.push();
        g.scale(1f / k);
        for (int py = 0; py < S; py++) {
            double v = (py + 0.5) * unit - 1;
            int runStart = -1;
            for (int px = 0; px <= S; px++) {
                double cov = 0;
                if (px < S) {
                    double u = (px + 0.5) * unit - 1;
                    cov = Math.max(0, Math.min(1, 0.5 - f.d(u, v) / unit));
                }
                if (cov >= 0.999) {
                    if (runStart < 0) runStart = px;
                    continue;
                }
                if (runStart >= 0) {
                    g.fill(X + runStart, Y + py, X + px, Y + py + 1, color);
                    runStart = -1;
                }
                if (cov > 0.02) g.fill(X + px, Y + py, X + px + 1, Y + py + 1, ((int) (a0 * cov) << 24) | rgb);
            }
        }
        g.pop();
    }

    // ---- Temel şekiller ----
    private static double circle(double u, double v, double cx, double cy, double r) {
        return Math.hypot(u - cx, v - cy) - r;
    }

    private static double ring(double u, double v, double cx, double cy, double r, double t) {
        return Math.abs(circle(u, v, cx, cy, r)) - t / 2;
    }

    private static double seg(double u, double v, double ax, double ay, double bx, double by, double t) {
        double pax = u - ax, pay = v - ay, bax = bx - ax, bay = by - ay;
        double h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
        return Math.hypot(pax - bax * h, pay - bay * h) - t / 2;
    }

    private static double box(double u, double v, double cx, double cy, double hw, double hh, double r) {
        double qx = Math.abs(u - cx) - hw + r, qy = Math.abs(v - cy) - hh + r;
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }

    private static double boxRing(double u, double v, double cx, double cy, double hw, double hh, double r, double t) {
        return Math.abs(box(u, v, cx, cy, hw, hh, r)) - t / 2;
    }

    private static double min(double... ds) {
        double m = ds[0];
        for (double d : ds) m = Math.min(m, d);
        return m;
    }

    private static final double T = 0.16; // çizgi kalınlığı

    private static Sdf sdf(Icon icon) {
        return switch (icon) {
            case GLOBE -> (u, v) -> {
                double outer = ring(u, v, 0, 0, 0.82, T);
                // Dikey elips (meridyen)
                double e = Math.abs(Math.hypot(u / 0.42, v / 0.82) - 1) * 0.42 - T / 2;
                double eq = Math.max(seg(u, v, -0.82, 0, 0.82, 0, T), circle(u, v, 0, 0, 0.82));
                double lat1 = Math.max(seg(u, v, -0.7, -0.42, 0.7, -0.42, T * 0.85), circle(u, v, 0, 0, 0.8));
                double lat2 = Math.max(seg(u, v, -0.7, 0.42, 0.7, 0.42, T * 0.85), circle(u, v, 0, 0, 0.8));
                return min(outer, e, eq, lat1, lat2);
            };
            case GEAR -> (u, v) -> {
                double r = Math.hypot(u, v), a = Math.atan2(v, u);
                double teeth = Math.max(0, Math.min(1, (Math.cos(a * 8) - 0.1) * 3));
                double outer = r - (0.62 + 0.24 * teeth);
                double hole = -(r - 0.3);
                return Math.max(outer, hole);
            };
            case SLIDERS -> (u, v) -> min(
                    seg(u, v, -0.8, -0.45, 0.8, -0.45, T), circle(u, v, 0.3, -0.45, 0.24),
                    seg(u, v, -0.8, 0.45, 0.8, 0.45, T), circle(u, v, -0.3, 0.45, 0.24));
            case FULLSCREEN -> (u, v) -> {
                double au = Math.abs(u), av = Math.abs(v);
                return Math.min(seg(au, av, 0.8, 0.8, 0.8, 0.3, T), seg(au, av, 0.8, 0.8, 0.3, 0.8, T));
            };
            case CLOSE -> (u, v) -> Math.min(seg(u, v, -0.62, -0.62, 0.62, 0.62, T * 1.05), seg(u, v, -0.62, 0.62, 0.62, -0.62, T * 1.05));
            case PLUS -> (u, v) -> Math.min(seg(u, v, -0.7, 0, 0.7, 0, T * 1.05), seg(u, v, 0, -0.7, 0, 0.7, T * 1.05));
            case ARROW -> (u, v) -> min(seg(u, v, -0.7, 0, 0.7, 0, T), seg(u, v, 0.7, 0, 0.25, -0.45, T), seg(u, v, 0.7, 0, 0.25, 0.45, T));
            case USER -> (u, v) -> Math.min(ring(u, v, 0, -0.38, 0.34, T),
                    Math.max(ring(u, v, 0, 0.95, 0.68, T), v - 0.8));
            case USER_PLUS -> (u, v) -> min(ring(u, v, -0.2, -0.38, 0.32, T),
                    Math.max(ring(u, v, -0.2, 0.95, 0.62, T), v - 0.8),
                    seg(u, v, 0.66, -0.25, 0.66, 0.35, T), seg(u, v, 0.36, 0.05, 0.96, 0.05, T));
            case CHART -> (u, v) -> min(boxRing(u, v, 0, 0, 0.82, 0.7, 0.18, T),
                    seg(u, v, -0.5, 0.3, -0.15, -0.05, T), seg(u, v, -0.15, -0.05, 0.12, 0.18, T), seg(u, v, 0.12, 0.18, 0.52, -0.3, T));
            case PLAY -> (u, v) -> {
                // Yuvarlatılmış üçgen
                double x = u + 0.12;
                double d1 = -x - 0.45;
                double d2 = (x * 0.866 + Math.abs(v) * 1.0) / 1.32 - 0.38;
                return Math.max(d1, d2) - 0.05;
            };
            case KEYBOARD -> (u, v) -> min(boxRing(u, v, 0, 0, 0.88, 0.58, 0.18, T),
                    box(u, v, -0.45, -0.18, 0.09, 0.09, 0.03), box(u, v, -0.15, -0.18, 0.09, 0.09, 0.03),
                    box(u, v, 0.15, -0.18, 0.09, 0.09, 0.03), box(u, v, 0.45, -0.18, 0.09, 0.09, 0.03),
                    seg(u, v, -0.35, 0.22, 0.35, 0.22, T * 0.9));
            case LOGO -> (u, v) -> {
                // West işareti: dış elmas çerçeve + içte dolu küçük elmas
                double outer = Math.abs(Math.abs(u) + Math.abs(v) - 0.78) - 0.11;
                double inner = Math.abs(u) + Math.abs(v) - 0.34;
                return Math.min(outer, inner) * 0.72;
            };
            case CHECK -> (u, v) -> Math.min(seg(u, v, -0.62, 0.02, -0.18, 0.46, T * 1.1), seg(u, v, -0.18, 0.46, 0.66, -0.42, T * 1.1));
            case CLOCK -> (u, v) -> min(ring(u, v, 0, 0, 0.8, T), seg(u, v, 0, 0, 0, -0.45, T), seg(u, v, 0, 0, 0.32, 0.2, T));
            case SERVER -> (u, v) -> min(boxRing(u, v, 0, -0.4, 0.8, 0.32, 0.12, T), boxRing(u, v, 0, 0.4, 0.8, 0.32, 0.12, T),
                    circle(u, v, -0.45, -0.4, 0.09), circle(u, v, -0.45, 0.4, 0.09));
            case BACK -> (u, v) -> min(seg(u, v, -0.7, 0, 0.7, 0, T), seg(u, v, -0.7, 0, -0.25, -0.45, T), seg(u, v, -0.7, 0, -0.25, 0.45, T));
            case SEARCH -> (u, v) -> Math.min(ring(u, v, -0.15, -0.15, 0.5, T), seg(u, v, 0.22, 0.22, 0.72, 0.72, T * 1.1));
            case SHARE -> (u, v) -> min(ring(u, v, 0, 0, 0.8, T), seg(u, v, -0.4, 0, 0.35, 0, T), seg(u, v, 0.35, 0, 0.05, -0.3, T), seg(u, v, 0.35, 0, 0.05, 0.3, T));
            case STAR -> (u, v) -> {
                double a = Math.atan2(v, u) + Math.PI / 2, r = Math.hypot(u, v);
                double k = Math.PI * 2 / 5;
                double m = Math.abs(((a % k) + k) % k - k / 2) / (k / 2);
                double edge = 0.38 + 0.45 * m * m;
                return Math.abs(r - edge * 0.95) - T / 2;
            };
            case STATS -> (u, v) -> min(boxRing(u, v, -0.45, 0.2, 0.17, 0.55, 0.08, T), boxRing(u, v, 0.1, -0.05, 0.17, 0.8, 0.08, T), boxRing(u, v, 0.62, 0.35, 0.15, 0.4, 0.08, T));
            case LIST -> (u, v) -> min(seg(u, v, -0.3, -0.55, 0.8, -0.55, T), seg(u, v, -0.3, 0, 0.8, 0, T), seg(u, v, -0.3, 0.55, 0.8, 0.55, T),
                    circle(u, v, -0.7, -0.55, 0.11), circle(u, v, -0.7, 0, 0.11), circle(u, v, -0.7, 0.55, 0.11));
            case EXIT -> (u, v) -> min(Math.max(ring(u, v, 0, 0, 0.78, T), -Math.max(0.1 - u, Math.abs(v) - 0.42)),
                    seg(u, v, -0.15, 0, 0.85, 0, T), seg(u, v, 0.85, 0, 0.55, -0.3, T), seg(u, v, 0.85, 0, 0.55, 0.3, T));
            case PAUSE -> (u, v) -> Math.min(box(u, v, -0.3, 0, 0.13, 0.62, 0.06), box(u, v, 0.3, 0, 0.13, 0.62, 0.06));
            case MOUSE -> (u, v) -> min(boxRing(u, v, 0, 0, 0.5, 0.8, 0.48, T), seg(u, v, 0, -0.5, 0, -0.2, T));
            case PIN -> (u, v) -> {
                double head = ring(u, v, 0, -0.25, 0.48, T);
                double tip = Math.min(seg(u, v, -0.36, 0.08, 0, 0.82, T), seg(u, v, 0.36, 0.08, 0, 0.82, T));
                return min(Math.max(head, v - 0.12), tip, circle(u, v, 0, -0.25, 0.14));
            };
            case SIGNAL -> (u, v) -> min(box(u, v, -0.6, 0.5, 0.11, 0.25, 0.04), box(u, v, -0.2, 0.3, 0.11, 0.45, 0.04), box(u, v, 0.2, 0.1, 0.11, 0.65, 0.04), box(u, v, 0.6, -0.05, 0.11, 0.8, 0.04));
            case GAUGE -> (u, v) -> min(Math.max(ring(u, v, 0, 0.25, 0.75, T), v - 0.3), seg(u, v, 0, 0.25, 0.4, -0.2, T), circle(u, v, 0, 0.25, 0.12));
            case CHIP -> (u, v) -> min(boxRing(u, v, 0, 0, 0.5, 0.5, 0.1, T), box(u, v, 0, 0, 0.2, 0.2, 0.04),
                    seg(u, v, -0.25, -0.62, -0.25, -0.85, T * 0.8), seg(u, v, 0.25, -0.62, 0.25, -0.85, T * 0.8), seg(u, v, -0.25, 0.62, -0.25, 0.85, T * 0.8), seg(u, v, 0.25, 0.62, 0.25, 0.85, T * 0.8),
                    seg(u, v, -0.62, -0.25, -0.85, -0.25, T * 0.8), seg(u, v, -0.62, 0.25, -0.85, 0.25, T * 0.8), seg(u, v, 0.62, -0.25, 0.85, -0.25, T * 0.8), seg(u, v, 0.62, 0.25, 0.85, 0.25, T * 0.8));
            case SHIELD -> (u, v) -> {
                double top = Math.max(Math.abs(u) - 0.65, -0.7 - v);
                double bottom = Math.hypot(u, (v - 0.0) * 0.9) - 0.75;
                double shape = v < 0 ? top : Math.max(Math.abs(u) - 0.65, bottom);
                return Math.abs(shape) - T / 2;
            };
            case COMPASS -> (u, v) -> min(ring(u, v, 0, 0, 0.8, T), seg(u, v, -0.25, 0.25, 0.3, -0.3, T * 1.6));
            case SUN -> (u, v) -> {
                double d = circle(u, v, 0, 0, 0.32);
                for (int i = 0; i < 8; i++) {
                    double a = i * Math.PI / 4;
                    d = Math.min(d, seg(u, v, Math.cos(a) * 0.55, Math.sin(a) * 0.55, Math.cos(a) * 0.82, Math.sin(a) * 0.82, T));
                }
                return d;
            };
            case TEXT -> (u, v) -> min(seg(u, v, -0.75, 0.65, -0.35, -0.6, T), seg(u, v, -0.35, -0.6, 0.05, 0.65, T), seg(u, v, -0.6, 0.2, -0.1, 0.2, T),
                    ring(u, v, 0.5, 0.35, 0.28, T), seg(u, v, 0.78, 0.0, 0.78, 0.65, T));
            case MAGNET -> (u, v) -> min(Math.max(ring(u, v, 0, 0, 0.55, T * 2), v), seg(u, v, -0.55, 0, -0.55, 0.7, T * 2), seg(u, v, 0.55, 0, 0.55, 0.7, T * 2));
            case HUD -> (u, v) -> min(boxRing(u, v, 0, 0, 0.82, 0.7, 0.16, T), box(u, v, -0.45, -0.32, 0.2, 0.12, 0.04), box(u, v, 0.45, 0.35, 0.2, 0.12, 0.04));
            case BOX -> (u, v) -> {
                double au = Math.abs(u);
                double outline = Math.min(seg(u, v, 0, -0.8, 0.75, -0.42, T), seg(u, v, 0, -0.8, -0.75, -0.42, T));
                outline = min(outline, seg(au, v, 0.75, -0.42, 0.75, 0.42, T), seg(u, v, 0, 0.8, 0.75, 0.42, T), seg(u, v, 0, 0.8, -0.75, 0.42, T),
                        seg(u, v, 0, -0.05, 0.75, -0.42, T), seg(u, v, 0, -0.05, -0.75, -0.42, T), seg(u, v, 0, -0.05, 0, 0.8, T));
                return outline;
            };
            case EDIT -> (u, v) -> min(seg(u, v, -0.55, 0.55, 0.45, -0.45, T * 1.6), seg(u, v, -0.75, 0.75, -0.6, 0.6, T));
            case FOLDER -> (u, v) -> min(boxRing(u, v, 0, 0.12, 0.82, 0.58, 0.12, T), seg(u, v, -0.75, -0.48, -0.15, -0.48, T), seg(u, v, -0.15, -0.48, 0.05, -0.3, T));
            case USERS -> (u, v) -> min(ring(u, v, -0.25, -0.38, 0.3, T), Math.max(ring(u, v, -0.25, 0.85, 0.6, T), v - 0.75),
                    Math.max(ring(u, v, 0.42, -0.42, 0.24, T), -u + 0.25), Math.max(Math.max(ring(u, v, 0.45, 0.75, 0.48, T), v - 0.68), -u + 0.42));
            case NOTE -> (u, v) -> min(circle(u, v, -0.38, 0.5, 0.24), seg(u, v, -0.16, 0.5, -0.16, -0.72, T), seg(u, v, -0.16, -0.72, 0.5, -0.5, T), seg(u, v, 0.5, -0.5, 0.5, 0.0, T));
            case NOTE_OFF -> (u, v) -> min(circle(u, v, -0.38, 0.5, 0.24), seg(u, v, -0.16, 0.5, -0.16, -0.72, T), seg(u, v, -0.16, -0.72, 0.5, -0.5, T),
                    seg(u, v, -0.8, -0.8, 0.8, 0.8, T));
            case BELL -> (u, v) -> min(Math.max(ring(u, v, 0, 0.0, 0.55, T), v - 0.0), seg(u, v, -0.55, 0.0, -0.62, 0.48, T), seg(u, v, 0.55, 0.0, 0.62, 0.48, T),
                    seg(u, v, -0.72, 0.5, 0.72, 0.5, T), seg(u, v, -0.15, 0.75, 0.15, 0.75, T), seg(u, v, 0, -0.55, 0, -0.72, T));
            case CHEVRON_DOWN -> (u, v) -> Math.min(seg(u, v, -0.5, -0.22, 0, 0.28, T * 1.1), seg(u, v, 0, 0.28, 0.5, -0.22, T * 1.1));
            case CHEVRON_RIGHT -> (u, v) -> Math.min(seg(u, v, -0.22, -0.5, 0.28, 0, T * 1.1), seg(u, v, 0.28, 0, -0.22, 0.5, T * 1.1));
            case GEM -> (u, v) -> min(seg(u, v, -0.75, -0.25, -0.4, -0.65, T), seg(u, v, -0.4, -0.65, 0.4, -0.65, T), seg(u, v, 0.4, -0.65, 0.75, -0.25, T),
                    seg(u, v, -0.75, -0.25, 0, 0.75, T), seg(u, v, 0.75, -0.25, 0, 0.75, T), seg(u, v, -0.75, -0.25, 0.75, -0.25, T),
                    seg(u, v, -0.2, -0.25, 0, 0.75, T * 0.8), seg(u, v, 0.2, -0.25, 0, 0.75, T * 0.8));
            case CHAT -> (u, v) -> min(boxRing(u, v, 0.05, -0.12, 0.72, 0.5, 0.25, T), seg(u, v, -0.35, 0.36, -0.55, 0.72, T), seg(u, v, -0.55, 0.72, -0.05, 0.38, T));
            case MOON -> (u, v) -> Math.abs(Math.max(circle(u, v, 0, 0, 0.72), -circle(u, v, 0.38, -0.3, 0.6))) - T / 2;
            case WORLD -> (u, v) -> min(boxRing(u, v, 0, 0, 0.8, 0.8, 0.2, T),
                    seg(u, v, -0.55, 0.45, -0.1, -0.1, T), seg(u, v, -0.1, -0.1, 0.15, 0.2, T), seg(u, v, 0.15, 0.2, 0.55, -0.3, T));
        };
    }
}
