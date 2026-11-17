package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.vertex.PoseStack;
import dev.west.companion.v121.WestCosmetics;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.render.pip.GuiSkinRenderer;
import net.minecraft.client.gui.render.state.pip.GuiSkinRenderState;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.texture.OverlayTexture;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/** Menülerdeki karakterin (skin çizici) üzerine West kozmetiklerini çiz: tampon boşaltılmadan hemen önce */
@Mixin(GuiSkinRenderer.class)
abstract class GuiSkinCosmeticsMixin {
    @Redirect(method = "renderToTexture(Lnet/minecraft/client/gui/render/state/pip/GuiSkinRenderState;Lcom/mojang/blaze3d/vertex/PoseStack;)V",
            at = @At(value = "INVOKE", target = "Lnet/minecraft/client/renderer/MultiBufferSource$BufferSource;endBatch()V"), require = 0)
    private void west$cosmetics(MultiBufferSource.BufferSource src, GuiSkinRenderState s, PoseStack pose) {
        WestHud.safe("gui-cosmetics", () -> WestCosmetics.renderGui(s.playerModel().root(), pose,
                (part, type) -> part.render(pose, src.getBuffer(type), 0xF000F0, OverlayTexture.NO_OVERLAY)));
        src.endBatch();
    }
}
