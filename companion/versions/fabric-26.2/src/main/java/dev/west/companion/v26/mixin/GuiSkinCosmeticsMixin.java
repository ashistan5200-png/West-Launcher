package dev.west.companion.v26.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.west.companion.v26.WestCosmetics;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.render.pip.GuiSkinRenderer;
import net.minecraft.client.renderer.SubmitNodeCollector;
import net.minecraft.client.renderer.state.gui.pip.GuiSkinRenderState;
import net.minecraft.client.renderer.texture.OverlayTexture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Menülerdeki karakterin (skin çizici) üzerine West kozmetiklerini çiz */
@Mixin(GuiSkinRenderer.class)
abstract class GuiSkinCosmeticsMixin {
    @Inject(method = "renderToTexture(Lnet/minecraft/client/renderer/state/gui/pip/GuiSkinRenderState;Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/SubmitNodeCollector;)V", at = @At("RETURN"), require = 0)
    private void west$cosmetics(GuiSkinRenderState s, PoseStack pose, SubmitNodeCollector out, CallbackInfo ci) {
        WestHud.safe("gui-cosmetics", () -> WestCosmetics.renderGui(s.playerModel().root(), pose,
                (part, type) -> out.submitModelPart(part, pose, type, 0xF000F0, OverlayTexture.NO_OVERLAY, null)));
    }
}
