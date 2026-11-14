package dev.west.companion.mixin;

import dev.west.companion.FullBright;
import net.minecraft.client.OptionInstance;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** FullBright: ışık hesaplaması gamma'yı okurken yüksek değer döner. Kayıtlı ayar değişmez. */
@Mixin(OptionInstance.class)
public abstract class OptionInstanceMixin {
    @Inject(method = "get", at = @At("HEAD"), cancellable = true, require = 0)
    private void west$fullbright(CallbackInfoReturnable<Object> cir) {
        if (FullBright.appliesTo((OptionInstance<?>) (Object) this)) cir.setReturnValue(FullBright.GAMMA);
    }
}
