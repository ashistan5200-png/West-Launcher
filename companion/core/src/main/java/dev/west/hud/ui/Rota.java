package dev.west.hud.ui;

import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons.Icon;

/**
 * "Rota" tasarım dili (launcher ve siteyle aynı): düz yüzeyler, 1px çizgiler, amber yalnızca birincil eylem ve
 * seçili durum için. Oyun içi ekranlar pencere, kenar çubuğu, gezinme öğesi ve sekmeleri buradan çizer ki
 * hepsi aynı görünsün.
 */
public final class Rota {
    /** Pencere zemini ve kenar çubuğu zemini */
    public static final int PANEL = 0xF60E0F13, SIDE = 0xF60B0C0F, CARD = 0xFF15161B, CARD_HOVER = 0xFF1B1D23;
    /** 1px ayırıcı çizgi, ikincil ve soluk yazı */
    public static final int LINE = 0x16FFFFFF, TEXT = 0xFFECEDF0, MUTED = 0xFF969AA5, FAINT = 0xFF666A76;
    public static final int RADIUS = 8, RADIUS_SM = 6;

    private Rota() {}

    /** Pencere: düz zemin, ince çerçeve; gölge yerine hafif koyu bir alt hat */
    public static void window(Gfx g, int x, int y, int w, int h) {
        Ui.round(g, x, y + 2, w, h, RADIUS + 1, 0x40000000);
        Ui.round(g, x, y, w, h, RADIUS, PANEL);
        Ui.outline(g, x, y, w, h, RADIUS, LINE);
    }

    /** Kenar çubuğu zemini ve sağındaki ayırıcı çizgi */
    public static void side(Gfx g, int x, int y, int w, int h) {
        Ui.round(g, x, y, w, h, RADIUS, SIDE);
        g.fill(x + w - 1, y + 8, x + w, y + h - 8, LINE);
    }

    /** Küçük büyük-harf bölüm başlığı (ör. "INSTANCE'LAR") */
    public static void section(Gfx g, String label, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(0.7f);
        g.textBold(label.toUpperCase(java.util.Locale.ROOT), 0, 0, FAINT, false);
        g.pop();
    }

    /**
     * Gezinme öğesi: seçiliyse hafif zemin + solda amber çizgi (launcher'daki gibi), üzerine gelinince hafif zemin.
     * badge: sağdaki sayı (0 ise yok); warn: sayı amber (bekleyen iş) mi. Tıklandıysa true.
     */
    public static boolean nav(Ui ui, Icon icon, String label, int x, int y, int w, boolean active, float hover, int badge, boolean warn) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int h = 18;
        if (active) Ui.round(g, x, y, w, h, RADIUS_SM, 0x14FFFFFF);
        else if (hover > 0.01f) Ui.round(g, x, y, w, h, RADIUS_SM, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x0D * hover))));
        if (active) g.fill(x - 6, y + 4, x - 4, y + h - 4, t.accent | 0xFF000000);
        int c = active ? TEXT : Theme.mix(MUTED, TEXT, hover);
        Icons.draw(g, icon, x + 7, y + 4, 10, c);
        String n = badge > 99 ? "99+" : String.valueOf(badge);
        int bw = badge > 0 ? Math.max(14, g.textWidth(n) + 8) : 0;
        g.text(ui.fit(label, w - 30 - bw), x + 23, y + 5, c, false);
        if (badge > 0) {
            int bx = x + w - 4 - bw;
            Ui.round(g, bx, y + 3, bw, 12, 6, warn ? (t.accent | 0xFF000000) : 0x24FFFFFF);
            g.text(n, bx + (bw - g.textWidth(n)) / 2, y + 5, warn ? t.onAccent : TEXT, false);
        }
        return ui.clicked(x, y, w, h);
    }

    /** Sekme şeridi: seçilenin altında amber çizgi; yazı genişliğine göre boyutlanır. Seçileni döner. */
    public static int tabs(Ui ui, String[] labels, int sel, int x, int y, int maxW) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int total = 0;
        for (String l : labels) total += g.textWidth(l) + 16;
        float k = Math.min(1f, maxW / (float) total);
        int cx = x;
        g.fill(x, y + 15, x + Math.min(maxW, Math.round(total * k)), y + 16, LINE);
        for (int i = 0; i < labels.length; i++) {
            int bw = Math.round((g.textWidth(labels[i]) + 16) * k);
            boolean on = i == sel;
            boolean hv = ui.hover(cx, y, bw, 16);
            String l = ui.fit(labels[i], bw - 6);
            g.text(l, cx + (bw - g.textWidth(l)) / 2, y + 3, on ? TEXT : hv ? 0xFFC8CBD3 : MUTED, false);
            if (on) g.fill(cx + 4, y + 14, cx + bw - 4, y + 16, t.accent | 0xFF000000);
            if (ui.clicked(cx, y, bw, 16)) sel = i;
            cx += bw;
        }
        return sel;
    }
}
