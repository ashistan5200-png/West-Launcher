package dev.west.hud.screen;

import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.social.SocialClient;
import dev.west.hud.social.SocialClient.Conversation;
import dev.west.hud.social.SocialClient.Invite;
import dev.west.hud.social.SocialClient.Message;
import dev.west.hud.social.SocialClient.Person;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Oyun içi Sosyal: solda mesajlar, ortada arkadaşlar ya da açık sohbet, sağda seni bekleyenler. */
final class SocialPage {
    private static final String[] STATUSES = { "online", "away", "busy", "invisible" };
    private static final String[] STATUS_NAMES = { "Çevrimiçi", "Uzakta", "Meşgul", "Görünmez" };
    private static final int[] STATUS_COLORS = { 0xFF4CC38A, 0xFFF2C14E, 0xFFE5566E, 0xFF8A8F98 };

    private final SocialClient c = SocialClient.INSTANCE;
    private int convFilter; // 0 tümü, 1 direkt, 2 grup
    private int friendFilter; // 0 tümü, 1 çevrimiçi, 2 istekler
    private String chat; // açık sohbet
    private String chatTitle = "";
    /** 0 yok, 1 arama, 2 arkadaş ekle, 3 mesaj */
    private int focus;
    private String search = "", addName = "", draft = "";
    private boolean adding;
    private String addResult;
    private float scroll;

    int pendingCount() {
        return c.requests.size() + c.invites.size();
    }

    void render(HomeScreen h, int x, int y, int w, int hgt, int cardX, int cardY, int cw) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        c.poll(chat);
        if (!c.available()) {
            StatsPage.panel(g, x, y, w, hgt);
            if (h.iconButton("sback", Icon.BACK, x + 6, y + 6, 18, "Geri", 0)) h.goHome();
            h.emptyMessage(x + w / 2, y + hgt / 2, "Sosyal için West hesabı gerekli", "Oyunu West Client launcher'ından, West hesabına giriş yapmışken başlat.", null);
            return;
        }
        int lw = Math.max(120, Math.min(210, w * 32 / 100));
        messages(h, x, y, lw, hgt);
        int mx = x + lw + 8, mw = w - lw - 8;
        if (chat != null) chatPanel(h, mx, y, mw, hgt);
        else friends(h, mx, y, mw, hgt);
        int dh = cardY - 8 - y;
        if (dh >= 60) waiting(h, cardX, y, cw, dh);
    }

    // ───── Sol: mesajlar ─────

    private void messages(HomeScreen h, int x, int y, int w, int hgt) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        StatsPage.panel(g, x, y, w, hgt);
        // Profil
        int si = Math.max(0, java.util.Arrays.asList(STATUSES).indexOf(c.status));
        Ui.round(g, x + 9, y + 8, 22, 22, 6, Theme.alpha(ui.t.accent, 0xCC));
        g.playerFace(x + 10, y + 9, 20);
        Ui.round(g, x + 25, y + 24, 8, 8, 4, 0xFF101114);
        Ui.round(g, x + 26, y + 25, 6, 6, 3, STATUS_COLORS[si]);
        g.textBold(ui.fit(WestHud.game.playerName(), w - 50), x + 37, y + 9, 0xFFFFFFFF, false);
        WestShell.smallText(g, STATUS_NAMES[si], x + 37, y + 21, 0xAAFFFFFF);
        int unread = 0;
        for (Conversation cv : c.conversations) if (cv.unread()) unread++;
        if (unread > 0) {
            String u = String.valueOf(unread);
            int uw = Math.max(14, g.textBoldWidth(u) + 8);
            Ui.round(g, x + w - 10 - uw, y + 12, uw, 14, 7, ui.t.accent | 0xFF000000);
            g.textBold(u, x + w - 10 - uw + (uw - g.textBoldWidth(u)) / 2, y + 15, ui.t.onAccent, false);
        }
        g.fill(x + 8, y + 36, x + w - 8, y + 37, 0x14FFFFFF);
        // Durum seçici (tıkladıkça değişir)
        int sy = y + 42;
        boolean on = ui.hover(x + 8, sy, w - 16, 18);
        Ui.round(g, x + 8, sy, w - 16, 18, 6, on ? 0x30FFFFFF : 0x1AFFFFFF);
        Ui.round(g, x + 14, sy + 6, 6, 6, 3, STATUS_COLORS[si]);
        String sn = STATUS_NAMES[si];
        if (w - 16 > g.textBoldWidth(sn) + WestShell.small(g, "Durum") + 44) WestShell.smallText(g, "Durum", x + 25, sy + 6, 0x99FFFFFF);
        g.textBold(sn, x + w - 22 - g.textBoldWidth(sn), sy + 5, 0xFFFFFFFF, false);
        Icons.draw(g, Icon.CHEVRON_DOWN, x + w - 18, sy + 5, 8, 0xCCFFFFFF);
        if (ui.clicked(x + 8, sy, w - 16, 18)) {
            WestHud.game.click();
            c.setStatus(STATUSES[(si + 1) % STATUSES.length]);
        }
        // Filtre
        int fy = sy + 24;
        String[] f = { "Tümü", "Direkt", "Gruplar" };
        int fx = x + 8;
        for (int i = 0; i < f.length; i++) {
            int fw = chipW(g, f[i]);
            if (fx + fw > x + w - 6) break;
            if (chip(h, "cf" + i, f[i], fx, fy, fw, convFilter == i)) convFilter = i;
            fx += fw + 4;
        }
        int ly = fy + 22;
        List<Conversation> list = new ArrayList<>();
        for (Conversation cv : c.conversations) {
            if (convFilter == 1 && cv.group()) continue;
            if (convFilter == 2 && !cv.group()) continue;
            list.add(cv);
        }
        if (list.isEmpty()) {
            String t = c.loaded ? "Henüz mesaj yok" : "Yükleniyor…";
            WestShell.smallText(g, t, x + 10, ly + 4, 0x99FFFFFF);
            return;
        }
        g.scissor(x, ly, x + w, y + hgt - 6);
        for (Conversation cv : list) {
            if (ly + 30 > y + hgt - 6) break;
            boolean sel = cv.id().equals(chat);
            boolean hv = ui.hover(x + 4, ly, w - 8, 30);
            if (sel || hv) Ui.round(g, x + 4, ly, w - 8, 30, 6, sel ? Theme.alpha(ui.t.accent, 0x30) : 0x14FFFFFF);
            badge(g, cv.title(), x + 8, ly + 5, 20, cv.members().stream().anyMatch(Person::online));
            int tx = x + 33, tw = w - 33 - 22;
            g.textBold(ui.fit(cv.title(), tw), tx, ly + 5, 0xFFFFFFFF, false);
            WestShell.smallText(g, ui.fit(cv.last(), (int) (tw / 0.8f)), tx, ly + 17, cv.unread() ? 0xFFFFFFFF : 0x99FFFFFF);
            String ago = ago(cv.lastAt());
            WestShell.smallText(g, ago, x + w - 8 - WestShell.small(g, ago), ly + 6, 0x88FFFFFF);
            if (cv.unread()) Ui.round(g, x + w - 13, ly + 18, 5, 5, 3, ui.t.accent | 0xFF000000);
            if (ui.clicked(x + 4, ly, w - 8, 30)) {
                WestHud.game.click();
                chat = cv.id();
                chatTitle = cv.title();
                focus = 3;
            }
            ly += 32;
        }
        g.noScissor();
    }

    // ───── Orta: arkadaşlar ─────

    private void friends(HomeScreen h, int x, int y, int w, int hgt) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        StatsPage.panel(g, x, y, w, hgt);
        if (h.iconButton("sback", Icon.BACK, x + 6, y + 6, 18, "Geri", 0)) {
            h.goHome();
            return;
        }
        WestShell.bigText(g, "Arkadaşlar", x + 30, y + 9, 0xFFFFFFFF, w < 330 ? 1.1f : 1.3f);
        boolean narrow = w < 330;
        int addW = narrow ? 20 : g.textBoldWidth("Arkadaş ekle") + 28;
        if (h.outlineButton("fadd", narrow ? "" : "Arkadaş ekle", Icon.USER_PLUS, x + w - addW - 8, y + 6, addW, 18, false)) {
            adding = !adding;
            focus = adding ? 2 : 0;
            addResult = null;
        }
        int sx = x + 30 + Math.round(g.textBoldWidth("Arkadaşlar") * (w < 330 ? 1.1f : 1.3f)) + 10;
        int sw = x + w - addW - 16 - sx;
        if (sw > 50) field(h, "Arkadaş ara", search, focus == 1, sx, y + 6, sw, 18, 1);

        int fy = y + 30;
        String[] f = { "Tümü", "Çevrimiçi", "İstekler" + (c.requests.isEmpty() ? "" : " " + c.requests.size()) };
        int fx = x + 10;
        for (int i = 0; i < f.length; i++) {
            int fw = chipW(g, f[i]);
            if (fx + fw > x + w - 6) break;
            if (chip(h, "ff" + i, f[i], fx, fy, fw, friendFilter == i)) friendFilter = i;
            fx += fw + 4;
        }
        int ly = fy + 24;
        if (adding) {
            Ui.round(g, x + 8, ly, w - 16, 26, 7, 0x14FFFFFF);
            int bw = 50;
            field(h, "West kullanıcı adı", addName, focus == 2, x + 13, ly + 4, w - 26 - bw - 6, 18, 2);
            if (h.accentButton("fsend", "Ekle", null, x + w - 13 - bw, ly + 4, bw, 18)) submitAdd();
            ly += 30;
            if (addResult != null) {
                WestShell.smallText(g, ui.fit(addResult, (int) ((w - 20) / 0.8f)), x + 12, ly, 0xCCFFFFFF);
                ly += 12;
            }
        }

        if (friendFilter == 2) {
            if (c.requests.isEmpty()) {
                h.emptyMessage(x + w / 2, (ly + y + hgt) / 2, "Bekleyen istek yok", "Biri seni eklediğinde burada görünür.", null);
                return;
            }
            for (Person p : c.requests) {
                if (ly + 30 > y + hgt - 6) break;
                personRow(h, p, x + 8, ly, w - 16, true);
                ly += 32;
            }
            return;
        }
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<Person> list = new ArrayList<>();
        for (Person p : c.friends) {
            if (friendFilter == 1 && !p.online()) continue;
            if (!q.isEmpty() && !p.display().toLowerCase(Locale.ROOT).contains(q) && !p.username().toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(p);
        }
        if (list.isEmpty()) {
            if (c.friends.isEmpty()) {
                if (h.emptyMessage(x + w / 2, (ly + y + hgt) / 2, c.loaded ? "Henüz arkadaşın yok" : "Yükleniyor…", "Kullanıcı adıyla arkadaş ekle; çevrimiçi olunca burada görürsün.", c.loaded ? "Arkadaş ekle" : null)) {
                    adding = true;
                    focus = 2;
                }
            } else {
                h.emptyMessage(x + w / 2, (ly + y + hgt) / 2, friendFilter == 1 ? "Kimse çevrimiçi değil" : "Eşleşen yok", friendFilter == 1 ? "Arkadaşların oyuna girince burada görünür." : "Başka bir isim dene.", null);
            }
            return;
        }
        g.scissor(x, ly, x + w, y + hgt - 6);
        int start = ly - Math.round(scroll);
        int online = 0;
        for (Person p : list) if (p.online()) online++;
        boolean onlineHeader = false, offlineHeader = false;
        for (Person p : list) {
            if (p.online() && !onlineHeader) {
                onlineHeader = true;
                sectionHead(g, "ÇEVRİMİÇİ — " + online, x + 12, start + 3);
                start += 14;
            } else if (!p.online() && !offlineHeader) {
                offlineHeader = true;
                sectionHead(g, "ÇEVRİMDIŞI — " + (list.size() - online), x + 12, start + 3);
                start += 14;
            }
            if (start + 30 >= ly && start <= y + hgt) personRow(h, p, x + 8, start, w - 16, false);
            start += 32;
        }
        g.noScissor();
        float max = Math.max(0, start + Math.round(scroll) - (y + hgt - 6));
        scroll = Math.max(0, Math.min(max, scroll));
    }

    private void personRow(HomeScreen h, Person p, int x, int y, int w, boolean request) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        boolean hv = ui.hover(x, y, w, 30);
        if (hv) Ui.round(g, x, y, w, 30, 7, 0x14FFFFFF);
        badge(g, p.display(), x + 4, y + 5, 20, p.online());
        int tx = x + 30;
        boolean compact = w < 260;
        int actions = request ? (compact ? 46 : 120) : (compact ? 24 : 74);
        g.textBold(ui.fit(p.display(), w - actions - 40), tx, y + 5, 0xFFFFFFFF, false);
        String sub = request ? "@" + p.username() + " seni eklemek istiyor" : p.online() ? (p.activity().isEmpty() ? statusName(p.status()) : p.activity()) : "Çevrimdışı";
        WestShell.smallText(g, ui.fit(sub, (int) ((w - actions - 40) / 0.8f)), tx, y + 17, p.online() ? 0xCC8EE6B6 : 0x88FFFFFF);
        if (request) {
            if (compact) {
                if (h.accentButton("acc" + p.id(), "", Icon.CHECK, x + w - 46, y + 6, 20, 18)) c.accept(p.id(), true);
                if (h.outlineButton("dec" + p.id(), "", Icon.CLOSE, x + w - 23, y + 6, 20, 18, false)) c.accept(p.id(), false);
            } else {
                if (h.accentButton("acc" + p.id(), "Kabul", Icon.CHECK, x + w - 120, y + 6, 62, 18)) c.accept(p.id(), true);
                if (h.outlineButton("dec" + p.id(), "Reddet", null, x + w - 54, y + 6, 50, 18, false)) c.accept(p.id(), false);
            }
        } else if (h.outlineButton("msg" + p.id(), compact ? "" : "Mesaj", Icon.CHAT, x + w - (compact ? 24 : 74), y + 6, compact ? 20 : 70, 18, false)) {
            String title = p.display();
            c.openDm(p.id(), id -> {
                chat = id;
                chatTitle = title;
                focus = 3;
            });
        }
    }

    private static void sectionHead(Gfx g, String s, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(0.68f);
        WestShell.brand(g, s, 0, 0, 0x88FFFFFF, 0.8f);
        g.pop();
    }

    // ───── Orta: sohbet ─────

    private void chatPanel(HomeScreen h, int x, int y, int w, int hgt) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        StatsPage.panel(g, x, y, w, hgt);
        if (h.iconButton("cback", Icon.BACK, x + 6, y + 6, 18, "Arkadaşlar", 0)) {
            chat = null;
            focus = 0;
            return;
        }
        WestShell.bigText(g, ui.fit(chatTitle, Math.round((w - 60) / 1.2f)), x + 30, y + 10, 0xFFFFFFFF, 1.2f);
        g.fill(x + 8, y + 30, x + w - 8, y + 31, 0x14FFFFFF);
        int inputY = y + hgt - 28;
        // Mesajlar alttan yukarı
        int by = inputY - 6;
        List<Message> ms = c.messages;
        g.scissor(x, y + 32, x + w, inputY - 2);
        for (int i = ms.size() - 1; i >= 0 && by > y + 32; i--) {
            Message m = ms.get(i);
            boolean mine = m.sender().equals(c.me);
            String body = m.body().startsWith("[west-davet]") ? "Dünya daveti gönderdi (Seni bekleyenler bölümünde)" : m.body();
            List<String> lines = WestShell.wrap(g, body, Math.max(60, w * 2 / 3 - 30));
            int bh = lines.size() * 10 + 8, bw = 0;
            for (String l : lines) bw = Math.max(bw, g.textWidth(l));
            bw += 14;
            String time = clock(m.at());
            by -= bh + 13;
            int bx = mine ? x + w - 10 - bw : x + 32;
            if (!mine) badge(g, chatTitle, x + 10, by + bh - 18, 18, false);
            Ui.round(g, bx, by, bw, bh, 8, mine ? ui.t.accent | 0xFF000000 : 0x2AFFFFFF);
            int ty = by + 5;
            for (String l : lines) {
                g.text(l, bx + 7, ty, mine ? ui.t.onAccent : 0xFFFFFFFF, false);
                ty += 10;
            }
            WestShell.smallText(g, time, mine ? bx + bw - WestShell.small(g, time) - 2 : bx + 2, by + bh + 2, 0x77FFFFFF);
        }
        g.noScissor();
        if (ms.isEmpty()) WestShell.smallText(g, "Henüz mesaj yok. İlk mesajı sen yaz!", x + 12, inputY - 16, 0x88FFFFFF);
        int sendW = 26;
        field(h, "Mesaj yaz…", draft, focus == 3, x + 8, inputY, w - 16 - sendW - 4, 20, 3);
        if (h.accentButton("send", "", Icon.ARROW, x + w - 8 - sendW, inputY, sendW, 20)) submitChat();
    }

    // ───── Sağ: seni bekleyenler ─────

    private void waiting(HomeScreen h, int x, int y, int w, int hgt) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        StatsPage.panel(g, x, y, w, hgt);
        WestShell.bigText(g, "Seni bekleyenler", x + 10, y + 10, 0xFFFFFFFF, 1.1f);
        int ly = y + 30;
        if (c.invites.isEmpty() && c.requests.isEmpty()) {
            h.emptyMessage(x + w / 2, y + hgt / 2 + 6, "Bekleyen bir şey yok", "Davetler ve istekler burada.", null);
            return;
        }
        for (Invite inv : c.invites) {
            if (ly + 40 > y + hgt - 4) break;
            Ui.round(g, x + 6, ly, w - 12, 38, 7, 0x14FFFFFF);
            g.textBold(ui.fit(inv.from().display(), w - 70), x + 12, ly + 5, 0xFFFFFFFF, false);
            boolean fits = inv.version().isEmpty() || inv.version().equals(WestHud.game.minecraftVersion());
            String sub = "Davet: " + inv.world() + (inv.version().isEmpty() ? "" : " · " + inv.version());
            WestShell.smallText(g, ui.fit(sub, (int) ((w - 70) / 0.8f)), x + 12, ly + 17, 0xBBFFFFFF);
            if (!fits) WestShell.smallText(g, ui.fit("Bu davet için launcher'dan " + inv.version() + " instance'ı aç", (int) ((w - 24) / 0.8f)), x + 12, ly + 27, 0xFFF2C14E);
            else if (h.accentButton("join" + inv.at(), "Katıl", Icon.PLAY, x + w - 62, ly + 10, 54, 18)) WestHud.game.connect(inv.world(), inv.address());
            ly += 42;
        }
        if (!c.requests.isEmpty() && ly + 20 < y + hgt) {
            String t = c.requests.size() + " arkadaşlık isteği";
            if (h.outlineButton("reqs", t, Icon.USER_PLUS, x + 6, ly, w - 12, 18, true)) {
                chat = null;
                friendFilter = 2;
            }
        }
    }

    // ───── Yapı taşları ─────

    /** Çip genişliği (küçük yazı) */
    private static int chipW(Gfx g, String label) {
        return Math.round(g.textBoldWidth(label) * 0.85f) + 12;
    }

    private static boolean chip(HomeScreen h, String id, String label, int x, int y, int w, boolean active) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, 16);
        Ui.round(g, x, y, w, 16, 5, active ? ui.t.accent | 0xFF000000 : on ? 0x30FFFFFF : 0x1AFFFFFF);
        g.push();
        g.translate(x + (w - g.textBoldWidth(label) * 0.85f) / 2f, y + 4.5f);
        g.scale(0.85f);
        g.textBold(label, 0, 0, active ? ui.t.onAccent : 0xEEFFFFFF, false);
        g.pop();
        if (ui.clicked(x, y, w, 16)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private void field(HomeScreen h, String placeholder, String value, boolean focused, int x, int y, int w, int hh, int id) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, hh);
        Ui.round(g, x, y, w, hh, 6, focused ? 0x99000000 : on ? 0x80000000 : 0x66000000);
        Ui.outline(g, x, y, w, hh, 6, focused ? Theme.alpha(ui.t.accent, 0xCC) : 0x26FFFFFF);
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        String shown = value.isEmpty() && !focused ? placeholder : value + (focused && blink ? "|" : "");
        String fitted = shown;
        while (g.textWidth(fitted) > w - 12 && fitted.length() > 1) fitted = fitted.substring(1);
        g.text(fitted, x + 6, y + (hh - 8) / 2, value.isEmpty() && !focused ? 0x77FFFFFF : 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, hh)) focus = id;
    }

    private static void badge(Gfx g, String name, int x, int y, int s, boolean online) {
        String ch = name.isEmpty() ? "?" : name.substring(0, 1).toUpperCase(Locale.ROOT);
        int hue = Math.abs(name.hashCode());
        int[] colors = { 0xFF6EA8D6, 0xFF70C48E, 0xFFE8A25C, 0xFFEC5A82, 0xFFA08CB8, 0xFFF2C14E };
        Ui.round(g, x, y, s, s, 6, colors[hue % colors.length]);
        g.textBold(ch, x + (s - g.textBoldWidth(ch)) / 2, y + (s - 8) / 2, 0xFF101114, false);
        if (online) {
            Ui.round(g, x + s - 6, y + s - 6, 8, 8, 4, 0xFF101114);
            Ui.round(g, x + s - 5, y + s - 5, 6, 6, 3, 0xFF4CC38A);
        }
    }

    private static String statusName(String s) {
        int i = java.util.Arrays.asList(STATUSES).indexOf(s);
        return i < 0 ? "Çevrimiçi" : STATUS_NAMES[i];
    }

    private static String clock(String iso) {
        try {
            var t = java.time.OffsetDateTime.parse(iso).atZoneSameInstant(java.time.ZoneId.systemDefault());
            return String.format(Locale.ROOT, "%02d:%02d", t.getHour(), t.getMinute());
        } catch (Exception e) {
            return "";
        }
    }

    private static String ago(String iso) {
        try {
            long s = (System.currentTimeMillis() - java.time.OffsetDateTime.parse(iso).toInstant().toEpochMilli()) / 1000;
            if (s < 60) return "şimdi";
            if (s < 3600) return (s / 60) + "dk";
            if (s < 86400) return (s / 3600) + "sa";
            return (s / 86400) + "g";
        } catch (Exception e) {
            return "";
        }
    }

    private void submitAdd() {
        String n = addName.trim();
        if (n.isEmpty()) return;
        addResult = "Ekleniyor…";
        c.add(n, err -> addResult = err == null ? "İstek gönderildi. O da seni eklediğinde arkadaş olursunuz." : err);
        addName = "";
    }

    private void submitChat() {
        String t = draft.trim();
        if (t.isEmpty() || chat == null) return;
        c.send(chat, t);
        draft = "";
    }

    boolean keyPressed(int key) {
        if (focus == 0) return false;
        boolean back = key == 259;
        if (key == 256) {
            focus = 0;
            return true;
        }
        if (key == 257 || key == 335) {
            if (focus == 2) submitAdd();
            if (focus == 3) submitChat();
            return true;
        }
        if (back) {
            if (focus == 1 && !search.isEmpty()) search = search.substring(0, search.length() - 1);
            if (focus == 2 && !addName.isEmpty()) addName = addName.substring(0, addName.length() - 1);
            if (focus == 3 && !draft.isEmpty()) draft = draft.substring(0, draft.length() - 1);
            return true;
        }
        return false;
    }

    boolean charTyped(char ch) {
        if (focus == 0 || ch < 32) return false;
        if (focus == 1 && search.length() < 30) search += ch;
        if (focus == 2 && addName.length() < 30) addName += ch;
        if (focus == 3 && draft.length() < 500) draft += ch;
        return true;
    }

    void scroll(double amount) {
        scroll -= (float) amount * 24;
    }
}
