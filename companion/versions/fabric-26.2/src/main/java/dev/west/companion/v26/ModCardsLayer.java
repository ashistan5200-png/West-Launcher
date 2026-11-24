package dev.west.companion.v26;

import dev.west.hud.WestHud;
import dev.west.hud.compat.ModCards;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.network.chat.Component;

/** Duraklatma ekranının sol altına Essential / Flashback kartlarını çizen saydam katman */
final class ModCardsLayer extends AbstractWidget {
    private final ModCards cards = new ModCards();

    ModCardsLayer(int w, int h) {
        super(0, 0, w, h, Component.empty());
    }

    @Override
    protected void extractWidgetRenderState(GuiGraphicsExtractor g, int mx, int my, float delta) {
        WestHud.safe("mod-cards", () -> {
            int w = Math.max(160, Math.min(210, Math.round(getWidth() * 0.42f)));
            cards.render(new Gfx26(g), 10, getHeight() - 10, w, mx, my, true);
        });
    }

    @Override
    public boolean mouseClicked(MouseButtonEvent e, boolean doubleClick) {
        if (e.button() != 0 || !cards.click(e.x(), e.y())) return false;
        return true;
    }

    @Override
    public boolean isMouseOver(double x, double y) {
        return cards.over(x, y);
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput out) {}
}
