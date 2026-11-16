package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.pipeline.RenderPipeline;
import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractScrollArea;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Kaydırma çubuğu: ince yuvarlak çizgi ve tutamaç. */
@Mixin(AbstractScrollArea.class)
abstract class ScrollSkinMixin {
    @Redirect(method = "renderScrollbar", require = 0, at = @At(value = "INVOKE",
            target = "Lnet/minecraft/client/gui/GuiGraphics;blitSprite(Lcom/mojang/blaze3d/pipeline/RenderPipeline;Lnet/minecraft/resources/Identifier;IIII)V"))
    private void west$skin(GuiGraphics g, RenderPipeline p, Identifier id, int x, int y, int w, int h) {
        if (!Skin.on()) { g.blitSprite(p, id, x, y, w, h); return; }
        boolean[] done = {false};
        WestHud.safe("skin-scroll", () -> {
            if (id.getPath().contains("background")) Skin.scrollTrack(new Gfx121(g), x, y, w, h);
            else Skin.scrollHandle(new Gfx121(g), x, y, w, h);
            done[0] = true;
        });
        if (!done[0]) g.blitSprite(p, id, x, y, w, h);
    }
}
