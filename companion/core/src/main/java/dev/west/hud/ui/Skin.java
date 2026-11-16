package dev.west.hud.ui;

import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;

/**
 * Minecraft'ın kendi ekranlarındaki (Dünyalar, Çok oyunculu, Ayarlar …) düğme ve
 * kutuların West görünümü. Sürüm adaptörlerindeki mixin'ler buraya çizdirir.
 */
public final class Skin {
    private Skin() {}

    /** West görünümü açık mı (ayarlardan kapatılırsa vanilla düğmeler geri gelir) */
    public static boolean on() {
        return WestHud.config != null && WestHud.config.data.customTitle;
    }

    public static void button(Gfx g, int x, int y, int w, int h, boolean hovered, boolean active) {
        Theme t = WestHud.theme();
        int r = Math.min(6, h / 2);
        if (!active) {
            Ui.round(g, x, y, w, h, r, 0x8C0C0C10);
            Ui.outline(g, x, y, w, h, r, 0x14FFFFFF);
            return;
        }
        Ui.round(g, x, y, w, h, r, hovered ? 0xE6262630 : 0xCC15151B);
        if (hovered) {
            g.fill(x + r, y + h - 1, x + w - r, y + h, Theme.alpha(t.accent, 0xCC));
            Ui.outline(g, x, y, w, h, r, Theme.alpha(t.accent, 0x99));
        } else {
            Ui.outline(g, x, y, w, h, r, 0x26FFFFFF);
        }
    }

    public static void field(Gfx g, int x, int y, int w, int h, boolean focused) {
        Theme t = WestHud.theme();
        int r = Math.min(5, h / 2);
        Ui.round(g, x, y, w, h, r, 0xD90A0A0E);
        Ui.outline(g, x, y, w, h, r, focused ? Theme.alpha(t.accent, 0xCC) : 0x30FFFFFF);
    }

    public static void sliderTrack(Gfx g, int x, int y, int w, int h, boolean hovered) {
        int r = Math.min(6, h / 2);
        Ui.round(g, x, y, w, h, r, hovered ? 0xD91C1C24 : 0xCC15151B);
        Ui.outline(g, x, y, w, h, r, 0x26FFFFFF);
    }

    public static void sliderHandle(Gfx g, int x, int y, int w, int h, boolean hovered) {
        Theme t = WestHud.theme();
        Ui.round(g, x + 1, y + 2, w - 2, h - 4, 3, hovered ? t.accent | 0xFF000000 : Theme.alpha(t.accent, 0xD0));
    }

    public static void tab(Gfx g, int x, int y, int w, int h, boolean selected, boolean hovered) {
        Theme t = WestHud.theme();
        int px = x + 3, py = y + 3, pw = w - 6, ph = h - 5;
        int r = Math.min(6, ph / 2);
        if (selected) {
            Ui.round(g, px, py, pw, ph, r, Theme.alpha(t.accent, 0x33));
            Ui.outline(g, px, py, pw, ph, r, Theme.alpha(t.accent, 0xAA));
        } else {
            Ui.round(g, px, py, pw, ph, r, hovered ? 0xCC22222A : 0x9914141A);
            Ui.outline(g, px, py, pw, ph, r, hovered ? 0x40FFFFFF : 0x1EFFFFFF);
        }
    }

    public static void tooltip(Gfx g, int x, int y, int w, int h) {
        Theme t = WestHud.theme();
        int X = x - 4, Y = y - 4, W = w + 8, H = h + 8;
        Ui.round(g, X, Y, W, H, 5, 0xF00C0C11);
        Ui.outline(g, X, Y, W, H, 5, Theme.alpha(t.accent, 0x66));
    }

    /** Dünya / sunucu listesindeki bir satırın kartı */
    public static void listRow(Gfx g, int x, int y, int w, int h, boolean hovered) {
        x -= 4; w += 8; y -= 1; h += 2;
        int r = Math.min(7, h / 3);
        Ui.round(g, x, y, w, h, r, hovered ? 0xB0202029 : 0x8013131A);
        Ui.outline(g, x, y, w, h, r, hovered ? 0x33FFFFFF : 0x18FFFFFF);
    }

    /** Seçili satır: turuncu tonlu kart ve çerçeve (vanilla beyaz kutunun yerine) */
    public static void listSelected(Gfx g, int x, int y, int w, int h, boolean focused) {
        x -= 4; w += 8; y -= 1; h += 2;
        Theme t = WestHud.theme();
        int r = Math.min(7, h / 3);
        Ui.round(g, x, y, w, h, r, Theme.alpha(t.accent, focused ? 0x30 : 0x20));
        Ui.outline(g, x, y, w, h, r, Theme.alpha(t.accent, focused ? 0xE0 : 0x80));
        g.fill(x + 1, y + r, x + 3, y + h - r, Theme.alpha(t.accent, 0xF0));
    }

    public static void scrollTrack(Gfx g, int x, int y, int w, int h) {
        int cx = x + w / 2 - 1;
        Ui.round(g, cx, y + 2, 3, h - 4, 1, 0x30FFFFFF);
    }

    public static void scrollHandle(Gfx g, int x, int y, int w, int h) {
        int cx = x + w / 2 - 2;
        Ui.round(g, cx, y + 1, 5, h - 2, 2, 0xC8FFFFFF);
    }

    /** Dünya ikonunun üstündeki "oyna" düğmesi: koyu katman ve pürüzsüz üçgen */
    public static void playIcon(Gfx g, int x, int y, int w, int h, boolean highlighted) {
        Theme t = WestHud.theme();
        g.fill(x, y, x + w, y + h, highlighted ? 0x80000000 : 0x60000000);
        int d = Math.min(w, h) - 10;
        int cx = x + w / 2, cy = y + h / 2;
        Ui.round(g, cx - d / 2, cy - d / 2, d, d, d / 2, highlighted ? t.accent | 0xFF000000 : 0xE6FFFFFF);
        int k = Math.max(1, g.guiScale());
        int tri = d * k * 2 / 5;
        int tx = cx * k - tri / 3, ty = cy * k - tri / 2;
        int col = highlighted ? t.onAccent : 0xFF16161C;
        g.push();
        g.scale(1f / k);
        for (int i = 0; i < tri; i++) {
            int len = (int) Math.round((tri / 2.0 - Math.abs(i + 0.5 - tri / 2.0)) * 1.7);
            if (len > 0) g.fill(tx, ty + i, tx + len, ty + i + 1, col);
        }
        g.pop();
    }
}
