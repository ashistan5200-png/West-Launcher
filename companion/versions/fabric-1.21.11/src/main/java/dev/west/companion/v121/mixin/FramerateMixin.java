package dev.west.companion.v121.mixin;

import com.mojang.blaze3d.platform.FramerateLimitTracker;
import dev.west.companion.v121.WestHost;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** West menüleri (ana menü, duraklatma, West menüsü) açıkken kare hızı 120'ye sabitlenir. */
@Mixin(FramerateLimitTracker.class)
abstract class FramerateMixin {
    @Inject(method = "getFramerateLimit", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$menuFps(CallbackInfoReturnable<Integer> cir) {
        if (WestHost.isOpen()) cir.setReturnValue(120);
    }
}
