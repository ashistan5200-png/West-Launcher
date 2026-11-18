package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.net.Upnp;
import dev.west.hud.social.SocialClient;
import dev.west.hud.social.SocialClient.Person;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Dünyayı arkadaşlarla paylaş: dünya ayarları + davet edilecek arkadaşlar. */
public final class ShareMenu extends WestShell {
    private static final String[] MODES = { Tr.t("Hayatta kalma"), Tr.t("Yaratıcı"), Tr.t("Macera"), Tr.t("İzleyici") };
    private static final String[] VIS = { Tr.t("Arkadaşlar"), Tr.t("Yalnızca davetliler") };

    private final WestScreen back;
    private final SocialClient c = SocialClient.INSTANCE;
    private int vis, mode, tab = 1;
    private boolean cheats, upnp = true, notify = true, offline;
    private final Set<String> picked = new LinkedHashSet<>();
    private String search = "";
    private boolean searchFocus;
    private String result;
    private boolean busy;

    public ShareMenu(WestScreen back) {
        this.back = back;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        beginFrame(g, mx, my);
        Theme t = ui.t;
        c.poll(null);
        pollTunnel();
        int sw = g.width(), sh = g.height();
        float in = appear();
        g.blurBehind();
        g.fill(0, 0, sw, sh, (int) (0x8C * in) << 24 | 0x06070B);

        int pw = Math.min(560, sw - 16), ph = Math.min(360, sh - 16);
        int px = (sw - pw) / 2, py = (sh - ph) / 2 + Math.round((1 - in) * 10);
        Ui.round(g, px - 1, py + 3, pw + 2, ph + 2, 14, 0x50000000);
        Ui.round(g, px, py, pw, ph, 13, 0xF20E1016);
        Ui.outline(g, px, py, pw, ph, 13, 0x1FFFFFFF);
        int lw = Math.max(150, Math.min(210, pw * 36 / 100));
        g.fill(px + lw, py + 8, px + lw + 1, py + ph - 8, 0x1AFFFFFF);

        left(px, py, lw, ph);
        right(px + lw + 1, py, pw - lw - 1, ph);
        ui.end();
    }

    private void left(int x, int y, int w, int h) {
        Gfx g = ui.g;
        Theme t = ui.t;
        // Profil
        Ui.round(g, x + 10, y + 10, 26, 26, 7, Theme.alpha(t.accent, 0xCC));
        g.playerFace(x + 12, y + 12, 22);
        Ui.round(g, x + 30, y + 30, 8, 8, 4, 0xFF101114);
        Ui.round(g, x + 31, y + 31, 6, 6, 3, 0xFF4CC38A);
        g.textBold(ui.fit(WestHud.game.playerName(), w - 70), x + 42, y + 12, 0xFFFFFFFF, false);
        smallText(g, c.available() ? Tr.t("Çevrimiçi") : Tr.t("West hesabı bağlı değil"), x + 42, y + 24, 0xAAFFFFFF);
        if (iconButton("lx", Icon.CLOSE, x + w - 26, y + 12, 18, null, 0)) close();

        // Arama
        int sy = y + 44;
        boolean on = ui.hover(x + 10, sy, w - 20, 18);
        Ui.round(g, x + 10, sy, w - 20, 18, 6, searchFocus ? 0x99000000 : on ? 0x80000000 : 0x66000000);
        Ui.outline(g, x + 10, sy, w - 20, 18, 6, searchFocus ? Theme.alpha(t.accent, 0xCC) : 0x26FFFFFF);
        Icons.draw(g, Icon.SEARCH, x + 15, sy + 5, 8, 0x99FFFFFF);
        String shown = search.isEmpty() && !searchFocus ? Tr.t("Arkadaş ara") : search + (searchFocus && ((int) (ui.time * 2)) % 2 == 0 ? "|" : "");
        g.text(ui.fit(shown, w - 44), x + 27, sy + 5, search.isEmpty() && !searchFocus ? 0x77FFFFFF : 0xFFFFFFFF, false);
        if (ui.clicked(x + 10, sy, w - 20, 18)) searchFocus = true;
        else if (!on && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;

        // Dünya durumu kartı
        int cy = sy + 24;
        int port = WestHud.game.publishedPort();
        Ui.round(g, x + 10, cy, w - 20, 22, 7, 0x14FFFFFF);
        Ui.outline(g, x + 10, cy, w - 20, 22, 7, port > 0 ? Theme.alpha(t.accent, 0xCC) : 0x22FFFFFF);
        Icons.draw(g, Icon.GLOBE, x + 17, cy + 6, 10, 0xFFFFFFFF);
        g.textBold(Tr.t("Dünya"), x + 32, cy + 7, 0xFFFFFFFF, false);
        String st = port > 0 ? Tr.t("Paylaşılıyor") : Tr.t("Özel");
        smallText(g, st, x + 36 + g.textBoldWidth(Tr.t("Dünya")), cy + 8, port > 0 ? 0xFF8EE6B6 : 0xAAFFFFFF);

        // Sekmeler
        int ty = cy + 28;
        String[] tabs = { Tr.t("Sohbetler"), Tr.t("Arkadaşlar"), Tr.t("Oyuncular") };
        int third = (w - 20) / 3;
        Ui.round(g, x + 10, ty, w - 20, 18, 6, 0x66000000);
        for (int i = 0; i < 3; i++) {
            int bx = x + 10 + i * third;
            if (tab == i) Ui.round(g, bx + 1, ty + 1, third - 2, 16, 5, t.accent | 0xFF000000);
            String l = ui.fit(tabs[i], Math.round((third - 6) / 0.85f));
            g.push();
            g.translate(bx + (third - g.textBoldWidth(l) * 0.85f) / 2f, ty + 5.5f);
            g.scale(0.85f);
            g.textBold(l, 0, 0, tab == i ? t.onAccent : 0xCCFFFFFF, false);
            g.pop();
            if (ui.clicked(bx, ty, third, 18)) tab = i;
        }

        int ly = ty + 24;
        if (tab == 2) {
            players(x, ly, w, y + h - 8);
            return;
        }
        if (!c.available()) {
            List<String> lines = wrap(g, Tr.t("Arkadaşlarını davet etmek için oyunu West Client launcher'ından, West hesabına giriş yapmışken başlat."), (int) ((w - 24) / 0.8f));
            for (String l : lines) {
                smallText(g, l, x + 12, ly, 0xAAFFFFFF);
                ly += 9;
            }
            return;
        }
        String q = search.toLowerCase(Locale.ROOT).trim();
        g.scissor(x, ly, x + w, y + h - 8);
        if (tab == 1) {
            List<Person> list = new ArrayList<>();
            for (Person p : c.friends) if (q.isEmpty() || p.display().toLowerCase(Locale.ROOT).contains(q)) list.add(p);
            if (list.isEmpty()) smallText(g, c.loaded ? Tr.t("Henüz arkadaş yok") : c.error != null ? Tr.t("Launcher'a ulaşılamadı, yeniden deneniyor…") : Tr.t("Yükleniyor…"), x + 12, ly + 2, 0x99FFFFFF);
            for (Person p : list) {
                if (ly + 24 > y + h - 8) break;
                boolean sel = picked.contains(p.id());
                boolean hv = ui.hover(x + 8, ly, w - 16, 24);
                if (hv || sel) Ui.round(g, x + 8, ly, w - 16, 24, 6, sel ? Theme.alpha(t.accent, 0x2A) : 0x14FFFFFF);
                letter(g, p.display(), x + 12, ly + 4, 16, p.online());
                g.textBold(ui.fit(p.display(), w - 70), x + 33, ly + 4, 0xFFFFFFFF, false);
                smallText(g, p.online() ? Tr.t("Çevrimiçi") : Tr.t("Çevrimdışı"), x + 33, ly + 14, p.online() ? 0xCC8EE6B6 : 0x88FFFFFF);
                check(g, x + w - 24, ly + 6, sel);
                if (ui.clicked(x + 8, ly, w - 16, 24)) {
                    WestHud.game.click();
                    if (!picked.remove(p.id())) picked.add(p.id());
                }
                ly += 26;
            }
        } else {
            for (SocialClient.Conversation cv : c.conversations) {
                if (ly + 26 > y + h - 8) break;
                if (!q.isEmpty() && !cv.title().toLowerCase(Locale.ROOT).contains(q)) continue;
                letter(g, cv.title(), x + 12, ly + 4, 16, cv.members().stream().anyMatch(Person::online));
                g.textBold(ui.fit(cv.title(), w - 50), x + 33, ly + 3, 0xFFFFFFFF, false);
                smallText(g, ui.fit(cv.last(), (int) ((w - 50) / 0.8f)), x + 33, ly + 14, cv.unread() ? 0xFFFFFFFF : 0x88FFFFFF);
                if (cv.unread()) Ui.round(g, x + w - 16, ly + 9, 5, 5, 3, t.accent | 0xFF000000);
                ly += 28;
            }
        }
        g.noScissor();
    }

    /** Dünyaya bağlı arkadaşlar: OP ver / al (yalnızca dünya sahibi; kim alacağını sen seçersin) */
    private void players(int x, int ly, int w, int bottom) {
        Gfx g = ui.g;
        Theme t = ui.t;
        List<Game.SharedPlayer> list = WestHud.game.sharedPlayers();
        if (list.isEmpty()) {
            String msg = WestHud.game.publishedPort() > 0 ? Tr.t("Dünyanda henüz arkadaşın yok. Katılanlar burada görünür; istediğine OP verebilirsin.")
                    : Tr.t("Dünyayı paylaşınca katılan arkadaşların burada görünür; istediğine OP verebilirsin.");
            for (String l : wrap(g, msg, (int) ((w - 24) / 0.8f))) {
                smallText(g, l, x + 12, ly, 0xAAFFFFFF);
                ly += 9;
            }
            return;
        }
        smallText(g, ui.fit(Tr.t("OP: komut kullanabilir (oyun modu, ışınlanma…)"), (int) ((w - 24) / 0.8f)), x + 12, ly, 0x88FFFFFF);
        ly += 12;
        g.scissor(x, ly, x + w, bottom);
        for (Game.SharedPlayer p : list) {
            if (ly + 24 > bottom) break;
            boolean hv = ui.hover(x + 8, ly, w - 16, 24);
            if (hv) Ui.round(g, x + 8, ly, w - 16, 24, 6, 0x14FFFFFF);
            letter(g, p.name(), x + 12, ly + 4, 16, true);
            String btn = p.op() ? Tr.t("OP al") : Tr.t("OP ver");
            int bw = small(g, btn) + 14;
            int bx = x + w - 12 - bw;
            g.textBold(ui.fit(p.name(), bx - x - 40), x + 33, ly + 4, 0xFFFFFFFF, false);
            smallText(g, p.op() ? Tr.t("Operatör") : Tr.t("Oyuncu"), x + 33, ly + 14, p.op() ? t.accent | 0xFF000000 : 0x88FFFFFF);
            boolean bh = ui.hover(bx, ly + 5, bw, 14);
            Ui.round(g, bx, ly + 5, bw, 14, 7, p.op() ? (bh ? 0xCCE5566E : 0x40E5566E) : bh ? t.accent | 0xFF000000 : Theme.alpha(t.accent, 0x55));
            smallText(g, btn, bx + 7, ly + 9, p.op() || !bh ? 0xFFFFFFFF : t.onAccent);
            if (ui.clicked(bx, ly + 5, bw, 14)) {
                WestHud.game.click();
                WestHud.game.setOp(p.uuid(), !p.op());
                result = p.op() ? Tr.t("{0} artık OP değil", p.name()) : Tr.t("{0} artık OP", p.name());
            }
            ly += 26;
        }
        g.noScissor();
    }

    private void right(int x, int y, int w, int h) {
        Gfx g = ui.g;
        Theme t = ui.t;
        Game.Session s = WestHud.game.session();
        String head = Tr.t("Dünya ayarlarını yapılandır");
        float hs = Math.min(1.25f, (w - 50) / (float) Math.max(1, g.textBoldWidth(head)));
        bigText(g, head, x + 14, y + 12, 0xFFFFFFFF, hs);
        g.text(ui.fit(s.title(), w - 50), x + 14, y + 27, 0xBBFFFFFF, false);
        if (iconButton("rx", Icon.CLOSE, x + w - 26, y + 10, 18, null, 0)) close();
        g.fill(x + 1, y + 42, x + w - 1, y + 43, 0x1AFFFFFF);
        // Sonuç mesajı (varsa) açıklamanın yerine, en fazla iki satır
        int ry = y + 50;
        if (result != null) {
            List<String> lines = wrap(g, result, (int) ((w - 28) / 0.8f));
            for (int i = 0; i < Math.min(2, lines.size()); i++) {
                smallText(g, lines.get(i), x + 14, ry, 0xFF8EE6B6);
                ry += 9;
            }
        } else {
            smallText(g, ui.fit(Tr.t("Bu dünyanın arkadaşların için nasıl açılacağını seç."), (int) ((w - 28) / 0.8f)), x + 14, ry, 0x88FFFFFF);
            ry += 9;
        }
        ry += 5;
        int by = y + h - 32;
        // Satırlar ekrana sığsın: 6 satır, aralık 5
        int gap = 5, rh = Math.max(16, Math.min(24, (by - 6 - ry) / 6 - gap));
        int ctlW = Math.min(180, w * 55 / 100);
        int cx = x + w - 14 - ctlW;
        boolean published = WestHud.game.publishedPort() > 0;
        row(Tr.t("Kime açık"), ry, rh, x);
        if (pill("vis", Tr.t("Görünürlük"), VIS[vis], cx, ry, ctlW, rh, true)) vis = (vis + 1) % VIS.length;
        ry += rh + gap;
        row(Tr.t("Oyun modu"), ry, rh, x);
        if (!published && pill("mode", Tr.t("Mod"), MODES[mode], cx, ry, ctlW, rh, true)) mode = (mode + 1) % MODES.length;
        if (published) pill("mode", Tr.t("Mod"), MODES[mode], cx, ry, ctlW, rh, false);
        ry += rh + gap;
        row(Tr.t("Hesap"), ry, rh, x);
        if (toggle("offline", Tr.t("Offline hesaplar da"), offline, cx, ry, ctlW, rh) && !published) offline = !offline;
        ry += rh + gap;
        row(Tr.t("Hileler"), ry, rh, x);
        if (toggle("cheats", Tr.t("Hilelere izin ver"), cheats, cx, ry, ctlW, rh) && !published) cheats = !cheats;
        ry += rh + gap;
        row(Tr.t("İnternet"), ry, rh, x);
        if (WestHud.game.hasTunnel()) toggle("upnp", Tr.t("Her ağdan bağlanılabilir"), true, cx, ry, ctlW, rh);
        else if (toggle("upnp", Tr.t("Modem portunu aç"), upnp, cx, ry, ctlW, rh) && !published) upnp = !upnp;
        ry += rh + gap;
        row(Tr.t("Davet"), ry, rh, x);
        if (toggle("notify", picked.isEmpty() ? Tr.t("Arkadaş seç (solda)") : picked.size() + Tr.t(" arkadaşa gönder"), notify, cx, ry, ctlW, rh)) notify = !notify;

        int bw = (w - 28 - 8) / 2;
        if (outlineButton("close", Tr.t("Kapat"), Icon.CLOSE, x + 14, by, bw, 22, false)) close();
        String label = busy ? Tr.t("Açılıyor…") : published ? Tr.t("Davet gönder") : Tr.t("Paylaş");
        if (accentButton("share", label, Icon.CHEVRON_RIGHT, x + 14 + bw + 8, by, w - 28 - bw - 8, 22) && !busy) share(published);
    }

    /** Tünel adresi beklenirken (e4mc) */
    private long tunnelWaitSince;
    private int tunnelPort;

    private void pollTunnel() {
        if (tunnelWaitSince == 0) return;
        Game game = WestHud.game;
        String addr = game.tunnelAddress();
        String world = game.session().title();
        if (addr != null) {
            tunnelWaitSince = 0;
            busy = false;
            result = Tr.t("Dünya herkese açıldı (her ağdan bağlanılabilir): ") + addr;
            sendInvites(world, addr, "tunnel");
        } else if (game.tunnelFailed() || System.currentTimeMillis() - tunnelWaitSince > 25_000) {
            tunnelWaitSince = 0;
            result = Tr.t("Herkese açık adres alınamadı; modem yolu deneniyor…");
            openUpnp(tunnelPort, world);
        }
    }

    private void share(boolean already) {
        Game game = WestHud.game;
        int port = already ? game.publishedPort() : game.publishWorld(mode, cheats, offline);
        if (port <= 0) {
            result = Tr.t("Dünya açılamadı. Tek oyunculu bir dünyada olduğundan emin ol.");
            return;
        }
        String world = game.session().title();
        // 1) Her ağda çalışan yol: e4mc tüneli (modem/CGNAT fark etmez)
        if (game.hasTunnel()) {
            String addr = game.tunnelAddress();
            if (addr != null) {
                result = Tr.t("Dünya herkese açık: ") + addr;
                sendInvites(world, addr, "tunnel");
                return;
            }
            busy = true;
            result = Tr.t("Herkese açık adres alınıyor…");
            tunnelWaitSince = System.currentTimeMillis();
            tunnelPort = port;
            return;
        }
        openUpnp(port, world);
    }

    private void openUpnp(int port, String world) {
        if (!upnp) {
            String lan = Upnp.localIp(null) + ":" + port;
            result = Tr.t("Dünya aynı ağdakilere açıldı: ") + lan;
            sendInvites(world, lan, "lan");
            return;
        }
        busy = true;
        result = Tr.t("Modemde port açılıyor…");
        Upnp.open(port, Tr.t("West Client: ") + world).thenAccept(r -> {
            busy = false;
            String address = (r.ok() ? r.externalIp() : r.localIp()) + ":" + port;
            result = (r.ok() ? Tr.t("Dünya internete açıldı: ") : r.message() + Tr.t(" Yalnızca aynı ağdakiler katılabilir: ")) + address;
            sendInvites(world, address, r.ok() ? "upnp" : "lan");
        });
    }

    private void sendInvites(String world, String address, String kind) {
        if (!notify || picked.isEmpty() || !c.available()) return;
        List<String> users = new ArrayList<>(picked);
        c.invite(users, world, address, kind, offline, n -> result = result + " · " + n + Tr.t(" arkadaşa davet gönderildi."));
    }

    private void row(String label, int y, int h, int x) {
        ui.g.textBold(label, x + 14, y + (h - 8) / 2, 0xFFFFFFFF, false);
    }

    private boolean pill(String id, String key, String value, int x, int y, int w, int h, boolean enabled) {
        Gfx g = ui.g;
        boolean on = enabled && ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(g, x, y, w, h, 7, Theme.mix(0x80000000, 0xA0101218, hv));
        Ui.outline(g, x, y, w, h, 7, Theme.alpha(0xFFFFFFFF, (int) (0x22 + 0x30 * hv)));
        smallText(g, key, x + 8, y + (h - 7) / 2, 0x88FFFFFF);
        String v = ui.fit(value, w - 30 - small(g, key));
        g.textBold(v, x + w - 20 - g.textBoldWidth(v), y + (h - 8) / 2, enabled ? 0xFFFFFFFF : 0x88FFFFFF, false);
        Icons.draw(g, Icon.CHEVRON_DOWN, x + w - 15, y + (h - 8) / 2, 8, 0xAAFFFFFF);
        if (enabled && ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private boolean toggle(String id, String label, boolean value, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(g, x, y, w, h, 7, Theme.mix(0x80000000, 0xA0101218, hv));
        Ui.outline(g, x, y, w, h, 7, Theme.alpha(0xFFFFFFFF, (int) (0x22 + 0x30 * hv)));
        g.text(ui.fit(label, w - 34), x + 8, y + (h - 8) / 2, 0xFFFFFFFF, false);
        check(g, x + w - 20, y + (h - 12) / 2, value);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private void check(Gfx g, int x, int y, boolean on) {
        Theme t = ui.t;
        if (on) {
            Ui.round(g, x, y, 12, 12, 3, t.accent | 0xFF000000);
            Icons.draw(g, Icon.CHECK, x + 2, y + 2, 8, t.onAccent);
        } else {
            Ui.round(g, x, y, 12, 12, 3, 0x33000000);
            Ui.outline(g, x, y, 12, 12, 3, 0x55FFFFFF);
        }
    }

    private static void letter(Gfx g, String name, int x, int y, int s, boolean online) {
        String ch = name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(Locale.ROOT);
        int[] colors = { 0xFF6EA8D6, 0xFF70C48E, 0xFFE8A25C, 0xFFEC5A82, 0xFFA08CB8, 0xFFF2C14E };
        Ui.round(g, x, y, s, s, 5, colors[Math.abs(name.hashCode()) % colors.length]);
        g.textBold(ch, x + (s - g.textBoldWidth(ch)) / 2, y + (s - 8) / 2, 0xFF101114, false);
        if (online) Ui.round(g, x + s - 5, y + s - 5, 6, 6, 3, 0xFF4CC38A);
    }

    private void close() {
        WestHud.game.click();
        go(back);
    }

    @Override
    public boolean keyPressed(int key) {
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) search = search.substring(0, search.length() - 1);
        else if (key == 256 || key == 257) searchFocus = false;
        return true;
    }

    @Override
    public void charTyped(char ch) {
        if (searchFocus && ch >= 32 && search.length() < 30) search += ch;
    }

    @Override
    public WestScreen escape() {
        return back;
    }

    @Override
    public boolean pausesGame() {
        return true;
    }
}
