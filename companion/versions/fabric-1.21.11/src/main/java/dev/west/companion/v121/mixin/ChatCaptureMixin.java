package dev.west.companion.v121.mixin;

import dev.west.companion.v121.Game121;
import dev.west.hud.WestHud;
import net.minecraft.client.gui.components.ChatComponent;
import net.minecraft.network.chat.Component;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * e4mc, herkese açık adresi sunucudan gelen mesaj olarak değil, doğrudan sohbet kutusuna yazar
 * (ve varsayılan olarak "gizli, kopyalamak için tıkla" diye gösterir). Fabric'in mesaj olayları bunu
 * görmez; bu yüzden sohbet kutusuna eklenen her istemci mesajına bakıyoruz.
 */
@Mixin(ChatComponent.class)
abstract class ChatCaptureMixin {
    @Inject(method = "addMessage(Lnet/minecraft/network/chat/Component;)V", at = @At("HEAD"), require = 0)
    private void west$capture(Component msg, CallbackInfo ci) {
        WestHud.safe("tunnel", () -> Game121.onChat(msg));
    }
}
