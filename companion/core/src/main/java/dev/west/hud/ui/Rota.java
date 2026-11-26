package dev.west.hud.ui;

import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons.Icon;

import java.util.HashMap;
import java.util.Map;

/**
 * "Rota" tasarım dili (launcher ve siteyle aynı): düz yüzeyler, 1px çizgiler, amber yalnızca birincil eylem ve
 * seçili durum için. Bütün oyun içi West ekranları kendi parçalarını buradan çizer; renk, ölçü ve davranış tek
 * yerde tanımlıdır.
 * <p>
 * Ölçüler GUI pikselidir. Satır yüksekliği 18 (gezinme), 20 (düğme), 30 (liste satırı); köşeler 6/8.
 */
public final class Rota {
    // ───── renkler ─────
    /** Pencere ve kenar çubuğu zemini */
    public static final int PANEL = 0xF60E0F13, SIDE = 0xF60B0C0F;
    /** Kart (liste satırı) zemini ve üzerine gelince */
    public static final int CARD = 0xFF15161B, CARD_HOVER = 0xFF1B1D23;
    /** 1px ayırıcı, birincil / ikincil / soluk yazı */
    public static final int LINE = 0x16FFFFFF, LINE_STRONG = 0x2AFFFFFF, TEXT = 0xFFECEDF0, MUTED = 0xFF969AA5, FAINT = 0xFF666A76;
    public static final int DANGER = 0xFFE5566E, OK = 0xFF4ADE80, WARN = 0xFFE8A33D;
    public static final int RADIUS = 8, RADIUS_SM = 6;

    private Rota() {}

    // ───── hover canlandırması (ekran başına bir harita) ─────

    /** Her ekranın kendi Anim nesnesi olur; üzerine gelme geçişleri 0..1 arasında yumuşar */
    public static final class Anim {
        private final Map<String, Float> v = new HashMap<>();
        private long last = System.nanoTime();
        private float dt;

        /** Kare başında bir kez çağrılır */
        public void frame() {
            long now = System.nanoTime();
            dt = Math.min(0.1f, (now - last) / 1e9f);
            last = now;
        }

        public float get(String key, boolean on) {
            float x = v.getOrDefault(key, on ? 1f : 0f);
            x += ((on ? 1 : 0) - x) * Math.min(1, dt * 16);
            v.put(key, x);
            return x;
        }

        public float dt() {
            return dt;
        }
    }

    // ───── yüzeyler ─────

    /** Pencere: düz zemin, ince çerçeve, gölge yerine hafif koyu alt hat */
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

    /** Ekrana yaslanan düz panel (köşesiz) ve sağ kenarında çizgi */
    public static void dock(Gfx g, int x, int y, int w, int h) {
        g.fill(x, y, x + w, y + h, 0xE60B0C0F);
        g.fill(x + w - 1, y, x + w, y + h, LINE);
    }

    /** Kart: düz zemin, ince çerçeve; hover 0..1 */
    public static void card(Gfx g, int x, int y, int w, int h, float hover) {
        Ui.round(g, x, y, w, h, RADIUS, Theme.mix(CARD, CARD_HOVER, hover));
        Ui.outline(g, x, y, w, h, RADIUS, Theme.mix(LINE, LINE_STRONG, hover));
    }

    /** Yatay ayırıcı */
    public static void rule(Gfx g, int x, int y, int w) {
        g.fill(x, y, x + w, y + 1, LINE);
    }

    // ───── yazı ─────

    /** Sayfa başlığı (1.3x kalın) */
    public static void title(Gfx g, String s, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(1.3f);
        g.textBold(s, 0, 0, TEXT, false);
        g.pop();
    }

    /** Küçük büyük-harf bölüm başlığı (ör. "OYUN") */
    public static void section(Gfx g, String label, int x, int y) {
        g.push();
        g.translate(x, y);
        g.scale(0.7f);
        g.textBold(label.toUpperCase(dev.west.hud.Tr.locale()), 0, 0, FAINT, false);
        g.pop();
    }

    /** 0.8x ikincil yazı */
    public static void small(Gfx g, String s, int x, int y, int color) {
        g.push();
        g.translate(x, y);
        g.scale(0.8f);
        g.text(s, 0, 0, color, false);
        g.pop();
    }

    public static int smallWidth(Gfx g, String s) {
        return Math.round(g.textWidth(s) * 0.8f);
    }

    /** Sığmazsa "…" ile kısaltılmış 0.8x yazı */
    public static void smallFit(Ui ui, String s, int x, int y, int maxW, int color) {
        small(ui.g, ui.fit(s, Math.round(maxW / 0.8f)), x, y, color);
    }

    // ───── kontroller ─────

    public enum Kind { PRIMARY, GHOST, DANGER, QUIET }

    /** Düğme; tıklandıysa true. icon null olabilir. */
    public static boolean button(Ui ui, Anim a, String key, String label, Icon icon, Kind kind, int x, int y, int w, int h, boolean enabled) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean hv = enabled && ui.hover(x, y, w, h);
        float k = a.get(key, hv);
        int acc = t.accent | 0xFF000000;
        int bg, fg, border = 0;
        switch (kind) {
            case PRIMARY -> { bg = Theme.mix(acc, Theme.mix(acc, 0xFFFFFFFF, 0.14f), k); fg = t.onAccent; }
            case DANGER -> { bg = Theme.mix(0x33E5566E, 0x55E5566E, k); fg = 0xFFF5A3B1; }
            case QUIET -> { bg = Theme.alpha(0xFFFFFFFF, (int) (0x10 * k)); fg = Theme.mix(MUTED, TEXT, k); }
            default -> { bg = Theme.mix(0x10FFFFFF, 0x1CFFFFFF, k); fg = TEXT; border = LINE; }
        }
        if (!enabled) { bg = 0x0CFFFFFF; fg = FAINT; }
        Ui.round(g, x, y, w, h, RADIUS_SM, bg);
        if (border != 0) Ui.outline(g, x, y, w, h, RADIUS_SM, border);
        int tw = g.textWidth(label) + (icon != null ? 14 : 0);
        int tx = x + (w - tw) / 2;
        if (icon != null) {
            Icons.draw(g, icon, tx, y + (h - 9) / 2, 9, fg);
            tx += 14;
        }
        g.text(label, tx, y + (h - 8) / 2, fg, false);
        return enabled && ui.clicked(x, y, w, h);
    }

    /** Düğmenin doğal genişliği */
    public static int buttonWidth(Gfx g, String label, Icon icon) {
        return g.textWidth(label) + (icon != null ? 14 : 0) + 20;
    }

    /** Kare simge düğmesi; hover rengi verilirse (ör. kapat için kırmızı) üzerine gelince o renkle dolar */
    public static boolean iconButton(Ui ui, Anim a, String key, Icon icon, int x, int y, int s, int hoverColor) {
        Gfx g = ui.g;
        boolean hv = ui.hover(x, y, s, s);
        float k = a.get(key, hv);
        if (k > 0.01f) Ui.round(g, x, y, s, s, RADIUS_SM, hoverColor != 0 ? Theme.alpha(hoverColor, (int) (0xD0 * k)) : Theme.alpha(0xFFFFFFFF, (int) (0x18 * k)));
        int is = Math.max(8, s - 8);
        Icons.draw(g, icon, x + (s - is) / 2, y + (s - is) / 2, is, Theme.mix(MUTED, TEXT, k));
        return ui.clicked(x, y, s, s);
    }

    /**
     * Gezinme öğesi: seçiliyse hafif zemin + solda amber çizgi (launcher'daki gibi). badge: sağdaki sayı (0 ise
     * yok); warn: sayı amber (bekleyen iş). Tıklandıysa true.
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
        if (badge > 0) badgeCount(ui, n, x + w - 4 - bw, y + 3, bw, warn);
        return ui.clicked(x, y, w, h);
    }

    private static void badgeCount(Ui ui, String n, int x, int y, int w, boolean warn) {
        Gfx g = ui.g;
        Ui.round(g, x, y, w, 12, 6, warn ? (ui.t.accent | 0xFF000000) : 0x24FFFFFF);
        g.text(n, x + (w - g.textWidth(n)) / 2, y + 2, warn ? ui.t.onAccent : TEXT, false);
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

    /** Küçük çip (süzgeç): seçiliyse amber çerçeve ve yazı. Tıklandıysa true. */
    public static boolean chip(Ui ui, String label, int x, int y, boolean on) {
        Gfx g = ui.g;
        int w = g.textWidth(label) + 14;
        boolean hv = ui.hover(x, y, w, 14);
        int acc = ui.t.accent | 0xFF000000;
        Ui.round(g, x, y, w, 14, 7, on ? Theme.alpha(acc, 0x26) : hv ? 0x1CFFFFFF : 0x10FFFFFF);
        if (on) Ui.outline(g, x, y, w, 14, 7, Theme.alpha(acc, 0x90));
        g.text(label, x + 7, y + 3, on ? Theme.mix(acc, 0xFFFFFFFF, 0.35f) : 0xFFC8CBD3, false);
        return ui.clicked(x, y, w, 14);
    }

    public static int chipWidth(Gfx g, String label) {
        return g.textWidth(label) + 14;
    }

    /** Durum rozeti (0.8x yazı); sağ kenarını döner */
    public static int badge(Gfx g, String s, int x, int y, int bg, int fg) {
        int w = smallWidth(g, s) + 8;
        Ui.round(g, x, y, w, 11, 5, bg);
        small(g, s, x + 4, y + 2, fg);
        return x + w;
    }

    /** Anahtar (aç/kapa); yeni değeri döner */
    public static boolean toggle(Ui ui, boolean on, int x, int y) {
        Gfx g = ui.g;
        int w = 22, h = 12;
        boolean hv = ui.hover(x - 2, y - 2, w + 4, h + 4);
        Ui.round(g, x, y, w, h, 6, on ? (ui.t.accent | 0xFF000000) : hv ? 0x40FFFFFF : 0x2CFFFFFF);
        int k = h - 4;
        Ui.round(g, on ? x + w - k - 2 : x + 2, y + 2, k, k, 4, on ? ui.t.onAccent : 0xFFE6E7EA);
        return ui.clicked(x - 2, y - 2, w + 4, h + 4) ? !on : on;
    }

    /** Tek satırlık metin alanı; odaktaysa amber çerçeve ve imleç. Tıklanınca odak alır (true döner). */
    public static boolean field(Ui ui, String value, String placeholder, Icon icon, boolean focused, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean hv = ui.hover(x, y, w, h);
        Ui.round(g, x, y, w, h, RADIUS_SM, focused ? 0xA0000000 : hv ? 0x80000000 : 0x60000000);
        Ui.outline(g, x, y, w, h, RADIUS_SM, focused ? Theme.alpha(ui.t.accent, 0xC0) : LINE_STRONG);
        int tx = x + 6;
        if (icon != null) {
            Icons.draw(g, icon, x + 6, y + (h - 9) / 2, 9, FAINT);
            tx = x + 19;
        }
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        boolean empty = value.isEmpty() && !focused;
        String shown = empty ? placeholder : value + (focused && blink ? "|" : "");
        g.text(ui.fit(shown, x + w - tx - 6), tx, y + (h - 8) / 2, empty ? FAINT : TEXT, false);
        return ui.clicked(x, y, w, h);
    }

    /** Uyarı/bilgi notu: simge + sarılmış yazı; yüksekliği döner */
    public static int note(Ui ui, Icon icon, String text, int x, int y, int w, int tone) {
        Gfx g = ui.g;
        java.util.List<String> lines = wrap(g, text, w - 30);
        int h = 10 + lines.size() * 11;
        Ui.round(g, x, y, w, h, RADIUS, Theme.alpha(tone, 0x18));
        Ui.outline(g, x, y, w, h, RADIUS, Theme.alpha(tone, 0x40));
        Icons.draw(g, icon, x + 8, y + 6, 10, tone | 0xFF000000);
        int ly = y + 6;
        for (String l : lines) {
            g.text(l, x + 24, ly, 0xFFD0D2D8, false);
            ly += 11;
        }
        return h;
    }

    /** Boş durum: ortada simge, başlık ve açıklama; yüksekliği döner */
    public static int empty(Ui ui, Icon icon, String title, String body, int x, int y, int w) {
        Gfx g = ui.g;
        Icons.draw(g, icon, x + w / 2 - 8, y + 8, 16, FAINT);
        g.textBold(title, x + (w - g.textBoldWidth(title)) / 2, y + 32, TEXT, false);
        int ly = y + 46;
        for (String l : wrap(g, body, Math.min(w, 300))) {
            g.text(l, x + (w - g.textWidth(l)) / 2, ly, MUTED, false);
            ly += 11;
        }
        return ly - y + 8;
    }

    /** Dönen nokta göstergesi */
    public static void spinner(Ui ui, int cx, int cy, int color) {
        float t = ui.time * 6;
        for (int i = 0; i < 6; i++) {
            double a = t + i * Math.PI / 3;
            int px = cx + (int) Math.round(Math.cos(a) * 4), py = cy + (int) Math.round(Math.sin(a) * 4);
            Ui.round(ui.g, px - 1, py - 1, 2, 2, 1, Theme.alpha(color, 40 + i * 35));
        }
    }

    /** Kaydırma çubuğu (içerik görünürden büyükse) */
    public static void scrollbar(Gfx g, int x, int top, int viewH, int contentH, float scroll) {
        float max = Math.max(0, contentH - viewH);
        if (max <= 0) return;
        int barH = Math.max(16, (int) (viewH * viewH / (float) contentH));
        int barY = top + (int) ((viewH - barH) * (scroll / max));
        Ui.round(g, x, barY, 3, barH, 1, 0x40FFFFFF);
    }

    /** Ekranın alt ortasında bildirim; yaş (ms) ile soluklaşır. bottom: alt kenar */
    public static void toast(Gfx g, String msg, long ageMs, int sw, int bottom, int accent) {
        if (msg == null || ageMs > 3500) return;
        float a = ageMs < 150 ? ageMs / 150f : ageMs > 3000 ? 1 - (ageMs - 3000) / 500f : 1;
        g.nextLayer();
        int w = Math.min(g.textWidth(msg) + 28, sw - 40);
        int x = (sw - w) / 2, y = bottom - 30 + Math.round((1 - a) * 6);
        Ui.round(g, x, y, w, 20, RADIUS, Theme.alpha(0xFF15161B, (int) (0xF5 * a)));
        Ui.outline(g, x, y, w, 20, RADIUS, Theme.alpha(accent, (int) (0x90 * a)));
        g.text(fit(g, msg, w - 24), x + 14, y + 6, Theme.alpha(0xFFFFFFFF, Math.max(8, (int) (255 * a))), false);
    }

    // ───── yardımcılar ─────

    public static String fit(Gfx g, String s, int max) {
        if (g.textWidth(s) <= max) return s;
        while (s.length() > 1 && g.textWidth(s + "…") > max) s = s.substring(0, s.length() - 1);
        return s + "…";
    }

    /** Sözcük sınırından satırlara böl */
    public static java.util.List<String> wrap(Gfx g, String text, int max) {
        java.util.List<String> out = new java.util.ArrayList<>();
        for (String para : text.split("\n")) {
            StringBuilder line = new StringBuilder();
            for (String word : para.split(" ")) {
                String tryLine = line.isEmpty() ? word : line + " " + word;
                if (g.textWidth(tryLine) > max && !line.isEmpty()) {
                    out.add(line.toString());
                    line = new StringBuilder(word);
                } else line = new StringBuilder(tryLine);
            }
            out.add(line.toString());
        }
        return out;
    }

    public static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }
}
