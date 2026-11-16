package dev.west.companion.v26;

import dev.west.hud.api.Gfx;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/** 26.x çizim köprüsü (GuiGraphicsExtractor). */
final class Gfx26 implements Gfx {
    private final GuiGraphicsExtractor g;
    private final Font font;
    private int scissorDepth;

    Gfx26(GuiGraphicsExtractor g) {
        this.g = g;
        this.font = Minecraft.getInstance().font;
    }

    @Override public int width() { return g.guiWidth(); }
    @Override public int height() { return g.guiHeight(); }

    @Override
    public void fill(int x1, int y1, int x2, int y2, int argb) {
        if (x2 > x1 && y2 > y1 && (argb >>> 24) != 0) g.fill(x1, y1, x2, y2, argb);
    }

    @Override
    public void gradient(int x1, int y1, int x2, int y2, int top, int bottom) {
        if (x2 > x1 && y2 > y1) g.fillGradient(x1, y1, x2, y2, top, bottom);
    }

    @Override
    public void text(String s, int x, int y, int argb, boolean shadow) {
        if (s == null || s.isEmpty() || (argb >>> 24) == 0) return;
        g.text(font, s, x, y, argb, shadow);
    }

    @Override public int textWidth(String s) { return s == null ? 0 : font.width(s); }
    @Override public int lineHeight() { return font.lineHeight; }

    @Override public void push() { g.pose().pushMatrix(); }
    @Override public void pop() { g.pose().popMatrix(); }
    @Override public void translate(float x, float y) { g.pose().translate(x, y); }
    @Override public void scale(float s) { g.pose().scale(s, s); }

    @Override
    public void scissor(int x1, int y1, int x2, int y2) {
        g.enableScissor(x1, y1, Math.max(x1, x2), Math.max(y1, y2));
        scissorDepth++;
    }

    @Override
    public void noScissor() {
        if (scissorDepth > 0) {
            g.disableScissor();
            scissorDepth--;
        }
    }

    @Override
    public boolean item(int slot, int x, int y) {
        ItemStack s = stack(slot);
        if (s == null || s.isEmpty()) return false;
        g.item(s, x, y);
        g.itemDecorations(font, s, x, y);
        return true;
    }

    static ItemStack stack(int slot) {
        Player p = Minecraft.getInstance().player;
        if (p == null) return null;
        return switch (slot) {
            case 0 -> p.getItemBySlot(EquipmentSlot.HEAD);
            case 1 -> p.getItemBySlot(EquipmentSlot.CHEST);
            case 2 -> p.getItemBySlot(EquipmentSlot.LEGS);
            case 3 -> p.getItemBySlot(EquipmentSlot.FEET);
            case 4 -> p.getMainHandItem();
            case 5 -> p.getOffhandItem();
            default -> null;
        };
    }
}
