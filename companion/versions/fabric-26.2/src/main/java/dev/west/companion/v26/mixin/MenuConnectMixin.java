package dev.west.companion.v26.mixin;

import dev.west.companion.v26.MenuWorld;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.ConnectScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Sunucuya bağlanmadan önce ana menü dünyası kapatılır */
@Mixin(ConnectScreen.class)
abstract class MenuConnectMixin {
    @Inject(method = "startConnecting", at = @At("HEAD"), require = 0)
    private static void west$leaveMenuWorld(CallbackInfo ci) {
        MenuWorld.stop(Minecraft.getInstance());
    }
}
