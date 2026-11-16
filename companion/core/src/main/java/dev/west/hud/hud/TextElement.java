package dev.west.hud.hud;

import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Theme;

import java.util.function.Function;

/**
 * Tek satırlık bilgi öğesi: renkli etiket + değer (ör. "144 FPS", "X 12 Y 64 Z -3").
 * Etiket vurgu renginde, değer seçilen yazı renginde çizilir.
 */
public class TextElement extends HudElement {
    public enum Corner { TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT }

    private static final int PAD_X = 5, PAD_Y = 4;
    private final Function<Game, String[]> parts;
    private final Corner corner;
    private final int order;

    /** @param parts {değer, etiket} (etiket boş olabilir) */
    public TextElement(String id, String name, String description, boolean on, Corner corner, int order, Function<Game, String[]> parts) {
        super(id, name, description, on);
        this.parts = parts;
        this.corner = corner;
        this.order = order;
    }

    private String[] safe(Game game) {
        try {
            String[] p = parts.apply(game);
            return p == null ? new String[] { "—", "" } : p;
        } catch (RuntimeException e) {
            return new String[] { "—", "" };
        }
    }

    @Override
    public int[] size(Gfx g, Game game) {
        String[] p = safe(game);
        int w = g.textWidth(p[0]) + (p[1].isEmpty() ? 0 : g.textWidth(p[1]) + 4);
        return new int[] { w + PAD_X * 2, g.lineHeight() - 1 + PAD_Y * 2 };
    }

    @Override
    public void draw(Gfx g, Game game, Theme t, int w, int h) {
        String[] p = safe(game);
        box(g, w, h);
        int x = PAD_X;
        g.text(p[0], x, PAD_Y, textColor(), shadow);
        if (!p[1].isEmpty()) g.text(p[1], x + g.textWidth(p[0]) + 4, PAD_Y, t.accent, shadow);
    }

    @Override
    public int[] defaultPos(int sw, int sh, int w, int h) {
        int gap = 3, step = 18;
        return switch (corner) {
            case TOP_LEFT -> new int[] { gap + 2, gap + 2 + order * step };
            case TOP_RIGHT -> new int[] { sw - w - gap - 2, gap + 2 + order * step };
            case BOTTOM_LEFT -> new int[] { gap + 2, sh - h - 44 - order * step };
            case BOTTOM_RIGHT -> new int[] { sw - w - gap - 2, sh - h - 4 - order * step };
        };
    }
}
