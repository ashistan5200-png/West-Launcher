package dev.west.hud.hud;

import dev.west.hud.Tr;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

/** Ekranın üstünde yatay pusula şeridi: K, D, G, B ve ara yönler bakışla kayar. */
public final class Compass extends HudElement {
    private static final int W = 150, H = 18;
    private static final String[] NAMES = { "G", "GB", "B", "KB", "K", "KD", "D", "GD" };

    public Compass() {
        super("compass", Tr.t("Pusula"), Tr.t("Bakış yönünü gösteren kayan pusula şeridi."), false);
    }

    @Override
    public int[] size(Gfx g, Game game) {
        return new int[] { W, H };
    }

    @Override
    public void draw(Gfx g, Game game, Theme t, int w, int h) {
        box(g, w, h);
        // Minecraft'ta 0° güney; şeridin ortası bakılan yön
        float yaw = ((game.yaw() % 360) + 360) % 360;
        float pxPerDeg = 1.4f;
        g.scissor(2, 0, w - 2, h);
        for (int d = -180; d <= 540; d += 15) {
            float off = (d - yaw) * pxPerDeg;
            int x = Math.round(w / 2f + off);
            if (x < -10 || x > w + 10) continue;
            int deg = ((d % 360) + 360) % 360;
            if (deg % 45 == 0) {
                String n = NAMES[deg / 45];
                boolean main = n.length() == 1;
                int c = main ? (n.equals("K") ? t.danger : textColor()) : Theme.alpha(textColor(), 170);
                g.text(n, x - g.textWidth(n) / 2, 5, c, shadow);
            } else {
                g.fill(x, 7, x + 1, 11, Theme.alpha(textColor(), 110));
            }
        }
        g.noScissor();
        g.fill(w / 2, h - 3, w / 2 + 1, h, t.accent);
        g.fill(w / 2 - 1, h - 2, w / 2 + 2, h - 1, t.accent);
    }

    @Override
    public int[] defaultPos(int sw, int sh, int w, int h) {
        return new int[] { (sw - w) / 2, 4 };
    }
}
