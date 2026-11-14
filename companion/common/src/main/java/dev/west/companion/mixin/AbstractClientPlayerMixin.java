package dev.west.companion.mixin;

import dev.west.companion.WestSkin;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.resources.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Offline hesapta launcher'da seçilen skini yalnızca YEREL oyuncuya uygular. */
@Mixin(AbstractClientPlayer.class)
public abstract class AbstractClientPlayerMixin {
    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$offlineSkin(CallbackInfoReturnable<PlayerSkin> cir) {
        Minecraft mc = Minecraft.getInstance();
        AbstractClientPlayer self = (AbstractClientPlayer) (Object) this;
        if (mc.getUser() != null && self.getUUID().equals(mc.getUser().getProfileId())) {
            PlayerSkin skin = WestSkin.get();
            if (skin != null) cir.setReturnValue(skin);
        }
    }
}
