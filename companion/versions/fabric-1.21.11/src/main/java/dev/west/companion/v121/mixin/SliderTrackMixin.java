package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.AbstractSliderButton;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Vanilla AbstractSliderButton dokusunu West görünümüyle değiştirir (track). */
@Mixin(AbstractSliderButton.class)
abstract class SliderTrackMixin {
    @Redirect(method = "renderWidget", require = 0, at = @At(value = "INVOKE", ordinal = 0,
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIIII)V"))
    private void west$skin(GuiGraphics g, RenderPipeline p, Identifier id, int x, int y, int w, int h, int color) {
        if (!Skin.on()) { g.blitSprite(p, id, x, y, w, h, color); return; }
        AbstractWidget self = (AbstractWidget) (Object) this;
        boolean[] done = {false};
        WestHud.safe("skin-track", () -> { Skin.sliderTrack(new Gfx121(g), x, y, w, h, self.isHoveredOrFocused()); done[0] = true; });
        if (!done[0]) g.blitSprite(p, id, x, y, w, h, color);
    }
}
