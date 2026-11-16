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
}
