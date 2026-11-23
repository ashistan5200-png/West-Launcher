package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.List;

/**
 * West başlık ekranı: Minecraft'ın dönen panoraması ve logosu üstünde, solda kompakt düğme sütunu,
 * sağ altta "kaldığın yerden devam" kartı (son dünya + son sunucu, tek tıkla). Vanilla düzenine
 * sadık kalır; yalnızca daha derli toplu ve dikkat çekici.
 */
public final class TitleHome implements WestScreen {
    private static final String[] MODES = { Tr.t("Hayatta kalma"), Tr.t("Yaratıcı"), Tr.t("Macera"), Tr.t("İzleyici") };

    private final Ui ui = new Ui();
    private final long opened = System.nanoTime();
    private final java.util.Map<String, Float> hoverAnim = new java.util.HashMap<>();
    private long last = System.nanoTime();
    private float dt;
    private List<Game.ServerInfo> servers;
    private int tick;

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations && !WestHud.config.data.performanceMode;
        Game game = WestHud.game;
        if (servers == null || ++tick % 240 == 0) servers = game.servers(8);
        List<Game.WorldInfo> worlds = game.worlds(3);
        int sw = g.width(), sh = g.height();
        int accent = t.accent;

        // ── arka plan: panorama + soldan karartma (yazılar okunur kalsın) ──
        g.panorama(delta);
        int shade = Math.round(sw * 0.55f);
        for (int x = 0; x < shade; x += 2) {
            float k = 1 - (float) x / shade;
            g.fill(x, 0, x + 2, sh, ((int) (0xA0 * k * k)) << 24 | 0x05060A);
        }
        g.gradient(0, sh - 50, sw, sh, 0x00000000, 0x70000000);

        float in = ease(time * 2.6f);
        int pad = clamp(Math.round(sw * 0.045f), 12, 34);

        // ── logo ──
        int logoW = clamp(Math.round(sw * 0.40f), 150, 260), logoH = Math.round(logoW * 44f / 256f);
        int ly = clamp(Math.round(sh * 0.10f), 10, 40);
        int lx = pad - Math.round((1 - in) * 20);
        int alpha = (int) (255 * in) << 24 | 0xFFFFFF;
        if (!g.texture("minecraft:textures/gui/title/minecraft.png", lx, ly, logoW, logoH, 0, 0, 256, 44, 256, 64, alpha)) {
            g.push();
            g.translate(lx, ly);
            g.scale(logoW / (float) Math.max(1, g.textBoldWidth("MINECRAFT")));
            g.textBold("MINECRAFT", 0, 0, alpha, true);
            g.pop();
        }
        // West etiketi: logonun altında küçük, vurgu renkli rozet
        String tag = "WEST CLIENT";
        int tw = g.textBoldWidth(tag) + 18, th = 12, ty = ly + logoH + 5;
        Ui.round(g, lx, ty, tw, th, 6, (int) (0xE0 * in) << 24 | (accent & 0xFFFFFF));
        Icons.draw(g, Icon.LOGO, lx + 4, ty + 2, 8, 0xFF16130E);
        g.textBold(tag, lx + 14, ty + 2, 0xFF16130E, false);

        // ── düğme sütunu ──
        int colW = clamp(Math.round(sw * 0.27f), 140, 200), bh = 20, gap = 4;
        int by = Math.max(ty + th + 16, Math.round(sh * 0.40f));
        String[] labels = { Tr.t("Tek Oyunculu"), Tr.t("Çok Oyunculu"), Tr.t("Ayarlar"), Tr.t("Oyundan çık") };
        Icon[] icons = { Icon.USER, Icon.USERS, Icon.GEAR, Icon.EXIT };
        Game.Target[] targets = { Game.Target.SINGLEPLAYER, Game.Target.MULTIPLAYER, Game.Target.OPTIONS, Game.Target.QUIT };
        for (int i = 0; i < labels.length; i++) {
            float a = ease(time * 3f - i * 0.12f);
            int x = pad - Math.round((1 - a) * 24), y = by + i * (bh + gap) + (i == 3 ? 6 : 0);
            if (bigButton("b" + i, labels[i], icons[i], x, y, colW, bh, i == 0, a)) {
                game.click();
                game.open(targets[i]);
            }
        }

        // küçük simge düğmeleri
        int iy = by + 4 * (bh + gap) + 12, is = 18;
        Object[][] small = {
            { Icon.GLOBE, Tr.t("Dil"), (Runnable) () -> game.open(Game.Target.LANGUAGE) },
            { Icon.USER, Tr.t("Skin ayarları"), (Runnable) () -> game.open(Game.Target.WARDROBE) },
            { Icon.HUD, Tr.t("West menüsü"), (Runnable) () -> game.openWestScreenPage(0) },
            { Icon.FULLSCREEN, Tr.t("Tam ekran"), (Runnable) game::toggleFullscreen },
            { Icon.BACK, Tr.t("Klasik Minecraft menüsü"), (Runnable) game::openVanillaTitle },
        };
        String tip = null;
        for (int i = 0; i < small.length; i++) {
            int x = pad + i * (is + 4);
            boolean h = ui.hover(x, iy, is, is);
            float hv = anim("s" + i, h);
            Ui.round(g, x, iy, is, is, 5, mix(0x66101218, 0xCC1A1C24, hv));
            Ui.outline(g, x, iy, is, is, 5, mix(0x22FFFFFF, (0xAA << 24) | (accent & 0xFFFFFF), hv));
            Icons.draw(g, (Icon) small[i][0], x + 4, iy + 4, 10, mix(0xFFB9BDC7, 0xFFFFFFFF, hv));
            if (h) tip = (String) small[i][1];
            if (ui.clicked(x, iy, is, is)) {
                game.click();
                ((Runnable) small[i][2]).run();
            }
        }
        if (tip != null) {
            int w = g.textWidth(tip) + 10;
            Ui.round(g, pad, iy + is + 5, w, 13, 4, 0xE0101218);
            g.text(tip, pad + 5, iy + is + 8, 0xFFE6E7EA, false);
        }

        // ── kaldığın yerden devam kartı ──
        continueCard(g, worlds, sw, sh, in, accent);

        // ── alt bilgi ──
        String ver = "Minecraft " + game.minecraftVersion() + " · " + game.loaderName();
        g.text(ver, pad, sh - 12, 0x99FFFFFF, true);
        String mods = Tr.t("{0} mod", game.mods().size());
        int mw = g.textWidth(mods);
        boolean mh = ui.hover(sw - pad - mw - 2, sh - 14, mw + 4, 12);
        g.text(mods, sw - pad - mw, sh - 12, mh ? 0xFFFFFFFF : 0x99FFFFFF, true);
        if (mh) g.fill(sw - pad - mw, sh - 3, sw - pad, sh - 2, 0xAAFFFFFF);
        if (ui.clicked(sw - pad - mw - 2, sh - 14, mw + 4, 12)) {
            game.click();
            game.openWestScreenPage(4);
        }
        ui.end();
    }

    private void continueCard(Gfx g, List<Game.WorldInfo> worlds, int sw, int sh, float in, int accent) {
        Game game = WestHud.game;
        int pad = clamp(Math.round(sw * 0.045f), 12, 34);
        int cw = clamp(Math.round(sw * 0.38f), 190, 250);
        Game.WorldInfo w = worlds.isEmpty() ? null : worlds.get(0);
        Game.ServerInfo s = servers == null || servers.isEmpty() ? null : servers.get(0);
        int rowH = 34, head = 16;
        int ch = head + rowH + (s != null ? rowH + 4 : 0) + 8;
        int cx = sw - pad - cw + Math.round((1 - in) * 30), cy = sh - 22 - ch;
        Ui.round(g, cx - 1, cy + 2, cw + 2, ch + 2, 10, 0x40000000);
        Ui.round(g, cx, cy, cw, ch, 9, 0xD80D0E14);
        Ui.outline(g, cx, cy, cw, ch, 9, 0x22FFFFFF);
        // üst şerit: hafif nabız atan vurgu
        float pulse = ui.animate ? 0.5f + 0.5f * (float) Math.sin(ui.time * 2.4f) : 1f;
        g.fill(cx + 9, cy, cx + cw - 9, cy + 1, ((int) (0x70 + 0x8F * pulse)) << 24 | (accent & 0xFFFFFF));
        g.text(Tr.t("Kaldığın yerden devam et"), cx + 9, cy + 6, 0xFFB9BDC7, false);

        int ry = cy + head;
        if (w != null) {
            String sub = MODES[Math.max(0, Math.min(3, w.mode()))] + (w.hardcore() ? " · " + Tr.t("Zorlu") : "") + " · " + ago(w.lastPlayed());
            if (row(g, "w", cx + 5, ry, cw - 10, rowH, w.name(), sub, Icon.WORLD, () -> g.worldIcon(w.id(), w.iconPath(), cx + 10, ry + 5, 24), accent)) {
                game.click();
                game.joinWorld(w.id());
            }
        } else if (row(g, "new", cx + 5, ry, cw - 10, rowH, Tr.t("Yeni dünya oluştur"), Tr.t("İlk maceranı başlat"), Icon.PLUS, () -> false, accent)) {
            game.click();
            game.open(Game.Target.CREATE_WORLD);
        }
        if (s != null) {
            int sy = ry + rowH + 4;
            Game.ServerStatus st = game.serverStatus(s.address());
            String sub = st == null || st.state() == 0 ? Tr.t("Bağlanılıyor…")
                    : st.state() == 1 ? Tr.t("{0}/{1} çevrimiçi · {2} ms", st.online(), st.max(), st.ping())
                    : st.state() == 3 ? Tr.t("Uyumsuz sürüm") : Tr.t("Ulaşılamıyor");
            if (row(g, "s", cx + 5, sy, cw - 10, rowH, s.name(), sub, Icon.SERVER, () -> false, accent)) {
                game.click();
                game.joinServer(0);
            }
        }
    }

    /** Devam kartındaki satır: simge, başlık, alt yazı ve sağda oynat düğmesi */
    private boolean row(Gfx g, String key, int x, int y, int w, int h, String title, String sub, Icon icon, java.util.function.BooleanSupplier image, int accent) {
        boolean hv = ui.hover(x, y, w, h);
        float a = anim(key, hv);
        Ui.round(g, x, y, w, h, 7, mix(0x00FFFFFF, 0x14FFFFFF, a));
        if (!image.getAsBoolean()) {
            Ui.round(g, x + 5, y + 5, 24, 24, 6, 0xFF1A1C24);
            Icons.draw(g, icon, x + 11, y + 11, 12, 0xFFB9BDC7);
        }
        int tx = x + 35, maxW = w - 35 - 30;
        g.textBold(ui.fit(title, maxW), tx, y + 7, 0xFFFFFFFF, false);
        g.text(ui.fit(sub, maxW), tx, y + 19, 0xFF8D909A, false);
        // oynat düğmesi: vurgu renginde daire, üstüne gelince parlar
        int bs = 20, bx = x + w - bs - 6, byy = y + (h - bs) / 2;
        if (a > 0.01f) Ui.round(g, bx - 3, byy - 3, bs + 6, bs + 6, (bs + 6) / 2, ((int) (0x55 * a)) << 24 | (accent & 0xFFFFFF));
        Ui.round(g, bx, byy, bs, bs, bs / 2, 0xFF000000 | (accent & 0xFFFFFF));
        Icons.draw(g, Icon.PLAY, bx + 6, byy + 5, 10, 0xFF16130E);
        return ui.clicked(x, y, w, h);
    }

    /** Vanilla'ya yakın ama daha modern düğme: koyu cam, ince kenar, üstüne gelince vurgu çubuğu */
    private boolean bigButton(String key, String label, Icon icon, int x, int y, int w, int h, boolean primary, float alpha) {
        Gfx g = ui.g;
        int accent = ui.t.accent;
        boolean hv = ui.hover(x, y, w, h);
        float a = anim(key, hv);
        int base = primary ? 0xD0181A22 : 0xB0101218;
        Ui.round(g, x, y, w, h, 5, mix(base, 0xE0232631, a));
        Ui.outline(g, x, y, w, h, 5, mix(primary ? (0x66 << 24) | (accent & 0xFFFFFF) : 0x26FFFFFF, (0xDD << 24) | (accent & 0xFFFFFF), a));
        // soldan kayan vurgu çubuğu
        int bar = Math.round(3 * a + (primary ? 1 : 0));
        if (bar > 0) g.fill(x + 1, y + 4, x + 1 + bar, y + h - 4, 0xFF000000 | (accent & 0xFFFFFF));
        int ix = x + 8 + Math.round(a * 3);
        Icons.draw(g, icon, ix, y + (h - 10) / 2, 10, mix(0xFFB9BDC7, 0xFF000000 | (accent & 0xFFFFFF), a));
        int ta = (int) (255 * alpha);
        g.textBold(label, ix + 16, y + (h - 8) / 2, (ta << 24) | 0xFFFFFF, false);
        if (a > 0.05f) Icons.draw(g, Icon.CHEVRON_RIGHT, x + w - 14 + Math.round((1 - a) * -4), y + (h - 8) / 2, 8, ((int) (0xCC * a)) << 24 | 0xFFFFFF);
        return ui.clicked(x, y, w, h);
    }

    private float anim(String key, boolean on) {
        float v = hoverAnim.getOrDefault(key, 0f);
        float target = on ? 1f : 0f;
        v = ui.animate ? v + (target - v) * Math.min(1f, dt * 14f) : target;
        hoverAnim.put(key, v);
        return v;
    }

    private float ease(float x) {
        if (!ui.animate) return 1f;
        float c = Math.max(0f, Math.min(1f, x));
        return 1 - (float) Math.pow(1 - c, 3);
    }

    private static String ago(long ms) {
        long s = Math.max(0, (System.currentTimeMillis() - ms) / 1000);
        if (s < 60) return Tr.t("az önce");
        if (s < 3600) return Tr.t("{0} dk önce", s / 60);
        if (s < 86400) return Tr.t("{0} sa önce", s / 3600);
        return Tr.t("{0} gün önce", s / 86400);
    }

    private static int mix(int a, int b, float t) {
        t = Math.max(0, Math.min(1, t));
        int r = 0;
        for (int sh = 0; sh < 32; sh += 8) {
            int ca = (a >>> sh) & 0xFF, cb = (b >>> sh) & 0xFF;
            r |= Math.round(ca + (cb - ca) * t) << sh;
        }
        return r;
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
    }

    /** Başlık ekranında Esc hiçbir şey yapmaz (vanilla gibi) */
    @Override
    public WestScreen escape() {
        return this;
    }
}
