package dev.west.companion;

import net.minecraft.client.Minecraft;
import net.minecraft.client.OptionInstance;

/**
 * FullBright: oyuncunun gamma ayarına dokunmadan, ışık hesaplamasına
 * yüksek bir gamma değeri verir (mixin: OptionInstanceMixin).
 * Yalnızca istemci tarafı görseldir; sunucuya hiçbir şey gönderilmez.
 */
public final class FullBright {
    public static final double GAMMA = 15.0;

    private FullBright() {}

    public static boolean appliesTo(OptionInstance<?> option) {
        if (West.config == null || !West.config.fullbright || !SafeHook.enabled("fullbright")) return false;
        Minecraft mc = Minecraft.getInstance();
        return mc != null && mc.options != null && option == mc.options.gamma();
    }
}
