package dev.west.hud.hud;

import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

/**
 * Ekranda bir HUD öğesi. Konum ekranın oranı olarak saklanır (0–1), böylece pencere
 * boyutu ya da GUI ölçeği değişince öğe yerinde kalır.
 */
public abstract class HudElement {
    public final String id;
    public final String name;
    public final String description;

    public boolean enabled;
    /** Sol üst köşenin ekrana oranı; -1 = varsayılan konum */
    public float x = -1, y = -1;
    public float scale = 1f;
    public boolean background = true;
    public boolean shadow = true;
    public int color = 0xFFFFFF;

    protected HudElement(String id, String name, String description, boolean enabledByDefault) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.enabled = enabledByDefault;
    }

    /** Ölçeksiz boyut {genişlik, yükseklik} */
    public abstract int[] size(Gfx g, Game game);

    /** (0,0)'dan başlayarak ölçeksiz çiz; çağıran konum ve ölçeği uygular. */
    public abstract void draw(Gfx g, Game game, Theme t, int w, int h);

    /** Varsayılan konum (ölçekli boyuta göre, piksel) */
    public abstract int[] defaultPos(int sw, int sh, int w, int h);

    /** Ekrandaki gerçek piksel konumu, ekran içinde kalacak şekilde */
    public int[] pixelPos(int sw, int sh, int w, int h) {
        int px, py;
        if (x < 0 || y < 0) {
            int[] d = defaultPos(sw, sh, w, h);
            px = d[0];
            py = d[1];
        } else {
            px = Math.round(x * sw);
            py = Math.round(y * sh);
        }
        px = Math.max(0, Math.min(sw - w, px));
        py = Math.max(0, Math.min(sh - h, py));
        return new int[] { px, py };
    }

    public void setPixelPos(int px, int py, int sw, int sh) {
        x = sw > 0 ? px / (float) sw : 0;
        y = sh > 0 ? py / (float) sh : 0;
    }

    public void resetLayout() {
        x = y = -1;
        scale = 1f;
    }

    public int textColor() {
        return 0xFF000000 | color;
    }

    /** Ortak kutu arka planı */
    protected void box(Gfx g, int w, int h) {
        if (!background) return;
        g.fill(1, 0, w - 1, h, 0x8C0B0B10);
        g.fill(0, 1, 1, h - 1, 0x8C0B0B10);
        g.fill(w - 1, 1, w, h - 1, 0x8C0B0B10);
    }
}
