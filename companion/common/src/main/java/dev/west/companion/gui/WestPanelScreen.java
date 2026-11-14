package dev.west.companion.gui;

import dev.west.companion.Compat;
import dev.west.companion.West;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;

/**
 * Oyun içi West paneli (Sağ Shift veya menüdeki "West" düğmesi):
 * FullBright, FPS/MS göstergesi, görüş mesafesi ön ayarları, bellek temizleme
 * ve ana menü modu. Ayarlar `config/west-companion.json`'a yazılır ve
 * launcher'daki instance ayarlarıyla senkron kalır.
 */
public class WestPanelScreen extends Screen {
    private static final ResourceLocation COMPASS = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "textures/gui/compass.png");
    private final Screen parent;
    private String memoryNote = "";

    public WestPanelScreen(Screen parent) {
        super(Component.translatable("west_companion.panel"));
        this.parent = parent;
    }

    private Component onOff(String key, boolean on) {
        return Component.translatable(key).append(": ").append(Component.translatable(on ? "options.on" : "options.off"));
    }

    // Küçük pencerelerde (yüksek GUI ölçeği) her şeyin sığması için sıkı ölçüler
    private int bh() { return height < 280 ? 18 : 20; }
    private int gap() { return height < 280 ? 3 : 5; }
    private int section() { return height < 280 ? 10 : 14; }
    private int blockHeight() { return 30 + 7 * (bh() + gap()) + 3 * section() + 26; }
    private int top() { return Math.max(4, (height - blockHeight()) / 2); }

    @Override
    protected void init() {
        int w = 240, bh = bh(), gap = gap();
        int x = width / 2 - w / 2;
        int y = top() + 30;
        int d = 0;

        // Ashi PvP Koçu + 1v1 botu
        addRenderableWidget(new WestButton(x, y, w, bh, Component.translatable("west_companion.pvp.open"), b -> minecraft.setScreen(new DuelScreen(this)), d, true));
        y += bh + gap;

        addRenderableWidget(new WestButton(x, y, w, bh, onOff("west_companion.fullbright", West.config.fullbright), b -> {
            West.config.fullbright = !West.config.fullbright;
            West.config.save();
            b.setMessage(onOff("west_companion.fullbright", West.config.fullbright));
        }, d += 30, West.config.fullbright));

        addRenderableWidget(new WestButton(x, y += bh + gap, w, bh, onOff("west_companion.fps", West.config.fpsOverlay), b -> {
            West.config.fpsOverlay = !West.config.fpsOverlay;
            West.config.save();
            b.setMessage(onOff("west_companion.fps", West.config.fpsOverlay));
        }, d += 30, false));

        // Görüş + simülasyon mesafesi ön ayarları (chunk yükü)
        y += bh + gap + section();
        int third = (w - gap * 2) / 3;
        int[][] presets = {{6, 6}, {10, 8}, {16, 12}};
        String[] names = {"west_companion.view.low", "west_companion.view.medium", "west_companion.view.high"};
        for (int i = 0; i < 3; i++) {
            int[] p = presets[i];
            WestButton btn = new WestButton(x + i * (third + gap), y, third, bh, Component.translatable(names[i]), b -> {
                minecraft.options.renderDistance().set(p[0]);
                minecraft.options.simulationDistance().set(p[1]);
                minecraft.options.save();
                rebuildWidgets();
            }, d += 30, false);
            btn.selected = minecraft.options.renderDistance().get() == p[0];
            addRenderableWidget(btn);
        }

        addRenderableWidget(new WestButton(x, y += bh + gap + section(), w, bh, Component.translatable("west_companion.gc"), b -> {
            Runtime rt = Runtime.getRuntime();
            long before = rt.totalMemory() - rt.freeMemory();
            System.gc();
            long freed = Math.max(0, before - (rt.totalMemory() - rt.freeMemory())) >> 20;
            memoryNote = Component.translatable("west_companion.gc.done", freed).getString();
        }, d += 30, false));

        String[] modes = {"auto", "button", "off"};
        addRenderableWidget(new WestButton(x, y += bh + gap, w, bh, modeLabel(), b -> {
            int i = java.util.Arrays.asList(modes).indexOf(West.config.menuMode);
            West.config.menuMode = modes[(i + 1) % modes.length];
            West.config.save();
            b.setMessage(modeLabel());
        }, d += 30, false));

        addRenderableWidget(new WestButton(x, y + bh + gap + section(), w, bh, Component.translatable("gui.done"), b -> onClose(), d + 30, true));
    }

    private Component modeLabel() {
        return Component.translatable("west_companion.menu_mode").append(": ").append(Component.translatable("west_companion.menu_mode." + West.config.menuMode));
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int cx = width / 2;
        int top = top();
        g.blit(COMPASS, cx - 120, top + 2, 0, 0, 20, 20, 20, 20);
        g.drawString(font, title, cx - 94, top + 8, 0xFFE2E4E7, false);
        g.drawString(font, Component.translatable("west_companion.view"), cx - 120, top + 30 + 3 * (bh() + gap()) + section() - 10, 0xFF8B9098, false);

        int y = top + blockHeight() - 22;
        if (!memoryNote.isEmpty()) g.drawCenteredString(font, memoryNote, cx, y, 0xFF9FC4A8);
        if (Compat.conflict()) {
            g.drawCenteredString(font, Component.translatable("west_companion.compat", String.join(", ", Compat.conflicts())), cx, y + 12, 0xFF8B9098);
        }
        if (West.config.fullbright && minecraft.getConnection() != null && !minecraft.hasSingleplayerServer()) {
            g.drawCenteredString(font, Component.translatable("west_companion.fullbright.server_hint"), cx, y + 24, 0xFFC7A566);
        }
    }

    @Override
    public void onClose() {
        minecraft.setScreen(parent);
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (West.isPanelKey(keyCode)) {
            onClose();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public boolean isPauseScreen() {
        return parent != null;
    }
}
