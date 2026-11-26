package dev.west.companion.v26.mixin;

import dev.west.companion.v26.Game26;
import dev.west.companion.v26.WestHost;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.ModifyVariable;

/**
 * Minecraft'ın başlık ekranı hiç açılmadan West ana menüsü açılır. Önceden başlık ekranı bir kare açılıp sonra
 * değiştiriliyordu; Essential gibi modlar o kısa anda kendi parçalarını (arkadaş listesi vb.) ekleyip menünün
 * üstünde bırakıyordu.
 */
@Mixin(Gui.class)
public class TitleRedirectMixin {
    @ModifyVariable(method = "setScreen", at = @At("HEAD"), argsOnly = true)
    private Screen west$redirectTitle(Screen screen) {
        if (screen instanceof TitleScreen && WestHud.config != null && WestHud.customTitle()) {
            try {
                Game26.refreshWorlds();
                return new WestHost(WestHud.home());
            } catch (Throwable t) {
                WestHud.LOG.warn("West ana menüsü açılamadı, Minecraft menüsü kullanılıyor: {}", t.toString());
            }
        }
        return screen;
    }
}
