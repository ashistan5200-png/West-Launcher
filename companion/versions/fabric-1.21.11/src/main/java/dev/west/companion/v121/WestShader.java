package dev.west.companion.v121;

import dev.west.companion.v121.mixin.GameRendererInvoker;
import dev.west.hud.WestHud;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;

/**
 * West shader'ı: Minecraft'ın kendi efekt (post effect) sistemiyle çalıştığı için Vulkan ve OpenGL'de
 * aynı şekilde çalışır. Iris ile bir shader paketi açıksa ona karışmaz.
 */
final class WestShader {
    static final Identifier ID = Identifier.fromNamespaceAndPath("west_companion", "west");
    private static int ticks;

    private WestShader() {}

    static void tick(Minecraft mc) {
        if (++ticks % 10 != 0 || mc.level == null) return;
        var gr = mc.gameRenderer;
        Identifier cur = gr.currentPostEffect();
        boolean want = WestHud.config != null && WestHud.config.data.westShader && !WestHud.config.data.performanceMode && !irisActive();
        if (want && cur == null) ((GameRendererInvoker) gr).west$setPostEffect(ID);
        else if (!want && ID.equals(cur)) gr.clearPostEffect();
    }

    /** Iris ile bir shader paketi kullanılıyor mu (yansıma ile; Iris yoksa false) */
    private static boolean irisActive() {
        if (!FabricLoader.getInstance().isModLoaded("iris")) return false;
        try {
            Class<?> api = Class.forName("net.irisshaders.iris.api.v0.IrisApi");
            Object inst = api.getMethod("getInstance").invoke(null);
            return (boolean) api.getMethod("isShaderPackInUse").invoke(inst);
        } catch (Throwable t) {
            return false;
        }
    }
}
