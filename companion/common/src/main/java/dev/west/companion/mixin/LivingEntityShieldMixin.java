package dev.west.companion.mixin;

import dev.west.companion.SafeHook;
import dev.west.companion.pvp.Duel;
import net.minecraft.world.entity.LivingEntity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Kalkanla engellenen vuruşlar (Ashi'nin kalkanını baltayla kırma, koç istatistikleri). */
@Mixin(LivingEntity.class)
abstract class LivingEntityShieldMixin {
    @Inject(method = "blockUsingShield", at = @At("HEAD"))
    private void west$shield(LivingEntity attacker, CallbackInfo ci) {
        SafeHook.run("duel-shield", () -> Duel.onShieldBlock((LivingEntity) (Object) this, attacker));
    }
}
