package dev.west.companion.v26;

import com.mojang.blaze3d.platform.NativeImage;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Ui;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.client.renderer.texture.DynamicTexture;
import net.minecraft.resources.Identifier;

import java.io.InputStream;

/** Açılış / kaynak yükleme ekranı: koyu arka plan, West logosu ve ince ilerleme çubuğu. */
public final class Splash {
    private static final int[] SIZES = { 220, 320, 460, 640, 900 };
    private static Identifier[] ids;
    private static int[] widths, heights;
    private static boolean failed;

    private Splash() {}

    private static void load() {
        if (ids != null || failed) return;
        try {
            Identifier[] i = new Identifier[SIZES.length];
            int[] w = new int[SIZES.length], h = new int[SIZES.length];
            for (int n = 0; n < SIZES.length; n++) {
                try (InputStream in = Splash.class.getResourceAsStream("/assets/west_companion/splash/logo_" + SIZES[n] + ".png")) {
                    NativeImage img = NativeImage.read(in);
                    w[n] = img.getWidth();
                    h[n] = img.getHeight();
                    i[n] = Identifier.fromNamespaceAndPath("west_companion", "splash_logo_" + SIZES[n]);
                    Minecraft.getInstance().getTextureManager().register(i[n], new DynamicTexture(() -> "west splash", img));
                }
            }
            widths = w;
            heights = h;
            ids = i;
        } catch (Throwable e) {
            failed = true;
            WestHud.LOG.warn("West açılış logosu yüklenemedi: {}", e.toString());
        }
    }

    public static void draw(GuiGraphicsExtractor g, float alpha, float progress) {
        if (alpha <= 0.003f) return;
        int a = Math.round(Math.min(1, alpha) * 255);
        int sw = g.guiWidth(), sh = g.guiHeight();
        g.fill(0, 0, sw, sh, (a << 24) | 0x0E1016);
        // Hafif üst-alt ışık
        g.fillGradient(0, 0, sw, sh / 2, (Math.round(a * 0.5f) << 24) | 0x1A1E2C, 0x001A1E2C);
        load();
        int accent = WestHud.config != null ? WestHud.config.data.accent & 0xFFFFFF : 0xE8A25C;
        Gfx26 gfx = new Gfx26(g);
        int k = Math.max(1, gfx.guiScale());
        int physW = sw * k, physH = sh * k;
        int lw = 0, lh = 0, cyPhys = physH / 2;
        if (ids != null) {
            int target = Math.round(Math.min(physW * 0.42f, physH * 1.1f));
            int pick = 0;
            for (int n = 0; n < SIZES.length; n++) if (widths[n] <= target) pick = n;
            lw = widths[pick];
            lh = heights[pick];
            g.pose().pushMatrix();
            g.pose().scale(1f / k, 1f / k);
            int lx = (physW - lw) / 2, ly = cyPhys - lh / 2 - lh / 3;
            g.blit(RenderPipelines.GUI_TEXTURED, ids[pick], lx, ly, 0f, 0f, lw, lh, lw, lh, lw, lh, (a << 24) | 0xFFFFFF);
            g.pose().popMatrix();
        }
        // İlerleme çubuğu (GUI pikseli)
        int barW = Math.max(80, Math.round((lw > 0 ? lw * 0.92f : physW * 0.36f) / k));
        int bx = (sw - barW) / 2;
        int by = (cyPhys + (lh > 0 ? lh / 2 : 0)) / k + 10;
        Ui.round(gfx, bx, by, barW, 2, 1, (Math.round(a * 0.16f) << 24) | 0xFFFFFF);
        int fw = Math.round(barW * Math.max(0, Math.min(1, progress)));
        if (fw >= 2) Ui.round(gfx, bx, by, fw, 2, 1, (a << 24) | accent);
    }
}
