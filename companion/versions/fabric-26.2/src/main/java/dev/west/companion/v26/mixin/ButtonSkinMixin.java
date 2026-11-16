package dev.west.companion.v26.mixin;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.west.companion.v26.Gfx26;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Vanilla AbstractButton dokusunu West görünümüyle değiştirir (button). */
@Mixin(AbstractButton.class)
abstract class ButtonSkinMixin {
    @Redirect(method = "extractDefaultSprite", require = 0, at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/GuiGraphicsExtractor;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIIII)V"))
    private void west$skin(GuiGraphicsExtractor g, RenderPipeline p, Identifier id, int x, int y, int w, int h, int color) {
        if (!Skin.on()) { g.blitSprite(p, id, x, y, w, h, color); return; }
        AbstractWidget self = (AbstractWidget) (Object) this;
        boolean[] done = {false};
        WestHud.safe("skin-button", () -> { Skin.button(new Gfx26(g), x, y, w, h, self.isHoveredOrFocused(), self.active); done[0] = true; });
        if (!done[0]) g.blitSprite(p, id, x, y, w, h, color);
    }
}
