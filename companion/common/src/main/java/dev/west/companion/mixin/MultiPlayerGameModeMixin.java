package dev.west.companion.mixin;

import dev.west.companion.pvp.Coach;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** PvP koçu: vuruş anındaki bekleme göstergesi, kritik ve koşu durumu. Yalnızca okur. */
@Mixin(MultiPlayerGameMode.class)
abstract class MultiPlayerGameModeMixin {
    @Inject(method = "attack", at = @At("HEAD"))
    private void west$attack(Player player, Entity target, CallbackInfo ci) {
        Coach.onAttack(player, target);
    }
}
