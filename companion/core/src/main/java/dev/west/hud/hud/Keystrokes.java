package dev.west.hud.hud;

import dev.west.hud.Tr;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

/**
 * Tuş göstergesi: W A S D, sol/sağ tık (CPS ile) ve boşluk. Basılan tuş vurgu rengiyle
 * yumuşakça yanar.
 */
public final class Keystrokes extends HudElement {
    private static final int K = 22, G = 2;
    private final float[] glow = new float[8];
    private long last = System.nanoTime();
    private final Cps cps;
    public boolean showMouse = true, showSpace = true;

    public Keystrokes(Cps cps) {
        super("keystrokes", Tr.t("Tuş göstergesi"), Tr.t("W A S D, fare tuşları (CPS ile) ve boşluk."), true);
        this.cps = cps;
    }

    @Override
    public int[] size(Gfx g, Game game) {
        int h = K * 2 + G;
        if (showMouse) h += G + K;
        if (showSpace) h += G + 11;
        return new int[] { K * 3 + G * 2, h };
    }

    @Override
    public void draw(Gfx g, Game game, Theme t, int w, int h) {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        Game.Key[] keys = Game.Key.values();
        for (int i = 0; i < keys.length; i++) {
            float target = game.keyDown(keys[i]) ? 1f : 0f;
            // Basınca anında, bırakınca yumuşak sönsün
            glow[i] = target > glow[i] ? target : Math.max(0, glow[i] - dt * 6f);
        }
        key(g, t, K + G, 0, K, K, "W", Game.Key.FORWARD);
        key(g, t, 0, K + G, K, K, "A", Game.Key.LEFT);
        key(g, t, K + G, K + G, K, K, "S", Game.Key.BACK);
        key(g, t, (K + G) * 2, K + G, K, K, "D", Game.Key.RIGHT);
        int y = (K + G) * 2;
        if (showMouse) {
            int half = (w - G) / 2;
            key(g, t, 0, y, half, K, "LMB", Game.Key.ATTACK);
            key(g, t, half + G, y, w - half - G, K, "RMB", Game.Key.USE);
            String l = cps.left() + " CPS", r = cps.right() + " CPS";
            small(g, t, 0, y, half, l, Game.Key.ATTACK);
            small(g, t, half + G, y, w - half - G, r, Game.Key.USE);
            y += K + G;
        }
        if (showSpace) {
            float a = glow[Game.Key.JUMP.ordinal()];
            fillKey(g, t, 0, y, w, 11, a);
            int bar = Math.max(6, w / 3);
            g.fill((w - bar) / 2, y + 5, (w + bar) / 2, y + 6, Theme.mix(textColor(), t.onAccent, a));
        }
    }

    private void fillKey(Gfx g, Theme t, int x, int y, int w, int h, float a) {
        int bg = background ? Theme.mix(0x8C0B0B10, Theme.alpha(t.accent, 230), a) : Theme.alpha(t.accent, (int) (a * 230));
        if ((bg >>> 24) > 0) dev.west.hud.ui.Ui.round(g, x, y, w, h, 4, bg);
    }

    private void key(Gfx g, Theme t, int x, int y, int w, int h, String label, Game.Key k) {
        float a = glow[k.ordinal()];
        fillKey(g, t, x, y, w, h, a);
        int c = Theme.mix(textColor(), t.onAccent, a);
        boolean mouse = k == Game.Key.ATTACK || k == Game.Key.USE;
        int ty = mouse && showMouse ? y + 3 : y + (h - 8) / 2;
        g.text(label, x + (w - g.textWidth(label)) / 2, ty, c, shadow && a < 0.5f);
    }

    private void small(Gfx g, Theme t, int x, int y, int w, String s, Game.Key k) {
        float a = glow[k.ordinal()];
        g.push();
        g.translate(x + w / 2f, y + 14);
        g.scale(0.6f);
        int c = Theme.mix(Theme.alpha(textColor(), 200), t.onAccent, a);
        g.text(s, -g.textWidth(s) / 2, 0, c, false);
        g.pop();
    }

    @Override
    public int[] defaultPos(int sw, int sh, int w, int h) {
        return new int[] { 6, sh / 2 - h / 2 };
    }
}
