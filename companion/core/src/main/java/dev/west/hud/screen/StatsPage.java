package dev.west.hud.screen;

import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** İstatistikler: toplam süre, bu hafta, oturumlar, en çok oynananlar ve Minecraft toplamları. */
final class StatsPage {
    private static final String[] DAYS = { "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz" };

    private StatsPage() {}

    static void render(HomeScreen h, int x, int y, int w, int hgt, int cardX, int cardY, int cw) {
        Gfx g = h.ui.g;
        Theme t = h.ui.t;
        var st = WestHud.stats;
        long total = st.total();
        long[] week = st.week();
        long weekSum = 0;
        for (long v : week) weekSum += v;

        // Üst panel
        int topH = Math.max(110, Math.min(170, hgt * 45 / 100));
        panel(g, x, y, w, topH);
        if (h.iconButton("sback", Icon.BACK, x + 6, y + 6, 18, "Geri", 0)) {
            h.goHome();
            return;
        }
        WestShell.bigText(g, "İstatistikler", x + 30, y + 10, 0xFFFFFFFF, 1.3f);
        String note = "Yalnızca bu bilgisayarda kaydedilir";
        WestShell.smallText(g, note, x + w - 10 - WestShell.small(g, note), y + 12, 0xAAFFFFFF);

        int cy = y + 32;
        int colA = Math.max(110, (w - 20) * 2 / 5);
        caps(g, "TOPLAM OYUN SÜRESİ", x + 12, cy);
        float big = Math.max(2f, Math.min(3.4f, topH / 50f));
        WestShell.bigText(g, dur(total), x + 12, cy + 12, 0xFFFFFFFF, big);
        int inWorlds = 0;
        for (long v : st.data.worlds.values()) inWorlds += (int) v;
        WestShell.smallText(g, dur(inWorlds) + " dünyalarda", x + 12, cy + 14 + Math.round(9 * big) + 4, 0xBBFFFFFF);

        int mx = x + 12 + colA;
        g.fill(mx - 8, cy, mx - 7, cy + Math.round(9 * big) + 26, 0x1FFFFFFF);
        caps(g, "BU HAFTA", mx, cy);
        WestShell.bigText(g, dur(weekSum), mx, cy + 12, 0xFFFFFFFF, Math.max(1.6f, big * 0.65f));
        WestShell.smallText(g, "Son 7 gün", mx, cy + 14 + Math.round(9 * big * 0.65f) + 4, 0xBBFFFFFF);

        // Haftalık çubuklar
        int barsX = mx + Math.max(70, (x + w - mx) / 3);
        int barsW = x + w - 12 - barsX;
        int barH = Math.round(9 * big) + 10;
        if (barsW > 70) {
            long max = 1;
            for (long v : week) max = Math.max(max, v);
            int bw = Math.max(6, (barsW - 6 * 6) / 7);
            for (int i = 0; i < 7; i++) {
                int bx = barsX + i * (bw + 6);
                Ui.round(g, bx, cy, bw, barH, 3, 0x1AFFFFFF);
                int fh = week[i] == 0 ? 2 : Math.max(3, Math.round(barH * week[i] / (float) max));
                Ui.round(g, bx, cy + barH - fh, bw, fh, 3, i == 6 ? t.accent | 0xFF000000 : Theme.alpha(t.accent, 0x99));
                DayOfWeek d = LocalDate.now().minusDays(6 - i).getDayOfWeek();
                String l = DAYS[d.getValue() - 1];
                if (WestShell.small(g, l) > bw + 4) l = l.substring(0, 1);
                WestShell.smallText(g, l, bx + (bw - WestShell.small(g, l)) / 2, cy + barH + 4, i == 6 ? 0xFFFFFFFF : 0xAAFFFFFF);
            }
        }

        int ry = y + topH - 22;
        g.fill(x + 10, ry - 6, x + w - 10, ry - 5, 0x14FFFFFF);
        long sessions = Math.max(0, st.data.sessions);
        long avg = sessions == 0 ? 0 : st.data.sessionSeconds / sessions;
        int sx = x + 12;
        sx = figure(g, String.valueOf(sessions), "oturum", sx, ry);
        sx = figure(g, String.valueOf(st.data.worlds.size()), "dünya oynandı", sx + 14, ry);
        figure(g, dur(avg), "ortalama oturum", sx + 14, ry);

        // Alt panel: en çok oynananlar
        int by = y + topH + 8, bh = hgt - topH - 8;
        if (bh > 50) {
            panel(g, x, by, w, bh);
            int half = (w - 1) / 2;
            g.fill(x + half, by + 10, x + half + 1, by + bh - 10, 0x14FFFFFF);
            topList(h, "En çok oynanan dünyalar", st.data.worlds, true, x, by, half, bh);
            topList(h, "En çok oynanan sunucular", st.data.servers, false, x + half + 1, by, w - half - 1, bh);
        }

        // Sağ üst: toplamlar
        int dy = y, dh = cardY - 8 - y;
        if (dh >= 60) {
            panel(g, cardX, dy, cw, dh);
            WestShell.bigText(g, "Toplamlar", cardX + 10, dy + 10, 0xFFFFFFFF, 1.15f);
            Map<String, Long> v = st.vanilla(WestHud.game.configDir().getParent());
            String[][] rows = {
                    { "Yürünen mesafe", dist(v.getOrDefault("walk_one_cm", 0L)) },
                    { "Koşulan mesafe", dist(v.getOrDefault("sprint_one_cm", 0L)) },
                    { "Zıplama", String.valueOf(v.getOrDefault("jump", 0L)) },
                    { "Öldürülen yaratık", String.valueOf(v.getOrDefault("mob_kills", 0L)) },
                    { "Ölüm", String.valueOf(v.getOrDefault("deaths", 0L)) },
                    { "Dünyalarda geçen süre", dur(v.getOrDefault("play_time", 0L) / 20) },
            };
            int ry2 = dy + 30;
            for (String[] r : rows) {
                if (ry2 + 14 > dy + dh - 4) break;
                g.text(r[0], cardX + 10, ry2, 0xDDFFFFFF, false);
                g.textBold(r[1], cardX + cw - 10 - g.textBoldWidth(r[1]), ry2, 0xFFFFFFFF, false);
                g.fill(cardX + 10, ry2 + 12, cardX + cw - 10, ry2 + 13, 0x14FFFFFF);
                ry2 += 18;
            }
        }
    }

    private static void topList(HomeScreen h, String title, Map<String, Long> map, boolean worlds, int x, int y, int w, int hgt) {
        Gfx g = h.ui.g;
        Theme t = h.ui.t;
        WestShell.bigText(g, title, x + 10, y + 10, 0xFFFFFFFF, 1.1f);
        List<Map.Entry<String, Long>> list = new ArrayList<>(map.entrySet());
        list.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));
        if (list.isEmpty()) {
            String t1 = worlds ? "Henüz dünya yok" : "Henüz sunucu yok";
            String t2 = worlds ? "Bir dünyada oynadıkça burada görünür." : "Vanilla sunucu süresini kaydetmez; bundan sonra sayılıyor.";
            int cy = y + hgt / 2;
            g.textBold(t1, x + (w - g.textBoldWidth(t1)) / 2, cy - 8, 0xFFFFFFFF, false);
            String f = h.ui.fit(t2, (int) ((w - 16) / 0.8f));
            WestShell.smallText(g, f, x + (w - WestShell.small(g, f)) / 2, cy + 5, 0xAAFFFFFF);
            return;
        }
        long max = list.get(0).getValue();
        int ry = y + 30;
        for (int i = 0; i < list.size() && ry + 20 <= y + hgt - 6; i++, ry += 24) {
            var e = list.get(i);
            g.text(String.valueOf(i + 1), x + 10, ry + 5, 0xAAFFFFFF, false);
            int ix = x + 22;
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
            g.textBold(h.ui.fit(e.getKey(), tw - g.textWidth(d) - 8), tx, ry + 1, 0xFFFFFFFF, false);
            g.text(d, x + w - 10 - g.textWidth(d), ry + 1, 0xCCFFFFFF, false);
            Ui.round(g, tx, ry + 14, tw, 2, 1, 0x1AFFFFFF);
            Ui.round(g, tx, ry + 14, Math.max(2, Math.round(tw * e.getValue() / (float) Math.max(1, max))), 2, 1, t.accent | 0xFF000000);
        }
    }

    private static int figure(Gfx g, String big, String label, int x, int y) {
        WestShell.bigText(g, big, x, y, 0xFFFFFFFF, 1.4f);
        int bw = Math.round(g.textBoldWidth(big) * 1.4f);
        g.text(label, x + bw + 5, y + 3, 0xCCFFFFFF, false);
        return x + bw + 5 + g.textWidth(label);
    }

    private static void caps(Gfx g, String s, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(0.7f);
        WestShell.brand(g, s, 0, 0, 0xCCFFFFFF, 0.8f);
        g.pop();
    }

    static void panel(Gfx g, int x, int y, int w, int h) {
        Ui.round(g, x, y, w, h, 10, 0xC20D0E15);
        Ui.outline(g, x, y, w, h, 10, 0x1AFFFFFF);
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
        return String.format(java.util.Locale.ROOT, "%.1f km", m / 1000);
    }
}
