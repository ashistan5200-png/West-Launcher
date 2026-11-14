package dev.west.companion.gui;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

/**
 * Sade, mat West düğmesi. Açılışta sağdan kayarak belirir (gecikmeli, ease-out),
 * üzerine gelindiğinde vurgu çizgisi ve zemin yumuşakça geçiş yapar.
 */
public class WestButton extends Button {
    public static final int ACCENT = 0x7FA7C9;
    private final long born = System.currentTimeMillis();
    private final int delayMs;
    private final boolean primary;
    private float hover;
    public boolean selected;

    public WestButton(int x, int y, int w, int h, Component msg, OnPress onPress, int delayMs, boolean primary) {
        super(x, y, w, h, msg, onPress, DEFAULT_NARRATION);
        this.delayMs = delayMs;
        this.primary = primary;
    }

    static float easeOut(float t) {
        t = Mth.clamp(t, 0f, 1f);
        float u = 1f - t;
        return 1f - u * u * u;
    }

    static int argb(float a, int rgb) {
        return (Mth.clamp((int) (a * 255), 8, 255) << 24) | (rgb & 0xFFFFFF);
    }

    @Override
    protected void renderWidget(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        float appear = easeOut((System.currentTimeMillis() - born - delayMs) / 420f);
        // Kare hızından bağımsız yumuşak geçiş
        float target = (isHoveredOrFocused() || selected) && active ? 1f : 0f;
        hover += (target - hover) * Mth.clamp(Minecraft.getInstance().getTimer().getRealtimeDeltaTicks() * 0.45f, 0f, 1f);

        int dx = (int) ((1f - appear) * 26);
        int x = getX() + dx, y = getY(), w = getWidth(), h = getHeight();
        float a = appear * (active ? 1f : 0.5f);

        int bgBase = primary ? 0x2A3440 : 0x1C1D20;
        int bgHover = primary ? 0x34414F : 0x2A2C31;
        int bg = lerpColor(bgBase, bgHover, hover);
        g.fill(x, y, x + w, y + h, argb(a * 0.86f, bg));
        g.fill(x, y + h - 1, x + w, y + h, argb(a * 0.35f, 0x000000)); // hafif alt gölge
        int bar = 2 + Math.round(hover * 2);
        g.fill(x, y, x + bar, y + h, argb(a * (0.35f + hover * 0.65f), ACCENT));

        int textColor = lerpColor(0xC9CED6, 0xFFFFFF, hover);
        g.drawString(Minecraft.getInstance().font, getMessage(), x + 12 + Math.round(hover * 2), y + (h - 8) / 2, argb(a, textColor), false);
    }

    static int lerpColor(int a, int b, float t) {
        int r = (int) Mth.lerp(t, (a >> 16) & 255, (b >> 16) & 255);
        int gg = (int) Mth.lerp(t, (a >> 8) & 255, (b >> 8) & 255);
        int bb = (int) Mth.lerp(t, a & 255, b & 255);
        return (r << 16) | (gg << 8) | bb;
    }
}
