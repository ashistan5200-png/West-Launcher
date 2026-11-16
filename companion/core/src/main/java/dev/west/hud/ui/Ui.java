package dev.west.hud.ui;

import dev.west.hud.api.Gfx;

/**
 * Anlık (immediate-mode) arayüz yapı taşları. Her kare yeniden çizilir; tıklamalar
 * çizim sırasında kaydedilen alanlara göre işlenir. Böylece sürüm adaptörleri yalnızca
 * fare/klavye olaylarını iletir, düğme sınıfları her sürümde yeniden yazılmaz.
 */
public final class Ui {
    public Gfx g;
    public Theme t;
    public int mx, my;
    /** Bu karede tıklanan nokta (yoksa -1) — çizim sırasında tüketilir */
    private int clickX = -1, clickY = -1, clickButton;
    private boolean consumed;
    /** Animasyonlar için zaman (sn) */
    public float time;
    public boolean animate = true;
    /** Basılı tutulan kaydırıcı */
    public Object dragging;

    public void begin(Gfx g, Theme t, int mx, int my, float time) {
        this.g = g;
        this.t = t;
        this.mx = mx;
        this.my = my;
        this.time = time;
    }

    public void click(int x, int y, int button) {
        clickX = x;
        clickY = y;
        clickButton = button;
        consumed = false;
    }

    /** Kare sonunda tüketilmemiş tıklamayı bırak. */
    public void end() {
        clickX = clickY = -1;
    }

    public boolean hover(int x, int y, int w, int h) {
        return mx >= x && my >= y && mx < x + w && my < y + h;
    }

    /** Bu alana sol tıklandı mı (bir tıklama yalnızca bir kez sayılır). */
    public boolean clicked(int x, int y, int w, int h) {
        if (consumed || clickX < 0 || clickButton != 0) return false;
        if (clickX >= x && clickY >= y && clickX < x + w && clickY < y + h) {
            consumed = true;
            return true;
        }
        return false;
    }

    public boolean pressedAt(int x, int y, int w, int h) {
        return clickX >= x && clickY >= y && clickX < x + w && clickY < y + h;
    }

    // ───────── Çizim ─────────

    /** Köşeleri yuvarlatılmış dikdörtgen (piksel kademeleriyle; piksel temada keskin). */
    public void rect(int x, int y, int w, int h, int color) {
        rect(x, y, w, h, color, t.radius);
    }

    public void rect(int x, int y, int w, int h, int color, int r) {
        if (w <= 0 || h <= 0) return;
        r = Math.min(r, Math.min(w, h) / 2);
        if (r <= 0 || t.pixel) {
            g.fill(x, y, x + w, y + h, color);
            return;
        }
        round(g, x, y, w, h, r, color);
    }

    /**
     * GUI koordinatlarında pürüzsüz yuvarlak dikdörtgen. Ekranın gerçek pikselleriyle çizilir:
     * GUI ölçeği 3 ise köşe 3 kat daha ince adımlı ve kenarları yumuşatılmış olur.
     */
    public static void round(Gfx g, int x, int y, int w, int h, int r, int color) {
        r = Math.min(r, Math.min(w, h) / 2);
        if (w <= 0 || h <= 0) return;
        int k = Math.max(1, g.guiScale());
        g.push();
        g.scale(1f / k);
        smoothRect(g, x * k, y * k, w * k, h * k, r * k, color);
        g.pop();
    }

    /** Fiziksel piksellerde, köşeleri kenar yumuşatmalı (anti-aliased) yuvarlak dikdörtgen. */
    private static void smoothRect(Gfx g, int x, int y, int w, int h, int r, int color) {
        g.fill(x, y + r, x + w, y + h - r, color);
        int a = color >>> 24;
        for (int i = 0; i < r; i++) {
            // Bu satırın merkezinde dairenin kenarı nerede (köşe içinden ölçülerek)
            double dy = r - i - 0.5;
            double edge = r - Math.sqrt(Math.max(0, (double) r * r - dy * dy));
            int full = (int) Math.ceil(edge);
            float cover = (float) (full - edge);
            int top = y + i, bot = y + h - i - 1;
            g.fill(x + full, top, x + w - full, top + 1, color);
            g.fill(x + full, bot, x + w - full, bot + 1, color);
            // Kenardaki yarım piksel: kapladığı kadar saydam
            if (full > 0 && cover > 0.02f) {
                int c = Theme.alpha(color, Math.round(a * cover));
                g.fill(x + full - 1, top, x + full, top + 1, c);
                g.fill(x + w - full, top, x + w - full + 1, top + 1, c);
                g.fill(x + full - 1, bot, x + full, bot + 1, c);
                g.fill(x + w - full, bot, x + w - full + 1, bot + 1, c);
            }
        }
    }

    /** İnce kenarlık: pürüzsüz temada 1 ekran pikseli, piksel temada kalın ve keskin. */
    public void border(int x, int y, int w, int h, int color) {
        if (t.pixel) {
            g.fill(x, y, x + w, y + 2, color);
            g.fill(x, y + h - 2, x + w, y + h, color);
            g.fill(x, y + 2, x + 2, y + h - 2, color);
            g.fill(x + w - 2, y + 2, x + w, y + h - 2, color);
            return;
        }
        outline(g, x, y, w, h, Math.min(t.radius, Math.min(w, h) / 2), color);
    }

    /** Yuvarlak köşeli 1 ekran pikseli kalınlığında çerçeve (r GUI pikseli). */
    public static void outline(Gfx g, int x, int y, int w, int h, int rr, int color) {
        int k = Math.max(1, g.guiScale());
        int r = rr * k;
        int X = x * k, Y = y * k, W = w * k, H = h * k;
        g.push();
        g.scale(1f / k);
        g.fill(X + r, Y, X + W - r, Y + 1, color);
        g.fill(X + r, Y + H - 1, X + W - r, Y + H, color);
        g.fill(X, Y + r, X + 1, Y + H - r, color);
        g.fill(X + W - 1, Y + r, X + W, Y + H - r, color);
        // Köşe yayları: dış daire (r) ile 1 piksel içerideki daire (r-1) arasındaki halka
        for (int i = 0; i < r; i++) {
            double dy = r - i - 0.5;
            int eo = (int) Math.round(r - Math.sqrt(Math.max(0, (double) r * r - dy * dy)));
            double ri = r - 1;
            int ei = ri * ri > dy * dy ? (int) Math.round(r - Math.sqrt(ri * ri - dy * dy)) : r;
            int len = Math.max(1, ei - eo);
            g.fill(X + eo, Y + i, X + eo + len, Y + i + 1, color);
            g.fill(X + W - eo - len, Y + i, X + W - eo, Y + i + 1, color);
            g.fill(X + eo, Y + H - i - 1, X + eo + len, Y + H - i, color);
            g.fill(X + W - eo - len, Y + H - i - 1, X + W - eo, Y + H - i, color);
        }
        g.pop();
    }

    public void text(String s, int x, int y, int color) {
        g.text(s, x, y, color, false);
    }

    public void textCentered(String s, int cx, int y, int color) {
        g.text(s, cx - g.textWidth(s) / 2, y, color, false);
    }

    /** Sığmazsa "…" ile kısaltılmış metin */
    public String fit(String s, int maxW) {
        if (g.textWidth(s) <= maxW) return s;
        String dots = "…";
        int end = s.length();
        while (end > 0 && g.textWidth(s.substring(0, end) + dots) > maxW) end--;
        return s.substring(0, end) + dots;
    }

    // ───────── Bileşenler ─────────

    public boolean button(String label, int x, int y, int w, int h, boolean primary) {
        boolean hov = hover(x, y, w, h);
        int bg = primary ? (hov ? Theme.mix(t.accent, 0xFFFFFFFF, 0.12f) : t.accent) : (hov ? t.cardHover : t.card);
        rect(x, y, w, h, bg);
        if (!primary) border(x, y, w, h, hov ? Theme.alpha(t.accent, 140) : t.line);
        textCentered(label, x + w / 2, y + (h - 8) / 2, primary ? t.onAccent : t.text);
        return clicked(x, y, w, h);
    }

    /** Açma/kapama anahtarı; yeni değeri döner. */
    public boolean toggle(boolean on, int x, int y) {
        int w = 22, h = 12;
        boolean hov = hover(x - 2, y - 2, w + 4, h + 4);
        rect(x, y, w, h, on ? t.accent : Theme.alpha(t.text, hov ? 70 : 50), t.pixel ? 0 : 6);
        int k = h - 4;
        int kx = on ? x + w - k - 2 : x + 2;
        rect(kx, y + 2, k, k, on ? t.onAccent : 0xFFFFFFFF, t.pixel ? 0 : 4);
        return clicked(x - 2, y - 2, w + 4, h + 4) ? !on : on;
    }

    /** Yatay kaydırıcı; [min, max] aralığında yeni değeri döner. */
    public float slider(Object key, float value, float min, float max, int x, int y, int w) {
        int h = 4;
        boolean hov = hover(x - 2, y - 5, w + 4, h + 10);
        if (pressedAt(x - 2, y - 5, w + 4, h + 10) && clickButton == 0) {
            consumed = true;
            dragging = key;
        }
        if (dragging == key) value = min + (max - min) * Math.max(0, Math.min(1, (mx - x) / (float) w));
        float f = (value - min) / (max - min);
        rect(x, y, w, h, Theme.alpha(t.text, 40), t.pixel ? 0 : 2);
        rect(x, y, Math.max(h, (int) (w * f)), h, t.accent, t.pixel ? 0 : 2);
        int kx = x + (int) (w * f) - 4;
        rect(kx, y - 3, 8, 10, hov || dragging == key ? 0xFFFFFFFF : 0xFFE8E8EE, t.pixel ? 0 : 4);
        return value;
    }

    /** Seçeneklerden biri; seçileni döner. */
    public int segmented(String[] labels, int selected, int x, int y, int w, int h) {
        rect(x, y, w, h, t.card);
        int each = w / labels.length;
        for (int i = 0; i < labels.length; i++) {
            int bx = x + i * each;
            boolean on = i == selected;
            if (on) rect(bx + 2, y + 2, each - 4, h - 4, t.accent);
            else if (hover(bx, y, each, h)) rect(bx + 2, y + 2, each - 4, h - 4, t.cardHover);
            textCentered(labels[i], bx + each / 2, y + (h - 8) / 2, on ? t.onAccent : t.muted);
            if (clicked(bx, y, each, h)) selected = i;
        }
        return selected;
    }

    /** Renk kutucuğu; tıklanırsa true. */
    public boolean swatch(int rgb, boolean on, int x, int y, int size) {
        if (on) rect(x - 2, y - 2, size + 4, size + 4, t.text, t.pixel ? 0 : size);
        rect(x, y, size, size, 0xFF000000 | rgb, t.pixel ? 0 : size / 2);
        return clicked(x, y, size, size);
    }
}
