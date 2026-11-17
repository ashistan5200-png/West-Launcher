package dev.west.companion.v26.mixin;

import dev.west.companion.v26.MenuWorld;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.worldselection.WorldOpenFlows;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Gerçek bir dünya açılmadan / oluşturulmadan önce ana menü dünyası kapatılır */
@Mixin(WorldOpenFlows.class)
abstract class MenuJoinMixin {
    @Inject(method = { "openWorld", "createFreshLevel" }, at = @At("HEAD"), require = 0)
    private void west$leaveMenuWorld(CallbackInfo ci) {
        if (!MenuWorld.isOpening()) MenuWorld.stop(Minecraft.getInstance());
    }
}
