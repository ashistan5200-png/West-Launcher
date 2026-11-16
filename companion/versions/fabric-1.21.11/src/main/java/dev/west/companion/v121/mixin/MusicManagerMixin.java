package dev.west.companion.v121.mixin;

import dev.west.companion.v121.WestMusic;
import net.minecraft.client.sounds.MusicManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** West müziği çalarken Minecraft'ın kendi müziği susar (üst üste binmesin). */
@Mixin(MusicManager.class)
abstract class MusicManagerMixin {
    @Inject(method = "tick", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$quiet(CallbackInfo ci) {
        if (WestMusic.active()) {
            ((MusicManager) (Object) this).stopPlaying();
            ci.cancel();
        }
    }
}
