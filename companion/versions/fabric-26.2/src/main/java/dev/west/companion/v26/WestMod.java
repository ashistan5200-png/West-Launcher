package dev.west.companion.v26;

import com.mojang.blaze3d.platform.InputConstants;
import dev.west.hud.WestHud;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/** West Companion — Minecraft 26.x (Fabric) girişi. */
public final class WestMod implements ClientModInitializer {
    private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("west_companion", "main"));
    /** West menüsü: varsayılan Sağ Shift (Kontroller'den değiştirilebilir) */
    public static final KeyMapping MENU = new KeyMapping("key.west_companion.menu", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, CATEGORY);
    /** HUD düzenleyici: varsayılan atanmamış */
    public static final KeyMapping EDITOR = new KeyMapping("key.west_companion.editor", InputConstants.Type.KEYSYM, InputConstants.UNKNOWN.getValue(), CATEGORY);

    @Override
    public void onInitializeClient() {
        WestHud.init(new Game26());
        KeyMappingHelper.registerKeyMapping(MENU);
        KeyMappingHelper.registerKeyMapping(EDITOR);
        ClientTickEvents.END_CLIENT_TICK.register(WestMod::tick);
        HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, Identifier.fromNamespaceAndPath("west_companion", "hud"),
                (g, delta) -> WestHud.renderHud(new Gfx26(g)));
    }

    private static void tick(Minecraft mc) {
        WestHud.tick();
        while (MENU.consumeClick()) {
            if (mc.gui.screen() == null) WestHud.game.openWestScreen(false);
        }
        while (EDITOR.consumeClick()) {
            if (mc.gui.screen() == null && mc.player != null) WestHud.game.openWestScreen(true);
        }
    }
}
