package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

/**
 * Oyun içi duraklatma menüsü: arkada bulanık oyun, ortada oyuncu, sağda
 * "Oyuna dön" ve menü, altta kaydet ve ana menüye dön.
 */
public final class PauseMenu extends WestShell {
    private static final String[] TABS = { Tr.t("Oyun"), Tr.t("Modlar"), Tr.t("Görünüm") };
    private static final int[] PAGES = { -1, 3, 1 };

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        beginFrame(g, mx, my);
        int sw = g.width(), sh = g.height();
        float in = appear();
        Game game = WestHud.game;
        Game.Session s = game.session();

        g.blurBehind();
        g.fill(0, 0, sw, sh, 0x59080A10);
        g.gradient(0, 0, sw, TOP + 24, 0x99080A10, 0x00080A10);
        // Sağ tarafa doğru koyulaşan perde (menü okunaklı olsun)
        int fade = sw / 2;
        for (int i = 0; i < 24; i++) {
            int x0 = sw - fade + fade * i / 24, x1 = sw - fade + fade * (i + 1) / 24;
            g.fill(x0, 0, x1, sh, (int) (0x99 * (i + 1) / 24f) << 24 | 0x06070B);
        }

        // Sağ sütun
        int colW = clamp(Math.round(sw * 0.30f), 150, 240);
        int cx = sw - colW - 16 + Math.round((1 - in) * 20);
        int items = s.singleplayer() ? 7 : 5;
        int fixed = 9 + 17 + 11 + (s.singleplayer() ? 11 : 0) + 6 + 26 + 6 + 4 + 5 + 20;
        int avail = sh - 8 - (TOP + 4);
        int itemH = clamp((avail - fixed) / items, 12, 18);
        int blockH = fixed + items * itemH;
        int y = Math.max(TOP + 4, (sh - blockH) / 2 + 4);

        g.push();
        g.translate(cx, y);
        g.scale(0.7f);
        brand(g, s.singleplayer() ? Tr.t("TEK OYUNCULU") : Tr.t("ÇOK OYUNCULU"), 0, 0, 0xBBFFFFFF, 1.6f);
        g.pop();
        y += 9;
        bigText(g, ui.fit(s.title(), Math.round(colW / 1.35f)), cx, y + 3, 0xFFFFFFFF, 1.35f);
        y += 17;
        if (!s.detail().isEmpty()) g.text(ui.fit(s.detail(), colW), cx, y + 1, 0xBBFFFFFF, false);
        y += 11;
        if (s.singleplayer()) {
            Icons.draw(g, Icon.PAUSE, cx, y + 1, 7, 0xBBFFFFFF);
            smallText(g, Tr.t("Oyun duraklatıldı"), cx + 10, y + 1, 0xBBFFFFFF);
            y += 11;
        }
        y += 6;
        if (accentButton("resume", Tr.t("Oyuna dön"), null, cx, y, colW, 26)) {
            game.closeScreen();
            ui.end();
            return;
        }
        y += 26 + 6;

        if (item("opt", Icon.GEAR, Tr.t("Ayarlar"), cx, y, colW, itemH)) game.open(Game.Target.OPTIONS);
        y += itemH;
        if (s.singleplayer()) {
            if (item("wopt", Icon.GLOBE, Tr.t("Dünya seçenekleri"), cx, y, colW, itemH)) go(new ShareMenu(this));
            y += itemH;
            if (item("lan", Icon.SHARE, s.canShare() ? Tr.t("Dünyayı paylaş") : Tr.t("Dünya paylaşılıyor · davet et"), cx, y, colW, itemH)) go(new ShareMenu(this));
            y += itemH;
        }
        if (item("wd", Icon.GEM, Tr.t("Gardırop"), cx, y, colW, itemH)) go(new WardrobeScreen(this));
        y += itemH;
        if (item("adv", Icon.STAR, Tr.t("Gelişimler"), cx, y, colW, itemH)) game.open(Game.Target.ADVANCEMENTS);
        y += itemH;
        if (item("stats", Icon.STATS, Tr.t("İstatistikler"), cx, y, colW, itemH)) game.open(Game.Target.STATS);
        y += itemH;
        if (item("mods", Icon.LIST, Tr.t("Modlar"), cx, y, colW, itemH)) game.openWestScreenPage(3);
        y += itemH;
        if (item("hud", Icon.HUD, Tr.t("HUD'u düzenle"), cx, y, colW, itemH)) game.openWestScreen(true);
        y += itemH + 4;
        g.fill(cx, y, cx + colW, y + 1, 0x1FFFFFFF);
        y += 5;
        if (danger("quit", s.singleplayer() ? Tr.t("Kaydet ve ana menüye dön") : Tr.t("Bağlantıyı kes"), cx, y, colW, 20)) {
            dev.west.hud.net.Upnp.close();
            game.open(Game.Target.DISCONNECT);
            ui.end();
            return;
        }

        // Oyuncu: kendi etrafında dönen yarım gövde (kafa + gövdenin yarısı)
        int left = cx - 20;
        int bh = clamp(Math.round(sh * 0.52f), 60, 260);
        int bw = Math.round(bh * 1.05f);
        int pcx = Math.max(bw / 2 + 12, Math.min(left / 2 + 10, left - bw / 2 - 10));
        int top = TOP + Math.max(34, (sh - TOP - 40 - bh) / 2) + Math.round((1 - in) * 12);
        if (left > bw / 2 + 40) {
            g.playerBust(pcx - bw / 2, top, bw, bh, ui.time * 38f);
            g.nextLayer();
            // Gövdenin alt kısmı arkadaki bulanık oyunun rengine doğru solar (kenarlarda da yumuşak)
            int fh = Math.max(12, bh * 2 / 5), fy = top + bh - fh;
            int cols = 32, x0 = pcx - bw / 2 - bw / 5, fw = bw + 2 * (bw / 5);
            for (int i = 0; i < cols; i++) {
                float u = (i + 0.5f) / cols;
                float edge = Math.min(1, Math.min(u, 1 - u) / 0.3f);
                edge = edge * edge * (3 - 2 * edge);
                int a = Math.round(0xE6 * edge);
                int cx0 = x0 + fw * i / cols, cx1 = x0 + fw * (i + 1) / cols;
                g.gradient(cx0, fy, cx1, top + bh + 1, 0x000A0C11, (a << 24) | 0x0A0C11);
            }
            nameTag(pcx, top - 6, game.playerName(), s.title());
        }

        chips(sh, Math.min(left, cx - 12), in, false);
        topBar(sw, in, TABS, PAGES, false);
        ui.end();
    }

    private boolean item(String id, Icon icon, String label, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        if (hv > 0.01f) Ui.round(g, x - 4, y, w + 8, h, 6, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x18 * hv))));
        int shift = Math.round(hv * 2);
        Icons.draw(g, icon, x + 4 + shift, y + (h - 10) / 2, 10, Theme.mix(0xCCFFFFFF, 0xFFFFFFFF, hv));
        g.textBold(label, x + 20 + shift, y + (h - 8) / 2, Theme.mix(0xDDFFFFFF, 0xFFFFFFFF, hv), false);
        if (ui.clicked(x - 4, y, w + 8, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private boolean danger(String id, String label, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(g, x, y, w, h, 6, Theme.mix(0x33E5566E, 0x66E5566E, hv));
        Ui.outline(g, x, y, w, h, 6, Theme.alpha(0xFFE5566E, (int) (0x40 + 0x60 * hv)));
        Icons.draw(g, Icon.EXIT, x + 7, y + (h - 10) / 2, 10, 0xFFFF8094);
        g.textBold(ui.fit(label, w - 30), x + 23, y + (h - 8) / 2, 0xFFFF8094, false);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    @Override
    public boolean pausesGame() {
        return true;
    }
}
