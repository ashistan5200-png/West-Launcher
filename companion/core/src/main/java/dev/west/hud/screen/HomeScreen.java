package dev.west.hud.screen;

import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * West Client ana menüsü. Minecraft'ın başlık ekranının yerine geçer:
 * solda hızlı oyna (kayıtlı sunucular), ortada logo ve düğmeler, sağda oyuncu kartı.
 */
public final class HomeScreen implements WestScreen {
    private final Ui ui = new Ui();
    private final long opened = System.nanoTime();
    private long last = System.nanoTime();
    private final Map<String, Float> hover = new HashMap<>();
    private List<Game.ServerInfo> servers;

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        Game game = WestHud.game;
        if (servers == null) servers = game.servers(4);
        int sw = g.width(), sh = g.height();
        float in = ui.animate ? ease(Math.min(1, time * 2.2f)) : 1;

        // Arka plan: dönen panorama + yumuşak karartma
        g.panorama(delta);
        g.gradient(0, 0, sw, sh, 0x66080A10, 0xCC06070B);
        g.gradient(0, 0, sw / 3, sh, 0x00000000, 0x00000000);
        for (int i = 0; i < 24; i++) { // kenar gölgesi
            int a = (int) (60 * (1 - i / 24f));
            g.fill(i, 0, i + 1, sh, a << 24);
            g.fill(sw - i - 1, 0, sw - i, sh, a << 24);
        }

        topBar(sw, in, dt);
        int side = Math.min(150, (sw - 180) / 2 - 14);
        boolean wide = side >= 88;
        if (wide) {
            quickPlay(12, 40, side, sh - 76, in, dt);
            playerCard(sw - side - 12, 40, side, in);
        }
        center(sw, sh, in, dt);

        // Alt bilgi
        String info = game.loaderName() + " " + game.minecraftVersion() + "  ·  " + game.mods().size() + " mod  ·  West Companion " + WestHud.VERSION;
        g.text(info, (sw - g.textWidth(info)) / 2, sh - 14, Theme.alpha(0xFFFFFFFF, 140), false);
        String legal = "Mojang AB";
        g.text(legal, sw - g.textWidth(legal) - 8, sh - 14, 0x66FFFFFF, false);
        ui.end();
    }

    private static float ease(float x) {
        return 1 - (float) Math.pow(1 - x, 3);
    }

    /** Fare üzerindeyken 0→1 yumuşak geçiş */
    private float hov(String id, boolean on, float dt) {
        float v = hover.getOrDefault(id, 0f);
        v += ((on ? 1 : 0) - v) * Math.min(1, dt * 14);
        hover.put(id, v);
        return v;
    }

    private void topBar(int sw, float in, float dt) {
        Theme t = ui.t;
        Gfx g = ui.g;
        int y = 10 - Math.round((1 - in) * 8);
        g.textBold("◆", 14, y + 2, t.accent, false);
        g.textBold("West", 26, y + 2, 0xFFFFFFFF, true);
        g.textBold("Client", 26 + g.textBoldWidth("West "), y + 2, t.accent, true);

        String[] icons = { "≡", "A", "✕" };
        String[] tips = { "Ayarlar", "Dil", "Oyundan çık" };
        Game.Target[] targets = { Game.Target.OPTIONS, Game.Target.LANGUAGE, Game.Target.QUIT };
        int s = 20, x = sw - 12 - icons.length * (s + 6) + 6;
        for (int i = 0; i < icons.length; i++) {
            int bx = x + i * (s + 6);
            boolean on = ui.hover(bx, y - 2, s, s);
            float h = hov("top" + i, on, dt);
            int bg = i == 2 ? Theme.mix(0x55000000, 0xEEE5566E, h) : Theme.mix(0x55000000, Theme.alpha(t.accent, 220), h);
            Ui.round(g, bx, y - 2, s, s, s / 2, bg);
            ui.border(bx, y - 2, s, s, Theme.alpha(0xFFFFFFFF, (int) (40 + 60 * h)));
            g.text(icons[i], bx + (s - g.textWidth(icons[i])) / 2, y + 4, 0xFFFFFFFF, false);
            if (on) {
                int w = g.textWidth(tips[i]) + 10;
                Ui.round(g, bx + s / 2 - w / 2, y + s + 2, w, 13, 4, 0xEE0B0B10);
                g.text(tips[i], bx + s / 2 - w / 2 + 5, y + s + 5, 0xFFFFFFFF, false);
            }
            if (ui.clicked(bx, y - 2, s, s)) {
                WestHud.game.click();
                WestHud.game.open(targets[i]);
            }
        }
    }

    private void glass(int x, int y, int w, int h) {
        Ui.round(ui.g, x, y, w, h, 10, 0x8C0D0E14);
        ui.border(x, y, w, h, 0x1FFFFFFF);
    }

    private void quickPlay(int x, int y, int w, int h, float in, float dt) {
        Gfx g = ui.g;
        Theme t = ui.t;
        x -= Math.round((1 - in) * 24);
        int ph = Math.min(h, 34 + Math.max(1, servers.size()) * 34 + 22);
        glass(x, y, w, ph);
        g.textBold("Hızlı oyna", x + 12, y + 11, 0xFFFFFFFF, false);
        int cy = y + 28;
        if (servers.isEmpty()) {
            boolean on = ui.hover(x + 8, cy, w - 16, 30);
            float hv = hov("addsrv", on, dt);
            Ui.round(g, x + 8, cy, w - 16, 30, 7, Theme.mix(0x14FFFFFF, Theme.alpha(t.accent, 60), hv));
            g.text("+ Sunucu ekle", x + 18, cy + 11, 0xFFFFFFFF, false);
            if (ui.clicked(x + 8, cy, w - 16, 30)) WestHud.game.open(Game.Target.MULTIPLAYER);
            cy += 34;
        }
        for (int i = 0; i < servers.size(); i++) {
            Game.ServerInfo s = servers.get(i);
            boolean on = ui.hover(x + 8, cy, w - 16, 30);
            float hv = hov("srv" + i, on, dt);
            int lift = Math.round(hv * 1);
            Ui.round(g, x + 8, cy - lift, w - 16, 30, 7, Theme.mix(0x14FFFFFF, Theme.alpha(t.accent, 55), hv));
            // Sunucu baş harfi rozeti
            String ch = s.name().isEmpty() ? "?" : s.name().substring(0, 1).toUpperCase();
            Ui.round(g, x + 13, cy + 5 - lift, 20, 20, 6, Theme.mix(Theme.alpha(t.accent, 90), t.accent, hv));
            g.textBold(ch, x + 13 + (20 - g.textBoldWidth(ch)) / 2, cy + 11 - lift, t.onAccent, false);
            g.text(ui.fit(s.name(), w - 60), x + 40, cy + 6 - lift, 0xFFFFFFFF, false);
            g.push();
            g.translate(x + 40, cy + 18 - lift);
            g.scale(0.75f);
            g.text(ui.fit(s.address(), (int) ((w - 60) / 0.75f)), 0, 0, 0xAAFFFFFF, false);
            g.pop();
            if (hv > 0.05f) g.text("›", x + w - 18, cy + 11 - lift, Theme.alpha(0xFFFFFFFF, (int) (255 * hv)), false);
            if (ui.clicked(x + 8, cy, w - 16, 30)) {
                WestHud.game.click();
                WestHud.game.joinServer(i);
            }
            cy += 34;
        }
        String all = "Tüm sunucular ›";
        boolean on = ui.hover(x + 12, cy + 2, g.textWidth(all), 10);
        g.text(all, x + 12, cy + 2, on ? t.accent : 0xAAFFFFFF, false);
        if (ui.clicked(x + 12, cy, g.textWidth(all), 12)) WestHud.game.open(Game.Target.MULTIPLAYER);
    }

    private void playerCard(int x, int y, int w, float in) {
        Gfx g = ui.g;
        Theme t = ui.t;
        x += Math.round((1 - in) * 24);
        int h = 112;
        glass(x, y, w, h);
        int face = 44;
        int fx = x + (w - face) / 2;
        Ui.round(g, fx - 3, y + 12, face + 6, face + 6, 9, Theme.alpha(t.accent, 160));
        g.playerFace(fx, y + 15, face);
        String name = WestHud.game.playerName();
        g.textBold(name, x + (w - g.textBoldWidth(name)) / 2, y + 68, 0xFFFFFFFF, false);
        String sub = "Minecraft " + WestHud.game.minecraftVersion();
        g.push();
        g.translate(x + w / 2f, y + 82);
        g.scale(0.8f);
        g.text(sub, -g.textWidth(sub) / 2, 0, 0xAAFFFFFF, false);
        g.pop();
        int dotX = x + w / 2 - 22;
        Ui.round(g, dotX, y + 95, 6, 6, 3, t.ok);
        g.text("Çevrimiçi", dotX + 10, y + 94, 0xCCFFFFFF, false);
    }

    private void center(int sw, int sh, float in, float dt) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int cx = sw / 2;
        int top = Math.max(44, sh / 2 - 92) + Math.round((1 - in) * 14);
        // Logo
        g.push();
        float big = sw >= 420 ? 3.2f : 2.4f;
        String w1 = "WEST";
        g.translate(cx - g.textBoldWidth(w1) * big / 2f, top);
        g.scale(big);
        g.textBold(w1, 0, 0, 0xFFFFFFFF, true);
        g.pop();
        String w2 = "C L I E N T";
        int ty = top + Math.round(9 * big) + 4;
        g.textBold(w2, cx - g.textBoldWidth(w2) / 2, ty, t.accent, false);
        // Vurgu çizgisi (nefes alır)
        float pulse = ui.animate ? 0.5f + 0.5f * (float) Math.sin(ui.time * 2) : 1;
        int lw = 30 + Math.round(10 * pulse);
        Ui.round(g, cx - lw / 2, ty + 13, lw, 2, 1, Theme.alpha(t.accent, 200));

        int bw = Math.min(170, wide(sw) ? sw - 2 * (Math.min(150, (sw - 180) / 2 - 14) + 26) : sw - 40), bh = 24, gap = 6;
        int by = ty + 26;
        if (bigButton("sp", "Tek oyunculu", "Dünyalarını aç ya da yeni dünya oluştur", cx - bw / 2, by, bw, bh, true, dt)) WestHud.game.open(Game.Target.SINGLEPLAYER);
        by += bh + gap;
        if (bigButton("mp", "Çok oyunculu", "Sunuculara katıl", cx - bw / 2, by, bw, bh, false, dt)) WestHud.game.open(Game.Target.MULTIPLAYER);
        by += bh + gap;
        int half = (bw - gap) / 2;
        if (bigButton("op", "Ayarlar", null, cx - bw / 2, by, half, bh, false, dt)) WestHud.game.open(Game.Target.OPTIONS);
        if (bigButton("wm", "West menüsü", null, cx - bw / 2 + half + gap, by, bw - half - gap, bh, false, dt)) WestHud.game.openWestScreen(false);
    }

    private static boolean wide(int sw) {
        return Math.min(150, (sw - 180) / 2 - 14) >= 88;
    }

    private boolean bigButton(String id, String label, String tip, int x, int y, int w, int h, boolean primary, float dt) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on, dt);
        int lift = Math.round(hv * 1.5f);
        int bg = primary ? Theme.mix(t.accent, Theme.mix(t.accent, 0xFFFFFFFF, 0.15f), hv) : Theme.mix(0x8C0D0E14, Theme.alpha(t.accent, 200), hv);
        if (hv > 0.02f || primary) Ui.round(g, x - 1, y + 2 - lift, w + 2, h + 1, 9, Theme.alpha(primary ? t.accent : 0xFF000000, (int) ((primary ? 50 : 30) + 40 * hv)));
        Ui.round(g, x, y - lift, w, h, 8, bg);
        if (!primary) ui.border(x, y - lift, w, h, Theme.alpha(0xFFFFFFFF, (int) (30 + 50 * hv)));
        int tc = primary || hv > 0.5f ? t.onAccent : 0xFFFFFFFF;
        g.textBold(label, x + (w - g.textBoldWidth(label)) / 2, y + (h - 8) / 2 - lift, tc, false);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
    }

    /** Ana menüde Esc hiçbir şey yapmaz */
    @Override
    public WestScreen escape() {
        return this;
    }
}
