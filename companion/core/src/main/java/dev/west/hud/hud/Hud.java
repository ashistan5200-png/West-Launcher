package dev.west.hud.hud;

import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/** Tüm HUD öğeleri ve oyun içi çizimleri. */
public final class Hud {
    public final Cps cps = new Cps();
    public final List<HudElement> elements = new ArrayList<>();
    public final Keystrokes keystrokes = new Keystrokes(cps);
    public final Armor armor = new Armor();
    public final Compass compass = new Compass();

    // Hız: blok/saniye (yatay), yumuşatılmış
    private double lastX = Double.NaN, lastZ;
    private long lastT;
    private double speed;

    private static final DateTimeFormatter CLOCK = DateTimeFormatter.ofPattern("HH:mm");

    public Hud() {
        elements.add(new TextElement("fps", "FPS", "Saniyedeki kare sayısı.", true, TextElement.Corner.TOP_LEFT, 0,
                g -> new String[] { String.valueOf(g.fps()), "FPS" }));
        elements.add(new TextElement("cps", "CPS", "Saniyedeki sol ve sağ tık sayısı.", false, TextElement.Corner.TOP_LEFT, 1,
                g -> new String[] { cps.left() + " | " + cps.right(), "CPS" }));
        elements.add(new TextElement("coords", "Koordinatlar", "Konumun ve baktığın yön.", false, TextElement.Corner.TOP_LEFT, 2,
                g -> new String[] { String.format("%d  %d  %d", (int) Math.floor(g.x()), (int) Math.floor(g.y()), (int) Math.floor(g.z())), facing(g.yaw()) }));
        elements.add(new TextElement("ping", "Ping", "Sunucuya gecikme.", false, TextElement.Corner.TOP_LEFT, 3,
                g -> g.ping() < 0 ? new String[] { "Tek oyunculu", "" } : new String[] { String.valueOf(g.ping()), "ms" }));
        elements.add(new TextElement("speed", "Hız", "Yatay hızın (blok/saniye).", false, TextElement.Corner.TOP_LEFT, 4,
                g -> new String[] { String.format("%.1f", speed), "b/s" }));
        elements.add(new TextElement("clock", "Saat", "Bilgisayarının saati.", false, TextElement.Corner.TOP_RIGHT, 0,
                g -> new String[] { LocalTime.now().format(CLOCK), "" }));
        elements.add(new TextElement("memory", "Bellek", "Oyunun kullandığı bellek.", false, TextElement.Corner.TOP_RIGHT, 1,
                g -> {
                    Runtime r = Runtime.getRuntime();
                    long used = (r.totalMemory() - r.freeMemory()) >> 20, max = r.maxMemory() >> 20;
                    return new String[] { (used * 100 / Math.max(1, max)) + "%", String.format("%.1f/%.1f GB", used / 1024f, max / 1024f) };
                }));
        elements.add(new TextElement("server", "Sunucu", "Bağlı olduğun sunucunun adresi.", false, TextElement.Corner.TOP_RIGHT, 2,
                g -> new String[] { g.server() == null ? "Tek oyunculu" : g.server(), "" }));
        elements.add(keystrokes);
        elements.add(armor);
        elements.add(compass);
    }

    public HudElement byId(String id) {
        for (HudElement e : elements) if (e.id.equals(id)) return e;
        return null;
    }

    /** "Kuzey (-Z)" gibi bakış yönü */
    public static String facing(float yaw) {
        float y = ((yaw % 360) + 360) % 360;
        int i = Math.round(y / 90f) % 4;
        return switch (i) {
            case 0 -> "Güney +Z";
            case 1 -> "Batı -X";
            case 2 -> "Kuzey -Z";
            default -> "Doğu +X";
        };
    }

    private void track(Game game) {
        cps.update(game);
        long now = System.nanoTime();
        double x = game.x(), z = game.z();
        if (!Double.isNaN(lastX)) {
            double dt = (now - lastT) / 1e9;
            if (dt > 0.05) {
                double v = Math.hypot(x - lastX, z - lastZ) / dt;
                speed = speed * 0.6 + Math.min(v, 200) * 0.4;
                lastX = x;
                lastZ = z;
                lastT = now;
            }
        } else {
            lastX = x;
            lastZ = z;
            lastT = now;
        }
    }

    /** Oyun HUD'u çizilirken her karede. Düzenleyici açıkken çizilmez (o kendisi çizer). */
    public void render(Gfx g, Game game, Theme t, boolean editorOpen) {
        if (!game.inWorld()) return;
        track(game);
        if (editorOpen || game.hudHidden() || game.debugOpen()) return;
        int sw = g.width(), sh = g.height();
        for (HudElement e : elements) {
            if (!e.enabled) continue;
            drawElement(g, game, t, e, sw, sh);
        }
    }

    /** Öğeyi konumuna ve ölçeğine göre çizer; ekrandaki kutusunu {x, y, w, h} döner. */
    public static int[] drawElement(Gfx g, Game game, Theme t, HudElement e, int sw, int sh) {
        int[] s = e.size(g, game);
        int w = Math.round(s[0] * e.scale), h = Math.round(s[1] * e.scale);
        int[] p = e.pixelPos(sw, sh, w, h);
        g.push();
        g.translate(p[0], p[1]);
        g.scale(e.scale);
        try {
            e.draw(g, game, t, s[0], s[1]);
        } finally {
            g.pop();
        }
        return new int[] { p[0], p[1], w, h };
    }
}
