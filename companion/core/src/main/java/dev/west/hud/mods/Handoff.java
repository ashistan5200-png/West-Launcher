package dev.west.hud.mods;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

/**
 * Oyunu kapatmadan mod değiştirme ("devralma").
 * <p>
 * Eski oyun: "Uygula" deyince launcher yeni mod düzeniyle ikinci bir oyunu arka planda açar; oynamaya devam edilir.
 * Yeni oyun ana menüye ulaşınca eski oyun dünyayı kaydedip kapanır. Yeni oyun açılırken çökerse eski oyun hiç
 * kapanmaz ve değişiklikler uygulanmaz.
 * <p>
 * Yeni oyun (-Dwest.handoff): simge durumunda bekler, hazır olunca launcher'a bildirir; eski oyun kapanınca
 * öne gelir ve aynı dünyaya / sunucuya girer.
 */
public final class Handoff {
    /** Bu oyun arka planda açılan yeni oturum mu */
    public static final boolean CHILD = System.getProperty("west.handoff") != null;

    private static boolean minimized, reported, done;
    private static volatile boolean inflight;
    private static long lastPoll;

    private Handoff() {}

    /** Yeni oturum hâlâ eskisinin kapanmasını mı bekliyor (müzik çalmasın, pencere küçük kalsın) */
    public static boolean waiting() {
        return CHILD && !done;
    }

    /** Oyun açılır açılmaz (pencere oluştuktan sonra) çağrılır */
    public static void early(Game game) {
        if (!CHILD || minimized || done) return;
        try {
            minimized = game.minimizeWindow(true);
        } catch (Throwable ignored) {
            // pencere henüz oluşmadı: bir sonraki tick'te tekrar
        }
    }

    /** Her tick (her iki oyunda) */
    public static void tick(Game game) {
        ModBridge api = ModBridge.INSTANCE;
        // Devraldıktan sonra bu oyun da sıradan oyundur: kendi devralmasını yönetebilir
        if (!waiting()) {
            api.pollRestart();
            return;
        }
        early(game);
        game.silenceMusic();
        if (!reported) {
            // Yükleme bitti ve bir menü açıldıysa modlar sorunsuz yüklendi demektir
            if (game.screenObject() != null && !game.inWorld()) {
                reported = true;
                api.handoffReady();
            }
            return;
        }
        long now = System.currentTimeMillis();
        if (inflight || now - lastPoll < 600) return;
        lastPoll = now;
        inflight = true;
        api.handoffStatus((state, join) -> WestHud.later(() -> {
            inflight = false;
            if (!"go".equals(state) || done) return;
            done = true;
            game.minimizeWindow(false);
            if (join != null && join.startsWith("world:")) game.joinWorld(join.substring(6));
            else if (join != null && !join.isBlank()) game.connect(join, join);
        }), () -> inflight = false);
    }

    /** Eski oyunda, devralma sürerken ekranın üstünde küçük durum şeridi */
    public static void overlay(Gfx g) {
        ModBridge api = ModBridge.INSTANCE;
        String st = api.handoffState;
        if (waiting() || st == null) return;
        long age = System.currentTimeMillis() - api.handoffAt;
        boolean failed = "failed".equals(st);
        if (failed && age > 12_000) return;
        if (!failed && !"starting".equals(st) && !"ready".equals(st)) return;
        Theme t = WestHud.theme();
        String msg = switch (st) {
            case "ready" -> Tr.t("Yeni mod düzeni hazır · geçiliyor…");
            case "failed" -> Tr.t("Yeni mod düzeni açılamadı; oyunun açık kaldı, değişiklikler uygulanmadı");
            default -> Tr.t("Yeni mod düzeni yükleniyor · {0} sn", api.handoffSecs);
        };
        String sub = failed && api.handoffError != null ? api.handoffError : null;
        int w = Math.min(g.width() - 20, Math.max(g.textWidth(msg), sub == null ? 0 : Math.min(g.width() - 40, g.textWidth(sub))) + 34);
        int h = sub == null ? 20 : 31;
        int x = (g.width() - w) / 2, y = 6;
        Ui.round(g, x, y, w, h, 10, 0xE6101118);
        Ui.outline(g, x, y, w, h, 10, failed ? 0xAAE5566E : Theme.alpha(t.accent, 0xAA));
        if (failed) Icons.draw(g, Icon.CLOSE, x + 8, y + 6, 9, 0xFFE5566E);
        else {
            float a = (System.nanoTime() / 1e9f) * 6;
            for (int i = 0; i < 6; i++) {
                double an = a + i * Math.PI / 3;
                Ui.round(g, x + 12 + (int) Math.round(Math.cos(an) * 4) - 1, y + 10 + (int) Math.round(Math.sin(an) * 4) - 1, 2, 2, 1, Theme.alpha(t.accent, 50 + i * 34));
            }
        }
        g.text(fit(g, msg, w - 30), x + 24, y + 6, 0xFFFFFFFF, false);
        if (sub != null) g.text(fit(g, sub, w - 30), x + 24, y + 18, 0xFFF08A9A, false);
    }

    private static String fit(Gfx g, String s, int max) {
        if (g.textWidth(s) <= max) return s;
        while (s.length() > 1 && g.textWidth(s + "…") > max) s = s.substring(0, s.length() - 1);
        return s + "…";
    }
}
