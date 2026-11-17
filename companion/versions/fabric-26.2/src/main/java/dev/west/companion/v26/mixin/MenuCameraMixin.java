package dev.west.companion.v26.mixin;

import dev.west.companion.v26.MenuWorld;
import net.minecraft.client.Camera;
import net.minecraft.client.DeltaTracker;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Ana menü dünyasında kamera sabit noktadan oyuncuya bakar (oyuncu görünür) */
@Mixin(Camera.class)
abstract class MenuCameraMixin {
    @Shadow private boolean detached;

    @Shadow protected abstract void setPosition(double x, double y, double z);

    @Shadow protected abstract void setRotation(float yaw, float pitch);

    @Inject(method = "update", at = @At("TAIL"), require = 0)
    private void west$menuCamera(DeltaTracker delta, CallbackInfo ci) {
        if (!MenuWorld.cameraReady()) return;
        detached = true;
        setRotation(MenuWorld.camYaw(), MenuWorld.camPitch());
        setPosition(MenuWorld.camX(), MenuWorld.camY(), MenuWorld.camZ());
    }
}
