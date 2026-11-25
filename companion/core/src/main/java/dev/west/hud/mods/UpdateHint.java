package dev.west.hud.mods;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

/**
 * Oturum başına bir kez: dünyaya girdikten kısa süre sonra Modrinth'te güncelleme denetlenir;
 * güncellenebilir içerik varsa birkaç saniyelik bir bildirim "H → Güncellemeler"e yönlendirir.
 * Uygulama devralmayla olur: oyun kapanmaz.
 */
public final class UpdateHint {
    private static final int DELAY_TICKS = 20 * 45;
    private static final long SHOW_MS = 9000;
    private static int ticks;
    private static boolean asked, done;
    private static int count;
    private static long shownAt;

    private UpdateHint() {}

    public static void tick(Game game) {
        ModBridge api = ModBridge.INSTANCE;
        if (done || Handoff.waiting() || !api.available() || !game.inWorld()) return;
        if (!asked) {
            if (++ticks < DELAY_TICKS) return;
            asked = true;
            api.checkUpdates();
            return;
        }
        if (api.refreshing || api.loading) return;
        done = true;
        count = 0;
        for (JsonObject it : api.items) {
            JsonElement u = it.get("update");
            if (u != null && u.isJsonObject() && !ModBridge.bool(it, "managed")) count++;
        }
        if (count > 0) shownAt = System.currentTimeMillis();
    }

    public static void overlay(Gfx g) {
        if (count == 0 || shownAt == 0) return;
        long age = System.currentTimeMillis() - shownAt;
        if (age > SHOW_MS) return;
        float a = age < 250 ? age / 250f : age > SHOW_MS - 600 ? (SHOW_MS - age) / 600f : 1;
        Theme t = WestHud.theme();
        String msg = Tr.t("{0} içerik için güncelleme var", count);
        String sub = Tr.t("H → Güncellemeler · oyun kapanmadan uygulanır");
        int w = Math.max(g.textWidth(msg), g.textWidth(sub)) + 34, h = 31;
        // Üst orta: sağ üst köşe Minecraft'ın kendi bildirimlerine (başarım, öğretici) ait
        int x = (g.width() - w) / 2, y = (Handoff.CHILD ? 6 : ModBridge.INSTANCE.handoffState != null ? 44 : 6) + Math.round((1 - a) * -10);
        Ui.round(g, x, y, w, h, 10, Theme.alpha(0xFF101118, (int) (0xE6 * a)));
        Ui.outline(g, x, y, w, h, 10, Theme.alpha(t.accent, (int) (0xAA * a)));
        Icons.draw(g, Icon.STAR, x + 8, y + 7, 10, Theme.alpha(t.accent, (int) (255 * a)));
        g.text(msg, x + 24, y + 6, Theme.alpha(0xFFFFFFFF, Math.max(8, (int) (255 * a))), false);
        g.text(sub, x + 24, y + 18, Theme.alpha(0xFFB9BDC7, Math.max(8, (int) (255 * a))), false);
    }
}
