package dev.west.companion.v121.mixin;

import dev.west.companion.v121.Gfx121;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Skin;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.tooltip.TooltipRenderUtil;
import net.minecraft.resources.Identifier;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Açıklama kutuları (tooltip) koyu, yuvarlak West kutusu. Özel tooltip stili olan eşyalar hariç. */
@Mixin(TooltipRenderUtil.class)
abstract class TooltipSkinMixin {
    @Inject(method = "renderTooltipBackground", at = @At("HEAD"), cancellable = true, require = 0)
    private static void west$skin(GuiGraphics g, int x, int y, int w, int h, Identifier style, CallbackInfo ci) {
        if (style != null || !Skin.on()) return;
        boolean[] done = {false};
        WestHud.safe("skin-tooltip", () -> { Skin.tooltip(new Gfx121(g), x, y, w, h); done[0] = true; });
        if (done[0]) ci.cancel();
    }
}
