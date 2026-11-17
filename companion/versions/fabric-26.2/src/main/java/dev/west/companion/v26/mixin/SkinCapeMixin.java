package dev.west.companion.v26.mixin;

import dev.west.companion.v26.WestCosmetics;
import dev.west.hud.WestHud;
import net.minecraft.client.Minecraft;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** West Coin pelerini: kendi oyuncunun skin'ine kuşanılmış pelerin eklenir */
@Mixin(AbstractClientPlayer.class)
abstract class SkinCapeMixin {
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true, require = 0)
    private void west$cape(CallbackInfoReturnable<PlayerSkin> cir) {
        if ((Object) this != Minecraft.getInstance().player) return;
        WestHud.safe("cape", () -> cir.setReturnValue(WestCosmetics.withCape(cir.getReturnValue())));
    }
}
