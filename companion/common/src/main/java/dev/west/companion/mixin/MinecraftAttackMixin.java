package dev.west.companion.mixin;

import dev.west.companion.pvp.Coach;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Her sol tık (ıska dahil) — koçun isabet oranı için. */
@Mixin(Minecraft.class)
abstract class MinecraftAttackMixin {
    @Inject(method = "startAttack", at = @At("HEAD"))
    private void west$swing(CallbackInfoReturnable<Boolean> cir) {
        Coach.onSwing();
    }
}
