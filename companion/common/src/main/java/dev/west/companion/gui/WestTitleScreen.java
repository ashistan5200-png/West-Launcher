package dev.west.companion.gui;

import dev.west.companion.SafeHook;
import dev.west.companion.West;
import net.minecraft.SharedConstants;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen;
import net.minecraft.client.gui.screens.multiplayer.SafetyScreen;
import net.minecraft.client.gui.screens.options.OptionsScreen;
import net.minecraft.client.gui.screens.worldselection.SelectWorldScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

/**
 * West ana menüsü: solda animasyonlu karakter, sağda sade düğmeler.
 * Her adım SafeHook ile korunur; bir hata olursa oturum boyunca vanilla
 * TitleScreen'e dönülür (oyun asla çökmez).
 */
public class WestTitleScreen extends Screen {
    private static final ResourceLocation COMPASS = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "textures/gui/compass.png");
    private final TitleScreen vanilla;
    private final long opened = System.currentTimeMillis();
    private PlayerPreview preview;
    private boolean dragging;

    public WestTitleScreen(TitleScreen vanilla) {
        super(Component.translatable("west_companion.title"));
        this.vanilla = vanilla;
    }

    private void fallback(Throwable t) {
        SafeHook.disable("menu", t);
        if (minecraft != null) minecraft.setScreen(vanilla);
    }

    @Override
    protected void init() {
        try {
            if (preview == null) preview = new PlayerPreview();
            int bw = Math.min(200, width / 3);
            int bh = height < 300 ? 18 : 22, gap = height < 300 ? 4 : 6;
            int x = width - bw - Math.max(24, width / 12);
            int y = buttonsTop(bh, gap);
            int d = 0;
            addRenderableWidget(new WestButton(x, y, bw, bh, Component.translatable("menu.singleplayer"),
                    b -> minecraft.setScreen(new SelectWorldScreen(this)), d += 60, true));
            addRenderableWidget(new WestButton(x, y += bh + gap, bw, bh, Component.translatable("menu.multiplayer"),
                    b -> minecraft.setScreen(minecraft.options.skipMultiplayerWarning ? new JoinMultiplayerScreen(this) : new SafetyScreen(this)), d += 60, false));
            addRenderableWidget(new WestButton(x, y += bh + gap, bw, bh, Component.translatable("west_companion.panel"),
                    b -> minecraft.setScreen(new WestPanelScreen(this)), d += 60, false));
            addRenderableWidget(new WestButton(x, y += bh + gap, bw, bh, Component.translatable("menu.options"),
                    b -> minecraft.setScreen(new OptionsScreen(this, minecraft.options)), d += 60, false));
            addRenderableWidget(new WestButton(x, y += bh + gap + 8, bw, bh, Component.translatable("menu.quit"),
                    b -> minecraft.stop(), d += 60, false));
            addRenderableWidget(new WestButton(x, y + bh + gap, bw, 16, Component.translatable("west_companion.vanilla_menu"),
                    b -> minecraft.setScreen(vanilla), d + 60, false));
        } catch (Throwable t) {
            fallback(t);
        }
    }

    /** Logo + 6 düğmelik bloğu dikeyde ortalar; küçük pencerelerde de taşmaz. */
    private int buttonsTop(int bh, int gap) {
        int block = 44 + 5 * (bh + gap) + 8 + 16;
        return Math.max(52, (height - block) / 2 + 44);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        try {
            super.render(g, mouseX, mouseY, partialTick); // panorama + bulanıklık + düğmeler
            float appear = WestButton.easeOut((System.currentTimeMillis() - opened) / 700f);

            // Sol taraf: yumuşak koyu geçiş + karakter
            int leftW = width / 2;
            g.fillGradient(0, 0, leftW, height, WestButton.argb(0.55f * appear, 0x101113), WestButton.argb(0.25f * appear, 0x101113));
            int modelH = (int) Math.min(height * 0.66f, 230);
            preview.render(g, width / 4 + 10, height / 2 + modelH / 2, modelH, appear);

            // Logo + başlık (düğmelerin üstünde)
            int bx = width - Math.min(200, width / 3) - Math.max(24, width / 12);
            int bh = height < 300 ? 18 : 22, gap = height < 300 ? 4 : 6;
            int ly = buttonsTop(bh, gap) - 42;
            g.setColor(1f, 1f, 1f, appear);
            g.blit(COMPASS, bx, ly, 0, 0, 30, 30, 30, 30);
            g.setColor(1f, 1f, 1f, 1f);
            g.drawString(font, "West Launcher", bx + 38, ly + 6, WestButton.argb(appear, 0xE2E4E7), false);
            g.drawString(font, Component.translatable("west_companion.subtitle"), bx + 38, ly + 18, WestButton.argb(appear * 0.7f, 0x8B9098), false);

            String ver = "Minecraft " + SharedConstants.getCurrentVersion().getName() + " · " + West.platform.loaderName();
            g.drawString(font, ver, 8, height - 14, WestButton.argb(0.6f, 0xC9CED6), false);
            if (dragging) g.drawString(font, Component.translatable("west_companion.drag_hint"), 8, height - 26, WestButton.argb(0.5f, 0xC9CED6), false);
        } catch (Throwable t) {
            fallback(t);
        }
    }

    @Override
    public boolean mouseDragged(double mx, double my, int button, double dx, double dy) {
        if (preview != null && mx < width / 2.0) {
            dragging = true;
            preview.yaw += (float) dx * 1.6f;
            return true;
        }
        return super.mouseDragged(mx, my, button, dx, dy);
    }

    @Override
    public boolean mouseReleased(double mx, double my, int button) {
        dragging = false;
        return super.mouseReleased(mx, my, button);
    }

    @Override
    public boolean shouldCloseOnEsc() {
        return false;
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
