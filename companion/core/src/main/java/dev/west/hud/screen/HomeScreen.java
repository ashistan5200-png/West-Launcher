package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * West Client ana menüsü (Minecraft'ın başlık ekranının yerine).
 * Ana sayfa: ortada oyuncunun 3B modeli, sağ altta Tek/Çok oyunculu oyna kartı.
 * Dünyalar / Sunucular sayfaları: arama, liste ve seçilenin ayrıntıları.
 */
public final class HomeScreen extends WestShell {
    private static final String[] MODES = { Tr.t("Hayatta kalma"), Tr.t("Yaratıcı"), Tr.t("Macera"), Tr.t("İzleyici") };
    private static final String[] TABS = { Tr.t("Oyna"), Tr.t("Modlar"), Tr.t("Görünüm"), Tr.t("Genel") };
    private static final int[] PAGES = { -1, 3, 1, 2 };

    enum Page { HOME, WORLDS, SERVERS, STATS, SOCIAL }

    final SocialPage social = new SocialPage();

    private Page page = Page.HOME;
    List<Game.ServerInfo> servers;
    List<Game.WorldInfo> worlds = List.of();
    private int worldsTries;
    private static int selWorld, selServer;
    private long lastRowClick;
    private int lastRowIndex = -1;
    private String search = "";
    private boolean searchFocus;
    private float scroll, scrollTarget;
    private int listTop, listBottom, listContent;

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        beginFrame(g, mx, my);
        Game game = WestHud.game;
        if (servers == null) servers = game.servers(64);
        // Listeler başka ekranlardan dönünce değişmiş olabilir: dünyalar önbellekten, sunucular ~2 sn'de bir
        worlds = game.worlds(64);
        if (++worldsTries % 120 == 0) servers = game.servers(64);
        int sw = g.width(), sh = g.height();
        float in = appear();

        // Arka plan: dönen köy panoraması + hafif karartma ve süzülen ışık zerreleri
        g.panorama(delta);
        motes(g, sw, sh);
        if (page == Page.HOME) {
            home(sw, sh, in);
        } else {
            g.blurBehind();
            g.fill(0, 0, sw, sh, 0x8C080A10);
            int cw = clamp(Math.round(sw * 0.32f), 158, 218);
            int cardX = sw - cw - 10;
            int cardY = playCard(cardX, sh, cw, in);
            if (page == Page.STATS) StatsPage.render(this, 10, TOP + 4, cardX - 20, sh - 18 - 26 - 8 - (TOP + 4), cardX, cardY, cw);
            else if (page == Page.SOCIAL) social.render(this, 10, TOP + 4, cardX - 20, sh - 18 - 26 - 8 - (TOP + 4), cardX, cardY, cw);
            else listPage(cardX, cardY, cw, sw, sh, in);
            chips(sh, cardX - 12, in, false);
            int tab = page == Page.STATS ? 1 : page == Page.SOCIAL ? 2 : 0;
            int clicked = topTabs(sw, in, tab);
            if (clicked == 0) open(Page.WORLDS);
            else if (clicked == 1) open(Page.STATS);
            else if (clicked == 2) open(Page.SOCIAL);
            footer(sw, sh);
        }

        ui.end();
    }

    // ───────── Arka plan fotoğrafı ─────────

    private static final float[][] MOTES = new float[34][];

    static {
        java.util.Random r = new java.util.Random(11);
        for (int i = 0; i < MOTES.length; i++) MOTES[i] = new float[] { r.nextFloat(), r.nextFloat(), 0.6f + r.nextFloat() * 1.6f, r.nextFloat() * 6.28f, 0.4f + r.nextFloat() };
    }


    /** Havada süzülen sıcak ışık zerreleri ve okunurluk için hafif karartma */
    private void motes(Gfx g, int sw, int sh) {
        float time = ui.time;
        for (float[] m : MOTES) {
            float y = (m[1] - time * 0.012f * m[4]) % 1f;
            if (y < 0) y += 1;
            float x = m[0] + 0.015f * (float) Math.sin(time * 0.6f * m[4] + m[3]);
            int px = Math.round(x * sw), py = Math.round(y * sh);
            float tw = 0.5f + 0.5f * (float) Math.sin(time * 1.7f * m[4] + m[3]);
            int s = Math.max(1, Math.round(m[2]));
            int a = (int) (40 + 110 * tw * Math.min(1, y * 3));
            Ui.round(g, px, py, s + 1, s + 1, (s + 1) / 2, (a << 24) | 0xFFE2B0);
        }
        g.fill(0, 0, sw, sh, 0x2605060A);
    }

    // ───────── Ana sayfa ─────────

    private boolean quickOpen = true;

    private void home(int sw, int sh, float in) {
        Gfx g = ui.g;
        Theme t = ui.t;
        Game game = WestHud.game;
        g.gradient(0, sh * 2 / 3, sw, sh, 0x00000000, 0x80000000);
        g.gradient(0, 0, sw, 60, 0x55000000, 0x00000000);

        int bh = clamp(Math.round(sh * 0.062f), 18, 34);
        int gap = Math.max(4, bh / 5);
        int colW = clamp(Math.round(sw * 0.34f), 160, 330);
        int cx = sw / 2;

        // Logo + yazı
        int L = clamp(Math.round(sh * 0.11f), 22, 70);
        float ws = Math.max(1.4f, Math.min(4.2f, sh / 150f));
        int wordH = Math.round(9 * ws);
        int blockH = L + 8 + wordH + 16 + 4 * bh + 3 * gap;
        int top = Math.max(18, (sh - blockH) / 2 - Math.round(sh * 0.03f)) + Math.round((1 - in) * 10);
        Icons.draw(g, Icon.LOGO, cx - L / 2, top, L, 0xFFFFFFFF);
        String word = Tr.t("WEST CLIENT");
        float sp = 1.1f;
        int ww = 0;
        for (char c : word.toCharArray()) ww += g.textBoldWidth(String.valueOf(c));
        float total = (ww + sp * (word.length() - 1)) * ws;
        g.push();
        g.translate(cx - total / 2f, top + L + 8);
        g.scale(ws);
        brand(g, word, 0, 0, 0xFFFFFFFF, sp);
        g.pop();

        int by = top + L + 8 + wordH + 16;
        int bx = cx - colW / 2;
        if (slate("sp", Icon.USER, Tr.t("Tek oyunculu"), bx, by, colW, bh, false)) open(Page.WORLDS);
        if (slate("mp", Icon.USERS, Tr.t("Çok oyunculu"), bx, by + (bh + gap), colW, bh, false)) open(Page.SERVERS);
        if (slate("st", Icon.STATS, Tr.t("İstatistikler"), bx, by + 2 * (bh + gap), colW, bh, false)) open(Page.STATS);
        int half = (colW - gap) / 2;
        if (slate("op", Icon.GEAR, Tr.t("Ayarlar"), bx, by + 3 * (bh + gap), half, bh, false)) game.open(Game.Target.OPTIONS);
        if (slate("md", Icon.SLIDERS, Tr.t("Modlar"), bx + half + gap, by + 3 * (bh + gap), colW - half - gap, bh, false)) game.openWestScreenPage(3);

        // Sol: hızlı oyna
        int sideW = clamp(Math.round(sw * 0.23f), 130, 250);
        int lx = 12 - Math.round((1 - in) * 20);
        int ly = Math.round(sh * 0.19f);
        if (slate("qp", Icon.SHARE, Tr.t("Hızlı oyna"), lx, ly, sideW, bh, false)) quickOpen = !quickOpen;
        Icons.draw(g, quickOpen ? Icon.CHEVRON_DOWN : Icon.CHEVRON_RIGHT, lx + sideW - bh / 2 - 5, ly + bh / 2 - 4, 8, 0xCCFFFFFF);
        if (quickOpen) {
            int ry = ly + bh + gap;
            int shown = 0;
            for (int i = 0; i < worlds.size() && shown < 2; i++, shown++) {
                Game.WorldInfo wi = worlds.get(i);
                String id = wi.id();
                if (quickRow("qw" + i, wi.name(), Tr.t("Tek oyunculu · ") + mode(wi), wi, null, lx, ry, sideW, Math.round(bh * 1.5f)))
                    startTransition(() -> WestHud.game.joinWorld(id), sw - 12 - sideW / 2f, sh * 0.35f);
                ry += Math.round(bh * 1.5f) + gap;
            }
            for (int i = 0; i < servers.size() && shown < 3; i++, shown++) {
                Game.ServerInfo si = servers.get(i);
                int idx = i;
                if (quickRow("qs" + i, si.name(), Tr.t("Çok oyunculu · ") + si.address(), null, si, lx, ry, sideW, Math.round(bh * 1.5f)))
                    startTransition(() -> WestHud.game.joinServer(idx), sw - 12 - sideW / 2f, sh * 0.35f);
                ry += Math.round(bh * 1.5f) + gap;
            }
            if (shown == 0) {
                smallText(g, Tr.t("Henüz dünya ya da sunucu yok"), lx + 8, ry + 2, 0xAAFFFFFF);
            }
        }

        // Sağ: dönen yarım gövde, hesap, paylaş, sosyal, gardırop
        int rx = sw - 12 - sideW + Math.round((1 - in) * 20);
        int accY = by;
        int bustTop = Math.max(36, Math.round(sh * 0.15f));
        int bustH = accY - 8 - bustTop;
        if (bustH > 30) {
            float yaw = ui.time * 38f;
            int bw = Math.min(sideW, Math.round(bustH * 1.05f));
            int bxx = rx + (sideW - bw) / 2;
            g.playerBust(bxx, bustTop, bw, bustH, yaw);
            g.nextLayer();
            // Alt kenarı fotoğrafa doğru yumuşakça erit
            fadeIntoPhoto(g, bxx - 2, bustTop + bustH - Math.max(10, bustH / 4), bw + 4, Math.max(10, bustH / 4) + 1);
        }
        String name = game.playerName();
        boolean accOn = ui.hover(rx, accY, sideW, bh);
        float ah = hov("acc", accOn);
        slateBg(rx, accY, sideW, bh, ah);
        int fs = bh - 8;
        Ui.round(g, rx + 4, accY + 4, fs, fs, 4, Theme.alpha(t.accent, 0xCC));
        g.playerFace(rx + 5, accY + 5, fs - 2);
        g.textBold(ui.fit(name, sideW - fs - 40), rx + (sideW - g.textBoldWidth(name)) / 2, accY + (bh - 8) / 2, 0xFFFFFFFF, false);
        Icons.draw(g, Icon.CHEVRON_DOWN, rx + sideW - bh / 2 - 5, accY + bh / 2 - 4, 8, 0xCCFFFFFF);
        if (ui.clicked(rx, accY, sideW, bh)) {
            game.click();
            open(Page.SOCIAL);
        }
        if (slate("host", Icon.SHARE, Tr.t("Dünyayı paylaş"), rx, by + (bh + gap), sideW, bh, false)) open(Page.WORLDS);
        boolean pending = social.pendingCount() > 0;
        if (slate("soc", Icon.CHAT, Tr.t("Sosyal"), rx, by + 2 * (bh + gap), sideW, bh, false)) open(Page.SOCIAL);
        if (pending) Ui.round(g, rx + sideW - 14, by + 2 * (bh + gap) + bh / 2 - 3, 6, 6, 3, t.accent | 0xFF000000);
        if (slate("wd", Icon.GEM, Tr.t("Gardırop"), rx, by + 3 * (bh + gap), sideW, bh, false)) go(new WardrobeScreen(this));

        // Sağ üst simgeler
        int s = clamp(bh, 18, 30), x = sw - 10 - s, y = 10;
        if (topIcon("quit", Icon.CLOSE, x, y, s, Tr.t("Oyundan çık"), 0xFFE5566E)) game.open(Game.Target.QUIT);
        x -= s + 6;
        if (topIcon("fs", Icon.FULLSCREEN, x, y, s, game.fullscreen() ? Tr.t("Pencere") : Tr.t("Tam ekran"), 0)) game.toggleFullscreen();
        x -= s + 6;
        if (topIcon("bell", Icon.BELL, x, y, s, Tr.t("Bildirimler"), 0)) open(Page.SOCIAL);
        if (pending) Ui.round(g, x + s - 7, y + 3, 5, 5, 3, t.accent | 0xFF000000);
        x -= s + 6;
        boolean musicOn = WestHud.config.data.music;
        if (topIcon("music", musicOn ? Icon.NOTE : Icon.NOTE_OFF, x, y, s, musicOn ? Tr.t("Müziği kapat") : Tr.t("Müziği aç"), 0)) {
            WestHud.config.data.music = !musicOn;
            WestHud.save();
        }
        x -= s + 6;
        if (topIcon("lang", Icon.GLOBE, x, y, s, Tr.t("Dil"), 0)) game.open(Game.Target.LANGUAGE);
        x -= s + 6;
        if (topIcon("west", Icon.LOGO, x, y, s, Tr.t("West menüsü"), 0)) game.openWestScreen(false);

        // Alt orta: yüklü modlar
        int cs = s;
        if (topIcon("mods", Icon.BOX, cx - cs / 2, sh - cs - 8, cs, Tr.t("Yüklü modlar"), 0)) game.openWestScreenPage(4);

        // Alt köşeler
        int fy = sh - 13;
        Icons.draw(g, Icon.LOGO, 10, fy - 2, 10, 0xFFFFFFFF);
        int e = brand(g, Tr.t("WEST CLIENT"), 24, fy, 0xFFFFFFFF, 0.6f);
        g.text(game.loaderName() + " " + game.minecraftVersion(), e + 8, fy, 0xAAFFFFFF, false);
        String legal = Tr.t("Copyright Mojang AB. Do not distribute!");
        g.push();
        g.translate(sw - 10 - small(g, legal), fy + 1);
        g.scale(0.8f);
        g.text(legal, 0, 0, 0xAAFFFFFF, false);
        g.pop();
    }

    /** Modelin alt kenarı arka plana doğru yumuşakça solar (kenarlarda da) */
    private void fadeIntoPhoto(Gfx g, int x, int y, int w, int h) {
        int cols = 28, x0 = x - w / 6, fw = w + w / 3;
        for (int i = 0; i < cols; i++) {
            float u = (i + 0.5f) / cols;
            float e = Math.min(1, Math.min(u, 1 - u) / 0.3f);
            e = e * e * (3 - 2 * e);
            int a = Math.round(0xD8 * e);
            g.gradient(x0 + fw * i / cols, y, x0 + fw * (i + 1) / cols, y + h, 0x000B0D12, (a << 24) | 0x0B0D12);
        }
    }

    private void slateBg(int x, int y, int w, int h, float hv) {
        Theme t = ui.t;
        Ui.round(ui.g, x, y, w, h, 6, Theme.mix(0xE6151A22, 0xF0222935, hv));
        Ui.outline(ui.g, x, y, w, h, 6, Theme.mix(0x26FFFFFF, Theme.alpha(t.accent, 0xAA), hv));
    }

    /** Ana sayfanın koyu "arduvaz" düğmesi */
    private boolean slate(String id, Icon icon, String label, int x, int y, int w, int h, boolean accent) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        slateBg(x, y, w, h, hv);
        String l = ui.fit(label, w - 40);
        int is = Math.min(14, h - 8);
        int total = is + 7 + g.textBoldWidth(l);
        int lx = x + (w - total) / 2;
        Icons.draw(g, icon, lx, y + (h - is) / 2, is, 0xFFFFFFFF);
        g.textBold(l, lx + is + 7, y + (h - 8) / 2, 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private boolean quickRow(String id, String title, String sub, Game.WorldInfo wi, Game.ServerInfo si, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(g, x, y, w, h, 6, Theme.mix(0xB3151A22, 0xE0222935, hv));
        Ui.outline(g, x, y, w, h, 6, Theme.mix(0x1AFFFFFF, 0x40FFFFFF, hv));
        int is = h - 10;
        if (wi != null) worldIcon(wi, x + 5, y + 5, is);
        else serverBadge(si, x + 5, y + 5, is, true);
        int tx = x + 5 + is + 8, tw = w - (tx - x) - 18;
        g.textBold(ui.fit(title, tw), tx, y + h / 2 - 10, 0xFFFFFFFF, false);
        smallText(g, ui.fit(sub, (int) (tw / 0.8f)), tx, y + h / 2 + 2, 0xAAFFFFFF);
        Icons.draw(g, Icon.CHEVRON_RIGHT, x + w - 14, y + h / 2 - 4, 8, Theme.mix(0x99FFFFFF, 0xFFFFFFFF, hv));
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private boolean topIcon(String id, Icon icon, int x, int y, int s, String tip, int danger) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, s, s);
        float hv = hov(id, on);
        Ui.round(g, x, y, s, s, 6, danger != 0 ? Theme.mix(0xE6151A22, Theme.alpha(danger, 0xE6), hv) : Theme.mix(0xE6151A22, 0xF0262E3A, hv));
        Ui.outline(g, x, y, s, s, 6, Theme.alpha(0xFFFFFFFF, (int) (0x22 + 0x30 * hv)));
        int pad = Math.max(4, s / 4);
        Icons.draw(g, icon, x + pad, y + pad, s - 2 * pad, 0xFFFFFFFF);
        if (on && tip != null) {
            int w = g.textWidth(tip) + 10;
            int tx = Math.min(g.width() - w - 4, Math.max(4, x + s / 2 - w / 2));
            int ty = y + s + 4 > g.height() - 20 ? y - 18 : y + s + 4;
            Ui.round(g, tx, ty, w, 14, 5, 0xF00C0D12);
            Ui.outline(g, tx, ty, w, 14, 5, 0x22FFFFFF);
            g.text(tip, tx + 5, ty + 3, 0xFFFFFFFF, false);
        }
        if (ui.clicked(x, y, s, s)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    /** Alt sayfalardaki üst çubuk; tıklanan sekmenin sırası ya da -1 */
    private int topTabs(int sw, float in, int active) {
        String[] tabs = { Tr.t("Oyna"), Tr.t("İstatistikler"), Tr.t("Sosyal"), Tr.t("Modlar"), Tr.t("Görünüm") };
        int[] pages = { -1, -1, -1, 3, 1 };
        // WestShell.topBar ilk sekmeyi etkin sayar; sekmeleri etkin olan başta olacak şekilde döndür
        String[] order = new String[tabs.length];
        int[] map = new int[tabs.length];
        order[0] = tabs[active];
        map[0] = active;
        for (int i = 0, k = 1; i < tabs.length; i++) if (i != active) { order[k] = tabs[i]; map[k++] = i; }
        int[] pg = new int[tabs.length];
        for (int i = 0; i < tabs.length; i++) pg[i] = pages[map[i]];
        int hit = topBar(sw, in, order, pg, true, map);
        return hit;
    }

    /** Dünyaya / sunucuya doğrudan gir (geçiş animasyonu yok) */
    void startTransition(Runnable action, float px, float py) {
        action.run();
    }


    void goHome() {
        page = Page.HOME;
        searchFocus = false;
    }

    void open(Page p) {
        if (p == Page.STATS) StatsPage.reset();
        page = p;
        search = "";
        searchFocus = false;
        scroll = scrollTarget = 0;
        if (p == Page.WORLDS || p == Page.SERVERS) WestHud.config.data.homeTab = p == Page.SERVERS ? 1 : 0;
    }

    /** Sağ alttaki oyna kartı; kartın üst y'sini döndürür. */
    private int playCard(int x, int sh, int w, float in) {
        Gfx g = ui.g;
        Theme t = ui.t;
        Game game = WestHud.game;
        int tab = WestHud.config.data.homeTab == 1 ? 1 : 0;
        boolean sp = tab == 0;
        int count = sp ? worlds.size() : servers.size();
        int bottom = sh - 18 + Math.round((1 - in) * 16);
        int maxContent = sh - 18 - 87 - TOP - 10;
        int rows = Math.max(1, Math.min(count, Math.min(page == Page.HOME ? 3 : 1, maxContent / 30)));
        int content = count == 0 ? 50 : rows * 30;
        int h = 6 + 20 + 6 + content + 6 + 26 + 6 + 1 + 16;
        int y = bottom - h;

        Ui.round(g, x - 1, y + 2, w + 2, h + 1, 11, 0x40000000);
        Ui.round(g, x, y, w, h, 10, 0xD60D0E15);
        Ui.outline(g, x, y, w, h, 10, 0x1FFFFFFF);

        int sx = x + 6, sy = y + 6, sww = w - 12;
        Ui.round(g, sx, sy, sww, 20, 7, 0x80000000);
        float slide = anim.getOrDefault("seg", (float) tab);
        slide += (tab - slide) * Math.min(1, dt * 16);
        anim.put("seg", slide);
        int half = sww / 2;
        Ui.round(g, sx + 2 + Math.round(slide * (half - 2)), sy + 2, half - 2, 16, 6, t.accent | 0xFF000000);
        String[] labels = { Tr.t("Tek oyunculu"), Tr.t("Çok oyunculu") };
        for (int i = 0; i < 2; i++) {
            int lx = sx + i * half;
            boolean active = i == tab;
            String l = ui.fit(labels[i], half - 6);
            int lw = g.textBoldWidth(l);
            g.textBold(l, lx + Math.max(3, (half - lw) / 2), sy + 6, active ? t.onAccent : (ui.hover(lx, sy, half, 20) ? 0xFFFFFFFF : 0xAAFFFFFF), false);
            if (!active && ui.clicked(lx, sy, half, 20)) {
                game.click();
                WestHud.config.data.homeTab = i;
                WestHud.save();
                if (page != Page.HOME) open(i == 0 ? Page.WORLDS : Page.SERVERS);
            }
        }

        int cy = sy + 26;
        if (count == 0) {
            emptyCard(x + 6, cy, w - 12, sp);
        } else {
            int sel = Math.min(sp ? selWorld : selServer, count - 1);
            int first = Math.max(0, Math.min(sel - rows + 1, count - rows));
            for (int r = 0; r < rows; r++) row(x + 6, cy + r * 30, w - 12, 28, first + r, first + r == sel, sp, "c");
        }
        cy += content + 6;

        String label;
        Runnable action;
        if (count == 0) {
            label = sp ? Tr.t("Dünya oluştur") : Tr.t("Sunucu ekle");
            action = () -> game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
        } else if (sp) {
            Game.WorldInfo wi = worlds.get(Math.min(selWorld, count - 1));
            label = Tr.t("Oyna");
            action = () -> startTransition(() -> game.joinWorld(wi.id()), g.width() / 2f, g.height() / 2f);
        } else {
            int si = Math.min(selServer, count - 1);
            label = Tr.t("Katıl");
            action = () -> startTransition(() -> game.joinServer(si), g.width() / 2f, g.height() / 2f);
        }
        if (accentButton("play", label, count == 0 ? Icon.PLUS : Icon.PLAY, x + 6, cy, w - 12, 26)) action.run();
        cy += 26 + 6;
        g.fill(x + 1, cy, x + w - 1, cy + 1, 0x14FFFFFF);
        cy += 1;

        smallText(g, count + Tr.t(" kayıtlı"), x + 9, cy + 5, 0x88FFFFFF);
        boolean onList = page != Page.HOME;
        String all = onList ? Tr.t("Ana sayfa") : sp ? Tr.t("Tüm dünyalar") : Tr.t("Tüm sunucular");
        int aw = small(g, all) + 18;
        int ax = x + w - 6 - aw;
        float hv = hov("all", ui.hover(ax, cy + 1, aw, 13));
        Ui.round(g, ax, cy + 1, aw, 13, 4, Theme.mix(0x14FFFFFF, 0x30FFFFFF, hv));
        smallText(g, all, ax + 5, cy + 4, 0xDDFFFFFF);
        Icons.draw(g, onList ? Icon.BACK : Icon.ARROW, ax + aw - 11, cy + 4, 7, 0xDDFFFFFF);
        if (ui.clicked(ax, cy + 1, aw, 13)) {
            game.click();
            if (onList) goHome();
            else open(sp ? Page.WORLDS : Page.SERVERS);
        }
        int px = ax - 17;
        Ui.round(g, px, cy + 1, 13, 13, 4, Theme.mix(0x14FFFFFF, Theme.alpha(t.accent, 0xCC), hov("new", ui.hover(px, cy + 1, 13, 13))));
        Icons.draw(g, Icon.PLUS, px + 3, cy + 4, 7, 0xFFFFFFFF);
        if (ui.clicked(px, cy + 1, 13, 13)) {
            game.click();
            game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
        }
        return y;
    }

    private void emptyCard(int x, int y, int w, boolean sp) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int box = 40;
        Ui.round(g, x, y + 4, box, box, 8, 0x66000000);
        Ui.outline(g, x, y + 4, box, box, 8, 0x1FFFFFFF);
        Icons.draw(g, sp ? Icon.WORLD : Icon.GLOBE, x + 10, y + 14, 20, 0xDDFFFFFF);
        int tx = x + box + 8;
        g.textBold(ui.fit(sp ? Tr.t("Henüz dünya yok") : Tr.t("Henüz sunucu yok"), w - box - 8), tx, y + 7, 0xFFFFFFFF, false);
        smallText(g, ui.fit(sp ? Tr.t("İlk dünyanı oluştur") : Tr.t("Oynamak için bir tane ekle"), (int) ((w - box - 8) / 0.8f)), tx, y + 19, 0x99FFFFFF);
        String add = sp ? Tr.t("Oluştur") : Tr.t("Ekle");
        int bw = small(g, add) + 22;
        boolean on = ui.hover(tx, y + 30, bw, 14);
        Ui.round(g, tx, y + 30, bw, 14, 4, Theme.mix(0x10FFFFFF, Theme.alpha(t.accent, 0x50), hov("emptyadd", on)));
        Ui.outline(g, tx, y + 30, bw, 14, 4, 0x33FFFFFF);
        Icons.draw(g, Icon.PLUS, tx + 5, y + 33, 8, 0xFFFFFFFF);
        smallText(g, add, tx + 16, y + 34, 0xFFFFFFFF);
        if (ui.clicked(tx, y + 30, bw, 14)) {
            WestHud.game.click();
            WestHud.game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
        }
    }

    /** Bir dünya / sunucu satırı (kartta ve liste sayfasında ortak) */
    private void row(int x, int y, int w, int h, int i, boolean selected, boolean sp, String ns) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(ns + (sp ? "w" : "s") + i, on);
        if (selected) {
            Ui.round(g, x, y, w, h, 7, Theme.alpha(t.accent, 0x2E));
            Ui.outline(g, x, y, w, h, 7, Theme.alpha(t.accent, 0xB0));
        } else if (hv > 0.01f) {
            Ui.round(g, x, y, w, h, 7, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x14 * hv))));
        }
        String title, sub;
        int is = h - 6, ix = x + 3, iy = y + 3;
        if (sp) {
            Game.WorldInfo wi = worlds.get(i);
            title = wi.name();
            sub = ago(wi.lastPlayed()) + " · " + mode(wi);
            worldIcon(wi, ix, iy, is);
        } else {
            Game.ServerInfo si = servers.get(i);
            title = si.name();
            sub = si.address();
            serverBadge(si, ix, iy, is, selected);
        }
        int tx = ix + is + 7, tw = w - (tx - x) - 6;
        boolean wide = h >= 32;
        if (wide && (on || selected)) {
            String act = sp ? Tr.t("Oyna") : Tr.t("Katıl");
            int bw = g.textBoldWidth(act) + 30;
            if (accentButton(ns + "act" + i, act, Icon.PLAY, x + w - bw - 6, y + (h - 18) / 2, bw, 18)) {
                joinRow(sp, i);
                return;
            }
            tw -= bw + 6;
        }
        g.textBold(ui.fit(title, tw), tx, y + (h - 20) / 2 + 1, 0xFFFFFFFF, false);
        smallText(g, ui.fit(sub, (int) (tw / 0.8f)), tx, y + (h - 20) / 2 + 13, 0x88FFFFFF);
        if (ui.clicked(x, y, w, h)) {
            long now = System.currentTimeMillis();
            boolean dbl = lastRowIndex == i && now - lastRowClick < 400;
            lastRowClick = now;
            lastRowIndex = i;
            WestHud.game.click();
            if (sp) selWorld = i;
            else selServer = i;
            if (dbl) joinRow(sp, i);
        }
    }

    private void joinRow(boolean sp, int i) {
        Gfx g = ui.g;
        if (sp) {
            String id = worlds.get(i).id();
            startTransition(() -> WestHud.game.joinWorld(id), g.width() / 2f, g.height() / 2f);
        } else {
            startTransition(() -> WestHud.game.joinServer(i), g.width() / 2f, g.height() / 2f);
        }
    }

    void worldIcon(Game.WorldInfo wi, int x, int y, int s) {
        Gfx g = ui.g;
        if (!g.worldIcon(wi.id(), wi.iconPath(), x, y, s)) {
            Ui.round(g, x, y, s, s, 5, 0x50000000);
            Icons.draw(g, Icon.WORLD, x + s / 4, y + s / 4, s / 2, 0xAAFFFFFF);
        }
        Ui.outline(g, x, y, s, s, 4, 0x26FFFFFF);
    }

    void serverBadge(Game.ServerInfo si, int x, int y, int s, boolean selected) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String ch = si.name().isEmpty() ? "?" : si.name().substring(0, 1).toUpperCase(Locale.ROOT);
        Ui.round(g, x, y, s, s, 6, selected ? t.accent | 0xFF000000 : Theme.alpha(t.accent, 0x60));
        float sc = s / 22f;
        g.push();
        g.translate(x + (s - g.textBoldWidth(ch) * sc) / 2f, y + (s - 8 * sc) / 2f);
        g.scale(sc);
        g.textBold(ch, 0, 0, selected ? t.onAccent : 0xFFFFFFFF, false);
        g.pop();
    }

    private static String mode(Game.WorldInfo wi) {
        return wi.hardcore() ? Tr.t("Zorlu") : MODES[Math.max(0, Math.min(3, wi.mode()))];
    }

    // ───────── Dünyalar / Sunucular sayfası ─────────

    private void listPage(int cardX, int cardY, int cw, int sw, int sh, float in) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean sp = page == Page.WORLDS;
        int x = 10, w = cardX - 20;
        int y = TOP + 4 + Math.round((1 - in) * 10);

        // Başlık çubuğu
        int hh = 26;
        Ui.round(g, x, y, w, hh, 9, 0xC20D0E15);
        Ui.outline(g, x, y, w, hh, 9, 0x1FFFFFFF);
        if (iconButton("back", Icon.BACK, x + 5, y + 4, 18, Tr.t("Geri"), 0)) {
            goHome();
            return;
        }
        String title = sp ? Tr.t("Dünyalar") : Tr.t("Sunucular");
        float ts = 1.25f;
        bigText(g, title, x + 28, y + 8, 0xFFFFFFFF, ts);
        int afterTitle = x + 28 + Math.round(g.textBoldWidth(title) * ts) + 10;
        String add = sp ? Tr.t("Dünya oluştur") : Tr.t("Sunucu ekle");
        int bw = g.textBoldWidth(add) + 30;
        boolean compact = afterTitle + 60 + bw + 12 > x + w;
        if (compact) bw = 24;
        int bx = x + w - bw - 5;
        boolean addClicked = sp || compact
                ? outlineButton("add", compact ? "" : add, Icon.PLUS, bx, y + 4, bw, 18, false)
                : accentButton("add", add, Icon.PLUS, bx, y + 4, bw, 18);
        if (addClicked) WestHud.game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
        // Arama
        int sx = afterTitle, sww = bx - 6 - sx;
        if (sww > 40) searchBox(sx, y + 4, sww, 18, sp ? Tr.t("Dünya ara") : Tr.t("Sunucu ara"));

        // Liste paneli
        int ly = y + hh + 8;
        int lb = sh - 18 - 26 - 8;
        if (lb - ly < 70) lb = sh - 18;
        Ui.round(g, x, ly, w, lb - ly, 10, 0x9E0D0E15);
        Ui.outline(g, x, ly, w, lb - ly, 10, 0x1AFFFFFF);
        listTop = ly + 6;
        listBottom = lb - 6;

        List<Integer> items = filtered(sp);
        int total = sp ? worlds.size() : servers.size();
        if (items.isEmpty()) {
            int cx = x + w / 2, cy = (ly + lb) / 2;
            if (total == 0) {
                boolean b = sp
                        ? emptyMessage(cx, cy, Tr.t("Henüz dünya yok"), Tr.t("Oynamaya başlamak için bir dünya oluştur."), Tr.t("Dünya oluştur"))
                        : emptyMessage(cx, cy, Tr.t("Kayıtlı sunucu yok"), Tr.t("Bir sunucu ekle ya da doğrudan bağlan."), Tr.t("Sunucu ekle"));
                if (b) WestHud.game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
            } else {
                emptyMessage(cx, cy, Tr.t("Eşleşen yok"), "\"" + search + Tr.t("\" için sonuç bulunamadı."), null);
            }
        } else {
            int rh = 36, gap = 4;
            listContent = items.size() * (rh + gap) - gap;
            float max = Math.max(0, listContent - (listBottom - listTop));
            scrollTarget = Math.max(0, Math.min(max, scrollTarget));
            scroll += (scrollTarget - scroll) * Math.min(1, dt * 18);
            g.scissor(x + 4, listTop, x + w - 4, listBottom);
            int realMy = ui.my;
            if (realMy < listTop || realMy >= listBottom) ui.my = -9999;
            int sel = sp ? selWorld : selServer;
            for (int k = 0; k < items.size(); k++) {
                int ry = listTop + k * (rh + gap) - Math.round(scroll);
                if (ry + rh < listTop || ry > listBottom) continue;
                int i = items.get(k);
                row(x + 6, ry, w - 12 - (max > 0 ? 6 : 0), rh, i, i == sel, sp, "l");
            }
            ui.my = realMy;
            g.noScissor();
            if (max > 0) {
                int vh = listBottom - listTop;
                int barH = Math.max(16, (int) (vh * (float) vh / listContent));
                int barY = listTop + (int) ((vh - barH) * (scroll / max));
                Ui.round(g, x + w - 8, barY, 3, barH, 1, 0x55FFFFFF);
            }
        }

        // Sağ üstte ayrıntılar
        int dy = TOP + 4, dh = cardY - 8 - dy;
        if (dh >= 74) details(cardX, dy, cw, dh, sp);
    }

    private List<Integer> filtered(boolean sp) {
        List<Integer> out = new ArrayList<>();
        String q = search.toLowerCase(Locale.ROOT).trim();
        int n = sp ? worlds.size() : servers.size();
        for (int i = 0; i < n; i++) {
            String a = sp ? worlds.get(i).name() : servers.get(i).name();
            String b = sp ? worlds.get(i).id() : servers.get(i).address();
            if (q.isEmpty() || a.toLowerCase(Locale.ROOT).contains(q) || b.toLowerCase(Locale.ROOT).contains(q)) out.add(i);
        }
        return out;
    }

    private void searchBox(int x, int y, int w, int h, String placeholder) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, h);
        Ui.round(g, x, y, w, h, 6, searchFocus ? 0x99000000 : on ? 0x80000000 : 0x66000000);
        Ui.outline(g, x, y, w, h, 6, searchFocus ? Theme.alpha(t.accent, 0xCC) : 0x26FFFFFF);
        Icons.draw(g, Icon.SEARCH, x + 6, y + (h - 9) / 2, 9, 0x99FFFFFF);
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        String shown = search.isEmpty() && !searchFocus ? placeholder : search + (searchFocus && blink ? "|" : "");
        g.text(ui.fit(shown, w - 26), x + 20, y + (h - 8) / 2, search.isEmpty() && !searchFocus ? 0x77FFFFFF : 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, h)) searchFocus = true;
        else if (!on && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;
    }

    private void details(int x, int y, int w, int h, boolean sp) {
        Gfx g = ui.g;
        Ui.round(g, x, y, w, h, 10, 0xC20D0E15);
        Ui.outline(g, x, y, w, h, 10, 0x1AFFFFFF);
        int count = sp ? worlds.size() : servers.size();
        if (count == 0) {
            emptyMessage(x + w / 2, y + h / 2, sp ? Tr.t("Dünya seçilmedi") : Tr.t("Sunucu seçilmedi"), sp ? Tr.t("Ayrıntılar için bir dünya seç.") : Tr.t("Ayrıntılar için bir sunucu seç."), null);
            return;
        }
        int i = Math.min(sp ? selWorld : selServer, count - 1);
        int pad = 10, is = Math.min(44, h - 60);
        int cy = y + pad;
        if (is >= 24) {
            if (sp) worldIcon(worlds.get(i), x + pad, cy, is);
            else serverBadge(servers.get(i), x + pad, cy, is, true);
        } else is = 0;
        int tx = x + pad + (is > 0 ? is + 8 : 0), tw = x + w - pad - tx;
        String name = sp ? worlds.get(i).name() : servers.get(i).name();
        g.textBold(ui.fit(name, tw), tx, cy + 2, 0xFFFFFFFF, false);
        if (sp) {
            Game.WorldInfo wi = worlds.get(i);
            smallText(g, ui.fit(mode(wi), (int) (tw / 0.8f)), tx, cy + 14, 0xAAFFFFFF);
            smallText(g, ui.fit(ago(wi.lastPlayed()), (int) (tw / 0.8f)), tx, cy + 23, 0x88FFFFFF);
        } else {
            smallText(g, ui.fit(servers.get(i).address(), (int) (tw / 0.8f)), tx, cy + 14, 0xAAFFFFFF);
        }
        int by = y + h - pad - 20;
        int half = (w - pad * 2 - 6) / 2;
        if (accentButton("dplay", sp ? Tr.t("Oyna") : Tr.t("Katıl"), Icon.PLAY, x + pad, by, half, 20)) joinRow(sp, i);
        if (outlineButton("dedit", Tr.t("Düzenle"), Icon.EDIT, x + pad + half + 6, by, w - pad * 2 - half - 6, 20, false)) {
            WestHud.game.open(sp ? Game.Target.SINGLEPLAYER : Game.Target.MULTIPLAYER);
        }
    }

    private static String ago(long millis) {
        if (millis <= 0) return Tr.t("Hiç oynanmadı");
        long s = (System.currentTimeMillis() - millis) / 1000;
        if (s < 60) return Tr.t("Az önce");
        if (s < 3600) return Tr.t("{0} dk önce", s / 60);
        if (s < 86400) return Tr.t("{0} sa önce", s / 3600);
        if (s < 86400 * 30) return Tr.t("{0} gün önce", s / 86400);
        return Tr.t("{0} ay önce", s / (86400 * 30));
    }

    // ───────── Olaylar ─────────

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        if (page == Page.SOCIAL) social.scroll(amount);
        else if (page != Page.HOME) scrollTarget -= (float) amount * 30;
    }

    @Override
    public boolean keyPressed(int key) {
        if (page == Page.SOCIAL && social.keyPressed(key)) return true;
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) search = search.substring(0, search.length() - 1);
        else if (key == 256 || key == 257) searchFocus = false;
        scrollTarget = 0;
        return true;
    }

    @Override
    public void charTyped(char c) {
        if (page == Page.SOCIAL && social.charTyped(c)) return;
        if (searchFocus && c >= 32 && search.length() < 40) {
            search += c;
            scrollTarget = 0;
        }
    }

    /** Esc: alt sayfadan ana sayfaya; ana sayfada hiçbir şey yapmaz */
    @Override
    public WestScreen escape() {
        if (page != Page.HOME) goHome();
        return this;
    }
}
