package dev.west.hud.hud;

import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

/** Zırh durumu: kask, göğüslük, pantolon, bot ve eldeki eşya; dayanıklılık yüzdesiyle. */
public final class Armor extends HudElement {
    private static final int ROW = 18;
    public boolean showHand = true;

    public Armor() {
        super("armor", "Zırh durumu", "Giydiğin zırh ve eldeki eşya, kalan dayanıklılıkla.", false);
    }

    private int rows() {
        return showHand ? 5 : 4;
    }

    @Override
    public int[] size(Gfx g, Game game) {
        return new int[] { 18 + 4 + g.textWidth("100%") + 6, rows() * ROW + 4 };
    }

    @Override
    public void draw(Gfx g, Game game, Theme t, int w, int h) {
        box(g, w, h);
        int[] order = showHand ? new int[] { 0, 1, 2, 3, 4 } : new int[] { 0, 1, 2, 3 };
        for (int i = 0; i < order.length; i++) {
            int slot = order[i];
            int y = 2 + i * ROW;
            boolean has = g.item(slot, 3, y + 1);
            if (!has) {
                g.fill(5, y + 8, 17, y + 9, Theme.alpha(textColor(), 60));
                continue;
            }
            float d = game.durability(slot);
            if (d >= 0) {
                int pct = Math.round(d * 100);
                int c = d > 0.5f ? Theme.mix(0xFFFFE066, 0xFF6EE7A0, (d - 0.5f) * 2) : Theme.mix(0xFFF05A5A, 0xFFFFE066, d * 2);
                g.text(pct + "%", 22, y + 5, c, shadow);
            }
        }
    }

    @Override
    public int[] defaultPos(int sw, int sh, int w, int h) {
        return new int[] { sw - w - 4, sh / 2 - h / 2 };
    }
}
