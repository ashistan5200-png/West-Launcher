package dev.west.companion.v121;

import dev.west.hud.api.Gfx;
import net.minecraft.client.Minecraft;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.Font;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.FontDescription;
import net.minecraft.network.chat.Style;
import net.minecraft.resources.Identifier;
import java.util.function.Consumer;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;

/** 1.21.11 çizim köprüsü (GuiGraphics). */
public final class Gfx121 implements Gfx {
    private final GuiGraphics g;
    private final Font font;
    private int scissorDepth;
    private boolean smooth;
    private final Consumer<Float> panorama;
    /** Pürüzsüz (TrueType) West yazı tipi: assets/west_companion/font/smooth.json */
    private static final Style SMOOTH = Style.EMPTY.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("west_companion", "smooth")));

    public Gfx121(GuiGraphics g) {
        this(g, null);
    }

    Gfx121(GuiGraphics g, Consumer<Float> panorama) {
        this.g = g;
        this.font = Minecraft.getInstance().font;
        this.panorama = panorama;
        this.smooth = WestHud.config == null || WestHud.config.data.smoothFont;
    }

    private Component smooth(String s) {
        return Component.literal(s).setStyle(SMOOTH);
    }

    private static final Style BOLD = Style.EMPTY.withFont(new FontDescription.Resource(Identifier.fromNamespaceAndPath("west_companion", "smooth_bold")));

    @Override
    public void textBold(String s, int x, int y, int argb, boolean shadow) {
        if (s == null || s.isEmpty() || (argb >>> 24) == 0) return;
        if (smooth) g.drawString(font, Component.literal(s).setStyle(BOLD), x, y, argb, shadow);
        else g.drawString(font, Component.literal(s).withStyle(net.minecraft.ChatFormatting.BOLD), x, y, argb, shadow);
    }

    @Override
    public int textBoldWidth(String s) {
        return s == null ? 0 : smooth ? font.width(Component.literal(s).setStyle(BOLD)) : font.width(Component.literal(s).withStyle(net.minecraft.ChatFormatting.BOLD));
    }

    private static java.util.function.Supplier<net.minecraft.world.entity.player.PlayerSkin> skin;

    @Override
    public void playerFace(int x, int y, int size) {
        Minecraft mc = Minecraft.getInstance();
        if (skin == null) skin = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
        net.minecraft.client.gui.components.PlayerFaceRenderer.draw(g, skin.get(), x, y, size);
    }

    @Override public void smoothText(boolean on) { smooth = on; }
    @Override public int guiScale() { return Math.max(1, Minecraft.getInstance().getWindow().getGuiScale()); }
    @Override public void panorama(float delta) { if (panorama != null) panorama.accept(delta); }

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
        if (smooth) g.drawString(font, smooth(s), x, y, argb, shadow);
        else g.drawString(font, s, x, y, argb, shadow);
    }

    @Override public int textWidth(String s) { return s == null ? 0 : smooth ? font.width(smooth(s)) : font.width(s); }
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
        g.renderItem(s, x, y);
        g.renderItemDecorations(font, s, x, y);
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
