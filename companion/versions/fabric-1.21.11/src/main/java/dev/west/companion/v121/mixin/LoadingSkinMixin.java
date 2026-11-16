package dev.west.companion.v121.mixin;

import dev.west.companion.v121.Splash;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.LoadingOverlay;
import net.minecraft.util.Util;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Mojang yükleme ekranının üstüne West açılış ekranını aynı solma zamanlamasıyla çizer. */
@Mixin(LoadingOverlay.class)
abstract class LoadingSkinMixin {
    @Shadow private float currentProgress;
    @Shadow private long fadeOutStart;
    @Shadow private long fadeInStart;
    @Shadow @Final private boolean fadeIn;

    @Inject(method = "render", at = @At("TAIL"), require = 0)
    private void west$splash(GuiGraphics g, int mx, int my, float delta, CallbackInfo ci) {
        long now = Util.getMillis();
        float out = fadeOutStart > -1 ? (now - fadeOutStart) / 1000f : -1;
        float in = fadeInStart > -1 ? (now - fadeInStart) / 500f : 0;
        float alpha = out >= 1 ? 1 - Math.min(1, out - 1) : fadeIn ? Math.max(0, Math.min(1, in)) : 1;
        float p = currentProgress;
        WestHud.safe("splash", () -> Splash.draw(g, alpha, p));
    }
}
