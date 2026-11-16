package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.TabButton;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Dünya oluşturma gibi ekranlardaki sekmeler West görünümünde. */
@Mixin(net.minecraft.client.gui.components.TabButton.class)
abstract class TabSkinMixin {
    @Redirect(method = "renderWidget", require = 0, at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIII)V"))
    private void west$skin(GuiGraphics g, RenderPipeline p, Identifier id, int x, int y, int w, int h) {
        if (!Skin.on()) { g.blitSprite(p, id, x, y, w, h); return; }
        TabButton self = (TabButton) (Object) this;
        boolean[] done = {false};
        WestHud.safe("skin-tab", () -> { Skin.tab(new Gfx121(g), x, y, w, h, self.isSelected(), self.isHoveredOrFocused()); done[0] = true; });
        if (!done[0]) g.blitSprite(p, id, x, y, w, h);
    }
}
