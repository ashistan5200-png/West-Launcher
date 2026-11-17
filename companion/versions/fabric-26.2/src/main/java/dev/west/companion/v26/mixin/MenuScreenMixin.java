package dev.west.companion.v26.mixin;

import dev.west.companion.v26.MenuWorld;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Ana menü dünyası yüklenirken/açıkken yükleme ve duraklatma ekranları yerine West ana menüsü kalır */
@Mixin(Gui.class)
abstract class MenuScreenMixin {
    @Inject(method = "setScreen", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$keepMenu(Screen next, CallbackInfo ci) {
        if (MenuWorld.swallow(next)) {
            ci.cancel();
            MenuWorld.showHost();
        }
    }
}
