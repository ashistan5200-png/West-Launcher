package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.mods.ModBridge;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Rota;
import dev.west.hud.ui.Rota.Kind;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.List;

/**
 * West ana menüsü ("Rota"). Minecraft'ın panoraması arka planda kalır; solda launcher'ın kenar çubuğuyla aynı
 * dilde bir panel vardır:
 * <ol>
 *   <li>Birincil eylem: kaldığın dünyaya ya da sunucuya tek tıkla dön (yoksa yeni dünya oluştur)</li>
 *   <li>Gezinme: Oyna (tek/çok oyunculu) ve West (Mod Merkezi, West menüsü)</li>
 *   <li>Altta: ayarlar, dil, skin, tam ekran; oyuncu; çıkış</li>
 * </ol>
 * Sağ altta yüklüyse Essential / Flashback kısayolları. Kısa ekranlarda bölüm başlıkları ve sunucu satırı düşer.
 */
public final class TitleHome implements WestScreen {
    private static final String[] MODES = { Tr.t("Hayatta kalma"), Tr.t("Yaratıcı"), Tr.t("Macera"), Tr.t("İzleyici") };

    private final Ui ui = new Ui();
    private final Rota.Anim anim = new Rota.Anim();
    private final long opened = System.nanoTime();
    private List<Game.ServerInfo> servers;
    private int tick;
    private final dev.west.hud.compat.ModCards cards = new dev.west.hud.compat.ModCards();

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        anim.frame();
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations && !WestHud.config.data.performanceMode;
        Game game = WestHud.game;
        if (servers == null || ++tick % 240 == 0) servers = game.servers(4);
        List<Game.WorldInfo> worlds = game.worlds(1);
        int sw = g.width(), sh = g.height();

        g.panorama(delta);
        float in = ease(time * 3f);

        // ── panel ──
        int dw = Rota.clamp(Math.round(sw * 0.3f), 172, 230);
        int dx = -Math.round((1 - in) * dw);
        Rota.dock(g, dx, 0, dw, sh);
        int pad = 12, x = dx + pad, w = dw - pad * 2;
        boolean roomy = sh >= 300;
        int y = roomy ? 16 : 10;

        // Logo + alt yazı
        int logoW = Math.min(w, 200), logoH = Math.round(logoW * 44f / 256f);
        if (!g.texture("minecraft:textures/gui/title/minecraft.png", x, y, logoW, logoH, 0, 0, 256, 44, 256, 64, 0xFFFFFFFF)) {
            g.textBold("MINECRAFT", x, y + 4, Rota.TEXT, false);
            logoH = 16;
        }
        y += logoH + 4;
        Icons.draw(g, Icon.LOGO, x, y, 8, t.accent | 0xFF000000);
        Rota.small(g, Tr.t("West Client · {0} {1}", game.loaderName(), game.minecraftVersion()), x + 12, y + 1, Rota.MUTED);
        y += roomy ? 22 : 16;

        // ── birincil: kaldığın yerden ──
        y = continueBlock(g, game, worlds, x, y, w, roomy);
        y += roomy ? 14 : 8;

        // ── gezinme ──
        if (roomy) {
            Rota.section(g, Tr.t("Oyna"), x + 2, y);
            y += 11;
        }
        if (nav(Icon.USER, Tr.t("Tek oyunculu"), x, y, w, 0, false)) game.open(Game.Target.SINGLEPLAYER);
        y += 20;
        if (nav(Icon.USERS, Tr.t("Çok oyunculu"), x, y, w, 0, false)) game.open(Game.Target.MULTIPLAYER);
        y += roomy ? 28 : 22;
        if (roomy) {
            Rota.section(g, Tr.t("West"), x + 2, y);
            y += 11;
        }
        ModBridge hub = ModBridge.INSTANCE;
        if (hub.available()) {
            hub.ensureLoaded();
            if (nav(Icon.BOX, Tr.t("Mod Merkezi"), x, y, w, hub.pending.size(), true)) game.openModHub();
            y += 20;
        }
        if (nav(Icon.HUD, Tr.t("West menüsü"), x, y, w, 0, false)) game.openWestScreenPage(0);
        y += 20;

        // ── alt: oyuncu + ayar simgeleri + çıkış ──
        int by = sh - 14 - 18 - 8 - 20;
        Rota.rule(g, x, by - 8, w);
        g.playerFace(x + 1, by + 1, 16);
        g.textBold(ui.fit(game.playerName(), w - 24), x + 22, by + 5, Rota.TEXT, false);
        by += 26;
        Object[][] icons = {
            { Icon.GEAR, Tr.t("Ayarlar"), (Runnable) () -> game.open(Game.Target.OPTIONS) },
            { Icon.GLOBE, Tr.t("Dil"), (Runnable) () -> game.open(Game.Target.LANGUAGE) },
            { Icon.USER, Tr.t("Skin ayarları"), (Runnable) () -> game.open(Game.Target.WARDROBE) },
            { Icon.FULLSCREEN, Tr.t("Tam ekran"), (Runnable) game::toggleFullscreen },
            { Icon.BACK, Tr.t("Klasik Minecraft menüsü"), (Runnable) game::openVanillaTitle },
        };
        String tip = null;
        for (int i = 0; i < icons.length; i++) {
            int ix = x + i * 22;
            if (ui.hover(ix, by, 18, 18)) tip = (String) icons[i][1];
            if (Rota.iconButton(ui, anim, "i" + i, (Icon) icons[i][0], ix, by, 18, 0)) {
                game.click();
                ((Runnable) icons[i][2]).run();
            }
        }
        if (Rota.iconButton(ui, anim, "quit", Icon.EXIT, x + w - 18, by, 18, Rota.DANGER)) {
            game.click();
            game.open(Game.Target.QUIT);
        }
        if (ui.hover(x + w - 18, by, 18, 18)) tip = Tr.t("Oyundan çık");
        // Alt bilgi: mod sayısı (tıklanınca West menüsü → Yüklü modlar)
        String mods = Tr.t("{0} mod yüklü", game.mods().size());
        boolean mh = ui.hover(x, sh - 13, Rota.smallWidth(g, mods) + 2, 10);
        Rota.small(g, mods, x, sh - 12, mh ? Rota.TEXT : Rota.FAINT);
        if (ui.clicked(x, sh - 13, Rota.smallWidth(g, mods) + 2, 10)) {
            game.click();
            game.openWestScreenPage(4);
        }
        if (tip != null) tooltip(g, tip, Math.min(mx + 10, sw - g.textWidth(tip) - 16), my - 18);

        // ── sağ alt: Essential / Flashback ──
        cards.showHub = false;
        int cw = Rota.clamp(Math.round(sw * 0.3f), 160, 220);
        cards.render(g, sw - cw - 12, sh - 12, cw, mx, my, false);
        ui.end();
    }

    /** Kaldığın dünya (birincil düğmeyle) ve varsa son sunucu; bloğun altını döner */
    private int continueBlock(Gfx g, Game game, List<Game.WorldInfo> worlds, int x, int y, int w, boolean roomy) {
        Game.WorldInfo wo = worlds.isEmpty() ? null : worlds.get(0);
        if (roomy) {
            Rota.section(g, Tr.t("Kaldığın yerden"), x + 2, y);
            y += 11;
        }
        int h = 52;
        boolean hv = ui.hover(x, y, w, h);
        Rota.card(g, x, y, w, h, anim.get("cont", hv));
        if (wo != null) {
            if (!g.worldIcon(wo.id(), wo.iconPath(), x + 6, y + 6, 20)) {
                Ui.round(g, x + 6, y + 6, 20, 20, Rota.RADIUS_SM, 0xFF22242B);
                Icons.draw(g, Icon.WORLD, x + 11, y + 11, 10, Rota.MUTED);
            }
            g.textBold(ui.fit(wo.name(), w - 40), x + 32, y + 7, Rota.TEXT, false);
            String sub = MODES[Math.max(0, Math.min(3, wo.mode()))] + (wo.hardcore() ? " · " + Tr.t("Zorlu") : "") + " · " + ago(wo.lastPlayed());
            Rota.smallFit(ui, sub, x + 32, y + 18, w - 40, Rota.MUTED);
            if (Rota.button(ui, anim, "play", Tr.t("Dünyaya gir"), Icon.PLAY, Kind.PRIMARY, x + 6, y + 30, w - 12, 16, true)) {
                game.click();
                game.joinWorld(wo.id());
            }
        } else {
            g.textBold(Tr.t("Henüz dünya yok"), x + 8, y + 7, Rota.TEXT, false);
            Rota.smallFit(ui, Tr.t("İlk maceranı başlat"), x + 8, y + 18, w - 16, Rota.MUTED);
            if (Rota.button(ui, anim, "new", Tr.t("Yeni dünya oluştur"), Icon.PLUS, Kind.PRIMARY, x + 6, y + 30, w - 12, 16, true)) {
                game.click();
                game.open(Game.Target.CREATE_WORLD);
            }
        }
        y += h;
        Game.ServerInfo s = servers == null || servers.isEmpty() ? null : servers.get(0);
        if (s != null && roomy) {
            y += 4;
            int rh = 26;
            boolean sh = ui.hover(x, y, w, rh);
            Rota.card(g, x, y, w, rh, anim.get("srv", sh));
            Icons.draw(g, Icon.SERVER, x + 8, y + 8, 10, Rota.MUTED);
            Game.ServerStatus st = game.serverStatus(s.address());
            boolean up = st != null && st.state() == 1;
            String sub = st == null || st.state() == 0 ? Tr.t("Bağlanılıyor…")
                    : up ? Tr.t("{0}/{1} çevrimiçi · {2} ms", st.online(), st.max(), st.ping())
                    : st.state() == 3 ? Tr.t("Uyumsuz sürüm") : Tr.t("Ulaşılamıyor");
            g.text(ui.fit(s.name(), w - 40), x + 24, y + 4, Rota.TEXT, false);
            Rota.smallFit(ui, sub, x + 24, y + 15, w - 40, up ? 0xFF8BE3B0 : Rota.FAINT);
            Icons.draw(g, Icon.CHEVRON_RIGHT, x + w - 14, y + 9, 8, sh ? Rota.TEXT : Rota.FAINT);
            if (ui.clicked(x, y, w, rh)) {
                game.click();
                game.joinServer(0);
            }
            y += rh;
        }
        return y;
    }

    private boolean nav(Icon icon, String label, int x, int y, int w, int badge, boolean warn) {
        float hv = anim.get("n" + label, ui.hover(x, y, w, 18));
        if (Rota.nav(ui, icon, label, x + 6, y, w - 6, false, hv, badge, warn)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private void tooltip(Gfx g, String s, int x, int y) {
        g.nextLayer();
        int w = g.textWidth(s) + 10;
        Ui.round(g, x, y, w, 13, Rota.RADIUS_SM, 0xF015161B);
        Ui.outline(g, x, y, w, 13, Rota.RADIUS_SM, Rota.LINE_STRONG);
        g.text(s, x + 5, y + 3, Rota.TEXT, false);
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

    @Override
    public void mouseClicked(double x, double y, int button) {
        if (button == 0 && cards.click(x, y)) return;
        ui.click((int) x, (int) y, button);
    }

    /** Başlık ekranında Esc hiçbir şey yapmaz (vanilla gibi) */
    @Override
    public WestScreen escape() {
        return this;
    }
}
