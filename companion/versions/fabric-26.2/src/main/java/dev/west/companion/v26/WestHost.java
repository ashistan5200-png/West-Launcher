package dev.west.companion.v26;

import dev.west.hud.WestHud;
import dev.west.hud.screen.WestScreen;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Sürümden bağımsız West ekranını 26.x Screen olarak taşır; olayları ona iletir. */
final class WestHost extends Screen {
    private WestScreen inner;

    WestHost(WestScreen inner) {
        super(Component.literal("West"));
        this.inner = inner;
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        WestHud.safe("screen", () -> inner.render(new Gfx26(g, d -> extractPanorama(g, d)), mouseX, mouseY, delta));
    }

    /** Vanilla'nın karartma/bulanıklaştırma arka planı yerine kendi arka planımız çizilir. */
    @Override
    public void extractBackground(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {}

    @Override
    public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
        WestHud.safe("click", () -> inner.mouseClicked(e.x(), e.y(), e.button()));
        return true;
    }

    @Override
    public boolean mouseReleased(MouseButtonEvent e) {
        WestHud.safe("release", () -> inner.mouseReleased(e.x(), e.y(), e.button()));
        return true;
    }

    @Override
    public boolean mouseDragged(MouseButtonEvent e, double dx, double dy) {
        WestHud.safe("drag", () -> inner.mouseDragged(e.x(), e.y(), e.button()));
        return true;
    }

    @Override
    public boolean mouseScrolled(double x, double y, double h, double v) {
        WestHud.safe("scroll", () -> inner.mouseScrolled(x, y, v));
        return true;
    }

    @Override
    public boolean keyPressed(KeyEvent e) {
        int key = e.key();
        boolean[] used = { false };
        WestHud.safe("key", () -> used[0] = inner.keyPressed(key));
        if (used[0]) return true;
        // Esc ya da menü tuşu: bir geri git, yoksa kapat
        if (key == 256 || WestMod.MENU.matches(e)) {
            WestScreen next = inner.escape();
            if (next == null) onClose();
            else inner = next;
            return true;
        }
        return super.keyPressed(e);
    }

    @Override
    public boolean charTyped(CharacterEvent e) {
        int cp = e.codepoint();
        if (cp >= 32 && cp < 0xFFFF) WestHud.safe("char", () -> inner.charTyped((char) cp));
        return true;
    }

    @Override
    public void removed() {
        WestHud.safe("removed", inner::removed);
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
