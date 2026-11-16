package dev.west.companion.v26.mixin;

import dev.west.hud.WestHud;
import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** FullBright: ışık hesaplaması gamma'yı okurken yüksek değer döner. Kayıtlı ayar değişmez. */
@Mixin(OptionInstance.class)
public abstract class OptionInstanceMixin {
    private static final Double GAMMA = 16.0;

    @Inject(method = "get", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$fullbright(CallbackInfoReturnable<Object> cir) {
        if (!WestHud.fullbright()) return;
        Minecraft mc = Minecraft.getInstance();
        if (mc != null && mc.options != null && (Object) this == mc.options.gamma()) cir.setReturnValue(GAMMA);
    }
}
