package dev.west.hud.screen;

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
    private static final String[] MODES = { "Hayatta kalma", "Yaratıcı", "Macera", "İzleyici" };
    private static final String[] TABS = { "Oyna", "Modlar", "Görünüm", "Genel" };
    private static final int[] PAGES = { -1, 3, 1, 2 };

    private enum Page { HOME, WORLDS, SERVERS }

    private Page page = Page.HOME;
    private List<Game.ServerInfo> servers;
    private List<Game.WorldInfo> worlds = List.of();
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

        g.panorama(delta);
        boolean sub = page != Page.HOME;
        if (sub) {
            g.blurBehind();
            g.fill(0, 0, sw, sh, 0x8C080A10);
        } else {
            g.gradient(0, 0, sw, TOP + 30, 0x99080A10, 0x00080A10);
            g.gradient(0, sh / 2, sw, sh, 0x00060709, 0xB0060709);
        }

        int cw = clamp(Math.round(sw * 0.32f), 158, 218);
        int cardX = sw - cw - 10;
        if (!sub) playerModel(sw, sh, cardX, in);
        int cardY = playCard(cardX, sh, cw, in);
        if (sub) listPage(cardX, cardY, cw, sw, sh, in);
        chips(sh, cardX - 12, in, !sub);
        if (topBar(sw, in, TABS, PAGES, true)) goHome();
        footer(sw, sh);
        if (!sub && !WestHud.config.data.titleTipSeen) tip(sw, cw, in);
        ui.end();
    }

    private void goHome() {
        page = Page.HOME;
        searchFocus = false;
    }

    private void open(Page p) {
        page = p;
        search = "";
        searchFocus = false;
        scroll = scrollTarget = 0;
        WestHud.config.data.homeTab = p == Page.SERVERS ? 1 : 0;
    }

    // ───────── Ana sayfa ─────────

    private void playerModel(int sw, int sh, int cardX, float in) {
        int mh = clamp(Math.round(sh * 0.46f), 70, 210);
        int mw = Math.round(mh * 0.62f);
        int cx = Math.max(Math.min(sw / 2, cardX - mw / 2 - 16), mw / 2 + 10);
        int top = TOP + Math.max(24, (sh - TOP - 40 - mh) / 2) + Math.round((1 - in) * 12);
        ui.g.playerModel(cx - mw / 2, top, mw, mh);
        nameTag(cx, top - 6, WestHud.game.playerName(), null);
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
        String[] labels = { "Tek oyunculu", "Çok oyunculu" };
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
            label = sp ? "Dünya oluştur" : "Sunucu ekle";
            action = () -> game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
        } else if (sp) {
            Game.WorldInfo wi = worlds.get(Math.min(selWorld, count - 1));
            label = "Oyna";
            action = () -> game.joinWorld(wi.id());
        } else {
            int si = Math.min(selServer, count - 1);
            label = "Katıl";
            action = () -> game.joinServer(si);
        }
        if (accentButton("play", label, count == 0 ? Icon.PLUS : Icon.PLAY, x + 6, cy, w - 12, 26)) action.run();
        cy += 26 + 6;
        g.fill(x + 1, cy, x + w - 1, cy + 1, 0x14FFFFFF);
        cy += 1;

        smallText(g, count + " kayıtlı", x + 9, cy + 5, 0x88FFFFFF);
        boolean onList = page != Page.HOME;
        String all = onList ? "Ana sayfa" : sp ? "Tüm dünyalar" : "Tüm sunucular";
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
        g.textBold(ui.fit(sp ? "Henüz dünya yok" : "Henüz sunucu yok", w - box - 8), tx, y + 7, 0xFFFFFFFF, false);
        smallText(g, ui.fit(sp ? "İlk dünyanı oluştur" : "Oynamak için bir tane ekle", (int) ((w - box - 8) / 0.8f)), tx, y + 19, 0x99FFFFFF);
        String add = sp ? "Oluştur" : "Ekle";
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
            String act = sp ? "Oyna" : "Katıl";
            int bw = g.textBoldWidth(act) + 30;
            if (accentButton(ns + "act" + i, act, Icon.PLAY, x + w - bw - 6, y + (h - 18) / 2, bw, 18)) {
                if (sp) WestHud.game.joinWorld(worlds.get(i).id());
                else WestHud.game.joinServer(i);
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
            if (dbl) {
                if (sp) WestHud.game.joinWorld(worlds.get(i).id());
                else WestHud.game.joinServer(i);
            }
        }
    }

    private void worldIcon(Game.WorldInfo wi, int x, int y, int s) {
        Gfx g = ui.g;
        if (!g.worldIcon(wi.id(), wi.iconPath(), x, y, s)) {
            Ui.round(g, x, y, s, s, 5, 0x50000000);
            Icons.draw(g, Icon.WORLD, x + s / 4, y + s / 4, s / 2, 0xAAFFFFFF);
        }
        Ui.outline(g, x, y, s, s, 4, 0x26FFFFFF);
    }

    private void serverBadge(Game.ServerInfo si, int x, int y, int s, boolean selected) {
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
        return wi.hardcore() ? "Zorlu" : MODES[Math.max(0, Math.min(3, wi.mode()))];
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
        if (iconButton("back", Icon.BACK, x + 5, y + 4, 18, "Geri", 0)) {
            goHome();
            return;
        }
        String title = sp ? "Dünyalar" : "Sunucular";
        float ts = 1.25f;
        bigText(g, title, x + 28, y + 8, 0xFFFFFFFF, ts);
        int afterTitle = x + 28 + Math.round(g.textBoldWidth(title) * ts) + 10;
        String add = sp ? "Dünya oluştur" : "Sunucu ekle";
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
        if (sww > 40) searchBox(sx, y + 4, sww, 18, sp ? "Dünya ara" : "Sunucu ara");

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
                        ? emptyMessage(cx, cy, "Henüz dünya yok", "Oynamaya başlamak için bir dünya oluştur.", "Dünya oluştur")
                        : emptyMessage(cx, cy, "Kayıtlı sunucu yok", "Bir sunucu ekle ya da doğrudan bağlan.", "Sunucu ekle");
                if (b) WestHud.game.open(sp ? Game.Target.CREATE_WORLD : Game.Target.ADD_SERVER);
            } else {
                emptyMessage(cx, cy, "Eşleşen yok", "\"" + search + "\" için sonuç bulunamadı.", null);
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
            emptyMessage(x + w / 2, y + h / 2, sp ? "Dünya seçilmedi" : "Sunucu seçilmedi", sp ? "Ayrıntılar için bir dünya seç." : "Ayrıntılar için bir sunucu seç.", null);
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
        if (accentButton("dplay", sp ? "Oyna" : "Katıl", Icon.PLAY, x + pad, by, half, 20)) {
            if (sp) WestHud.game.joinWorld(worlds.get(i).id());
            else WestHud.game.joinServer(i);
        }
        if (outlineButton("dedit", "Düzenle", Icon.EDIT, x + pad + half + 6, by, w - pad * 2 - half - 6, 20, false)) {
            WestHud.game.open(sp ? Game.Target.SINGLEPLAYER : Game.Target.MULTIPLAYER);
        }
    }

    // ───────── İlk açılış kartı ─────────

    private void tip(int sw, int cw, float in) {
        Gfx g = ui.g;
        int w = Math.min(220, sw - cw - 40);
        if (w < 150) return;
        int x = 10 - Math.round((1 - in) * 20), y = TOP + 6;
        String title = "Vanilla menüyü mü tercih edersin?";
        String body = "Minecraft'ın kendi ana menüsüne dönebilirsin. Geri gelmek için başlık ekranının sağ üstündeki West düğmesine bas.";
        List<String> lines = wrap(g, body, (int) ((w - 20) / 0.8f));
        int h = 10 + 10 + 6 + lines.size() * 9 + 8 + 18 + 9;
        Ui.round(g, x, y, w, h, 10, 0xE60D0E15);
        Ui.outline(g, x, y, w, h, 10, 0x26FFFFFF);
        g.textBold(ui.fit(title, w - 34), x + 10, y + 10, 0xFFFFFFFF, false);
        boolean close = iconButton("tipx", Icon.CLOSE, x + w - 20, y + 6, 14, null, 0);
        int ly = y + 26;
        for (String l : lines) {
            smallText(g, l, x + 10, ly, 0xBBFFFFFF);
            ly += 9;
        }
        ly += 8;
        int bw = (w - 26) / 2;
        boolean keep = outlineButton("tipk", "West'te kal", null, x + 10, ly, bw, 18, true);
        boolean vanilla = outlineButton("tipv", "Vanilla kullan", null, x + 16 + bw, ly, bw, 18, false);
        if (close || keep || vanilla) {
            WestHud.config.data.titleTipSeen = true;
            WestHud.save();
        }
        if (vanilla) WestHud.game.openVanillaTitle();
    }

    private static String ago(long millis) {
        if (millis <= 0) return "Hiç oynanmadı";
        long s = (System.currentTimeMillis() - millis) / 1000;
        if (s < 60) return "Az önce";
        if (s < 3600) return (s / 60) + " dk önce";
        if (s < 86400) return (s / 3600) + " saat önce";
        if (s < 86400 * 30) return (s / 86400) + " gün önce";
        return (s / (86400 * 30)) + " ay önce";
    }

    // ───────── Olaylar ─────────

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        if (page != Page.HOME) scrollTarget -= (float) amount * 30;
    }

    @Override
    public boolean keyPressed(int key) {
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) search = search.substring(0, search.length() - 1);
        else if (key == 256 || key == 257) searchFocus = false;
        scrollTarget = 0;
        return true;
    }

    @Override
    public void charTyped(char c) {
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
