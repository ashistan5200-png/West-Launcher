package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * İstatistikler: üstte dört özet kartı ve 14 günlük grafik, altta en çok oynanan dünyalar ve
 * sunucular, sağda Minecraft toplamları ve rekorlar. Sayılar açılışta yumuşakça sayarak gelir.
 */
final class StatsPage {
    /** Seçili dilde kısa gün adı (Pzt / Mon / Mo) */
    private static String dayName(java.time.DayOfWeek d) {
        String s = d.getDisplayName(java.time.format.TextStyle.SHORT, Tr.locale());
        return s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
    }
    private static long openedAt = System.nanoTime();

    private StatsPage() {}

    static void reset() {
        openedAt = System.nanoTime();
    }

    /** 0→1 açılış animasyonu (gecikmeli) */
    private static float grow(float delay) {
        float t = (System.nanoTime() - openedAt) / 1e9f - delay;
        t = Math.max(0, Math.min(1, t / 0.9f));
        return 1 - (float) Math.pow(1 - t, 3);
    }

    static void render(HomeScreen h, int x, int y, int w, int hgt, int cardX, int cardY, int cw) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        Theme t = ui.t;
        var st = WestHud.stats;
        long total = st.total();
        long[] d14 = st.days(14);
        long week = 0, prev = 0;
        for (int i = 0; i < 7; i++) {
            prev += d14[i];
            week += d14[7 + i];
        }
        long today = d14[13];
        int streak = st.streak();

        // ── Başlık
        panel(g, x, y, w, 26);
        if (h.iconButton("sback", Icon.BACK, x + 5, y + 4, 18, Tr.t("Geri"), 0)) {
            h.goHome();
            return;
        }
        WestShell.bigText(g, Tr.t("İstatistikler"), x + 28, y + 8, 0xFFFFFFFF, 1.25f);
        String note = Tr.t("Yalnızca bu bilgisayarda");
        int nw = WestShell.small(g, note) + 22;
        Ui.round(g, x + w - nw - 6, y + 6, nw, 14, 7, 0x1AFFFFFF);
        Icons.draw(g, Icon.SHIELD, x + w - nw, y + 9, 8, 0xAAFFFFFF);
        WestShell.smallText(g, note, x + w - nw + 13, y + 9, 0xAAFFFFFF);

        // ── Özet kartları
        int ky = y + 32, kh = 46, gap = 6;
        int kw = (w - gap * 3) / 4;
        float a = grow(0);
        kpi(h, x, ky, kw, kh, Icon.CLOCK, "TOPLAM", StatsPage.dur((long) (total * a)), sub(st.data.worlds.size() + Tr.t(" dünya, ") + st.data.servers.size() + " sunucu"), 0);
        String delta = prev == 0 ? (week > 0 ? "yeni" : "—") : ((week >= prev ? "+" : "") + Math.round((week - prev) * 100f / prev) + Tr.t("% geçen haftaya göre"));
        kpi(h, x + (kw + gap), ky, kw, kh, Icon.STATS, Tr.t("BU HAFTA"), dur((long) (week * a)), delta, week >= prev ? 0xFF8EE6B6 : 0xFFFF8094);
        kpi(h, x + 2 * (kw + gap), ky, kw, kh, Icon.PLAY, Tr.t("BUGÜN"), dur((long) (today * a)), st.current > 0 ? Tr.t("Şu an oynuyorsun") : Tr.t("Son 24 saat"), 0);
        kpi(h, x + 3 * (kw + gap), ky, w - 3 * (kw + gap), kh, Icon.STAR, Tr.t("SERİ"), Math.round(streak * a) + Tr.t(" gün"), streak > 1 ? Tr.t("Art arda oynadın") : Tr.t("Yarın da gel!"), 0);

        // ── 14 günlük grafik
        int gy = ky + kh + 6;
        int gh = Math.max(70, Math.min(120, hgt * 30 / 100));
        panel(g, x, gy, w, gh);
        caps(g, Tr.t("SON 14 GÜN"), x + 10, gy + 8);
        long max = 1;
        for (long v : d14) max = Math.max(max, v);
        int bx0 = x + 10, bw = (w - 20 - 13 * 4) / 14, by = gy + 22, bh = gh - 22 - 16;
        // Yardımcı çizgiler
        for (int i = 1; i <= 2; i++) g.fill(bx0, by + bh * i / 3, x + w - 10, by + bh * i / 3 + 1, 0x0DFFFFFF);
        int hover = -1;
        for (int i = 0; i < 14; i++) {
            int cx = bx0 + i * (bw + 4);
            float gr = grow(0.05f * i);
            int fh = d14[i] == 0 ? 2 : Math.max(3, Math.round(bh * d14[i] / (float) max * gr));
            boolean on = ui.hover(cx, by, bw, bh + 12);
            if (on) hover = i;
            Ui.round(g, cx, by, bw, bh, 3, on ? 0x1FFFFFFF : 0x0FFFFFFF);
            int col = i == 13 ? t.accent | 0xFF000000 : Theme.alpha(t.accent, on ? 0xE0 : 0x8C);
            Ui.round(g, cx, by + bh - fh, bw, fh, Math.min(3, bw / 2), col);
            LocalDate day = LocalDate.now().minusDays(13 - i);
            String l = dayName(day.getDayOfWeek());
            if (WestShell.small(g, l) > bw - 2) l = l.substring(0, 1);
            if (bw >= 10 || i % 2 == 1) WestShell.smallText(g, l, cx + (bw - WestShell.small(g, l)) / 2, by + bh + 4, i == 13 ? 0xFFFFFFFF : 0x88FFFFFF);
        }
        if (hover >= 0) {
            LocalDate day = LocalDate.now().minusDays(13 - hover);
            String tip = day.getDayOfMonth() + " " + month(day.getMonthValue()) + " · " + (d14[hover] == 0 ? Tr.t("oynanmadı") : dur(d14[hover]));
            int tw = g.textWidth(tip) + 12;
            int tx = Math.max(x + 4, Math.min(x + w - tw - 4, bx0 + hover * (bw + 4) + bw / 2 - tw / 2));
            Ui.round(g, tx, by - 4, tw, 14, 5, 0xF00C0D12);
            Ui.outline(g, tx, by - 4, tw, 14, 5, Theme.alpha(t.accent, 0x88));
            g.text(tip, tx + 6, by - 1, 0xFFFFFFFF, false);
        }

        // ── En çok oynananlar
        int ly = gy + gh + 6, lh = y + hgt - ly;
        if (lh > 50) {
            int half = (w - 6) / 2;
            panel(g, x, ly, half, lh);
            panel(g, x + half + 6, ly, w - half - 6, lh);
            topList(h, Tr.t("En çok oynanan dünyalar"), Icon.WORLD, st.data.worlds, true, x, ly, half, lh);
            topList(h, Tr.t("En çok oynanan sunucular"), Icon.SERVER, st.data.servers, false, x + half + 6, ly, w - half - 6, lh);
        }

        // ── Sağ sütun: toplamlar + rekorlar
        int dy = y, dh = cardY - 8 - y;
        if (dh >= 60) {
            panel(g, cardX, dy, cw, dh);
            WestShell.bigText(g, Tr.t("Toplamlar"), cardX + 10, dy + 10, 0xFFFFFFFF, 1.15f);
            Map<String, Long> v = st.vanilla(WestHud.game.configDir().getParent());
            Object[][] rows = {
                    { Icon.PIN, Tr.t("Yürünen"), dist(v.getOrDefault("walk_one_cm", 0L)) },
                    { Icon.GAUGE, Tr.t("Koşulan"), dist(v.getOrDefault("sprint_one_cm", 0L)) },
                    { Icon.CHEVRON_DOWN, Tr.t("Zıplama"), num(v.getOrDefault("jump", 0L)) },
                    { Icon.SHIELD, Tr.t("Yenilen yaratık"), num(v.getOrDefault("mob_kills", 0L)) },
                    { Icon.CLOSE, Tr.t("Ölüm"), num(v.getOrDefault("deaths", 0L)) },
                    { Icon.STAR, Tr.t("En uzun oturum"), dur(st.data.longestSession) },
                    { Icon.CLOCK, Tr.t("Ortalama oturum"), dur(st.data.sessions == 0 ? 0 : st.data.sessionSeconds / st.data.sessions) },
                    { Icon.USER, Tr.t("Oturum"), num(st.data.sessions) },
            };
            int ry = dy + 28;
            for (Object[] r : rows) {
                if (ry + 15 > dy + dh - 4) break;
                Ui.round(g, cardX + 8, ry - 2, 14, 14, 4, Theme.alpha(t.accent, 0x30));
                Icons.draw(g, (Icon) r[0], cardX + 11, ry + 1, 8, t.accent | 0xFF000000);
                g.text((String) r[1], cardX + 27, ry + 1, 0xCCFFFFFF, false);
                String val = (String) r[2];
                g.textBold(val, cardX + cw - 10 - g.textBoldWidth(val), ry + 1, 0xFFFFFFFF, false);
                ry += 17;
            }
        }
    }

    private static String sub(String s) {
        return s;
    }

    private static void kpi(HomeScreen h, int x, int y, int w, int hh, Icon icon, String label, String value, String sub, int subColor) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, hh);
        float hv = h.hov("kpi" + label, on);
        panel(g, x, y - Math.round(hv), w, hh);
        // Vurgu şeridi
        Ui.round(g, x + 1, y + 6 - Math.round(hv), 2, hh - 12, 1, Theme.alpha(t.accent, (int) (0x80 + 0x7F * hv)));
        Icons.draw(g, icon, x + w - 18, y + 7 - Math.round(hv), 10, Theme.alpha(t.accent, 0xCC));
        caps(g, label, x + 9, y + 7 - Math.round(hv));
        float scale = Math.min(1.6f, (w - 18) / (float) Math.max(1, g.textBoldWidth(value)));
        WestShell.bigText(g, value, x + 9, y + 17 - Math.round(hv), 0xFFFFFFFF, scale);
        WestShell.smallText(g, h.ui.fit(sub, (int) ((w - 16) / 0.8f)), x + 9, y + hh - 11 - Math.round(hv), subColor != 0 ? subColor : 0x99FFFFFF);
    }

    private static void topList(HomeScreen h, String title, Icon icon, Map<String, Long> map, boolean worlds, int x, int y, int w, int hgt) {
        Ui ui = h.ui;
        Gfx g = ui.g;
        Theme t = ui.t;
        Icons.draw(g, icon, x + 10, y + 10, 10, Theme.alpha(t.accent, 0xDD));
        g.textBold(ui.fit(title, w - 34), x + 25, y + 11, 0xFFFFFFFF, false);
        List<Map.Entry<String, Long>> list = new ArrayList<>(map.entrySet());
        list.sort((p, q) -> Long.compare(q.getValue(), p.getValue()));
        if (list.isEmpty()) {
            String t1 = worlds ? Tr.t("Henüz dünya yok") : Tr.t("Henüz sunucu yok");
            String t2 = worlds ? Tr.t("Oynadıkça burada sıralanır.") : Tr.t("Sunucu süreleri bundan sonra sayılıyor.");
            int cy = y + hgt / 2 + 4;
            g.textBold(t1, x + (w - g.textBoldWidth(t1)) / 2, cy - 8, 0xFFFFFFFF, false);
            String f = ui.fit(t2, (int) ((w - 16) / 0.8f));
            WestShell.smallText(g, f, x + (w - WestShell.small(g, f)) / 2, cy + 5, 0x99FFFFFF);
            return;
        }
        long max = list.get(0).getValue();
        int ry = y + 28;
        for (int i = 0; i < list.size() && ry + 22 <= y + hgt - 4; i++, ry += 25) {
            var e = list.get(i);
            boolean on = ui.hover(x + 5, ry - 2, w - 10, 24);
            if (on) Ui.round(g, x + 5, ry - 2, w - 10, 24, 6, 0x14FFFFFF);
            int rc = i == 0 ? 0xFFF2C14E : i == 1 ? 0xFFC9CED6 : i == 2 ? 0xFFD08A4E : 0x33FFFFFF;
            Ui.round(g, x + 9, ry + 3, 13, 13, 7, rc);
            String rank = String.valueOf(i + 1);
            g.textBold(rank, x + 9 + (13 - g.textBoldWidth(rank)) / 2, ry + 6, i < 3 ? 0xFF101114 : 0xFFFFFFFF, false);
            int ix = x + 27;
            if (worlds) {
                Game.WorldInfo wi = null;
                for (Game.WorldInfo c : h.worlds) if (c.name().equals(e.getKey())) wi = c;
                if (wi != null) h.worldIcon(wi, ix, ry, 18);
                else {
                    Ui.round(g, ix, ry, 18, 18, 4, 0x50000000);
                    Icons.draw(g, Icon.WORLD, ix + 4, ry + 4, 10, 0xAAFFFFFF);
                }
            } else {
                h.serverBadge(new Game.ServerInfo(e.getKey(), e.getKey()), ix, ry, 18, true);
            }
            int tx = ix + 24, tw = x + w - 10 - tx;
            String d = dur(e.getValue());
            g.textBold(ui.fit(e.getKey(), tw - g.textWidth(d) - 8), tx, ry + 1, 0xFFFFFFFF, false);
            g.text(d, x + w - 10 - g.textWidth(d), ry + 1, 0xCCFFFFFF, false);
            Ui.round(g, tx, ry + 14, tw, 3, 1, 0x1AFFFFFF);
            float gr = grow(0.15f + 0.08f * i);
            int fw = Math.max(3, Math.round(tw * e.getValue() / (float) Math.max(1, max) * gr));
            Ui.round(g, tx, ry + 14, fw, 3, 1, t.accent | 0xFF000000);
        }
    }

    private static void caps(Gfx g, String s, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(0.68f);
        WestShell.brand(g, s, 0, 0, 0xAAFFFFFF, 0.9f);
        g.pop();
    }

    static void panel(Gfx g, int x, int y, int w, int h) {
        Ui.round(g, x, y, w, h, 10, 0xC80D0E15);
        Ui.outline(g, x, y, w, h, 10, 0x1AFFFFFF);
    }

    private static String month(int m) {
        String s = java.time.Month.of(m).getDisplayName(java.time.format.TextStyle.SHORT, Tr.locale());
        s = s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    private static String num(long v) {
        if (v < 10_000) return String.valueOf(v);
        if (v < 1_000_000) return String.format(Locale.ROOT, "%.1fB", v / 1000.0);
        return String.format(Locale.ROOT, "%.1fM", v / 1_000_000.0);
    }

    static String dur(long sec) {
        if (sec < 60) return sec + "sn";
        long m = sec / 60;
        if (m < 60) return m + "dk";
        long hh = m / 60;
        if (hh < 24) return hh + "sa " + (m % 60) + "dk";
        return (hh / 24) + "g " + (hh % 24) + "sa";
    }

    private static String dist(long cm) {
        double m = cm / 100.0;
        if (m < 1000) return Math.round(m) + " m";
        return String.format(Locale.ROOT, "%.1f km", m / 1000);
    }
}
