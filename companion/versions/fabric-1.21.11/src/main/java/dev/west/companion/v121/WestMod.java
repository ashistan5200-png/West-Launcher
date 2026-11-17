package dev.west.companion.v121;

import com.mojang.blaze3d.platform.InputConstants;
import dev.west.hud.WestHud;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/** West Companion — Minecraft 1.21.11 (Fabric) girişi. */
public final class WestMod implements ClientModInitializer {
    private static final KeyMapping.Category CATEGORY = KeyMapping.Category.register(Identifier.fromNamespaceAndPath("west_companion", "main"));
    /** West menüsü: varsayılan Sağ Shift (Kontroller'den değiştirilebilir) */
    public static final KeyMapping MENU = new KeyMapping("key.west_companion.menu", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, CATEGORY);
    /** HUD düzenleyici: varsayılan atanmamış */
    public static final KeyMapping EDITOR = new KeyMapping("key.west_companion.editor", InputConstants.Type.KEYSYM, InputConstants.UNKNOWN.getValue(), CATEGORY);

    @Override
    public void onInitializeClient() {
        WestHud.init(new Game121());
        // Tüm Minecraft yazılarını pürüzsüz yapan dahili kaynak paketi (Kaynak Paketleri'nden kapatılabilir)
        net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer("west_companion").ifPresent(c ->
                net.fabricmc.fabric.api.resource.v1.ResourceLoader.registerBuiltinPack(Identifier.fromNamespaceAndPath("west_companion", "smooth_ui"), c,
                        net.minecraft.network.chat.Component.literal("West pürüzsüz yazı"),
                        net.fabricmc.fabric.api.resource.v1.pack.PackActivationType.DEFAULT_ENABLED));
        // Ana menü arka planı: West köyü panoraması (gündüz varsayılan, gün batımı isteğe bağlı)
        net.fabricmc.loader.api.FabricLoader.getInstance().getModContainer("west_companion").ifPresent(c -> {
            net.fabricmc.fabric.api.resource.v1.ResourceLoader.registerBuiltinPack(Identifier.fromNamespaceAndPath("west_companion", "village_day"), c,
                    net.minecraft.network.chat.Component.literal("West köy arka planı (gündüz)"),
                    net.fabricmc.fabric.api.resource.v1.pack.PackActivationType.DEFAULT_ENABLED);
            // (gün batımı paketi kaldırıldı: ana menü artık fotoğraf arka plan kullanıyor)
        });
        KeyBindingHelper.registerKeyBinding(MENU);
        KeyBindingHelper.registerKeyBinding(EDITOR);
        ClientTickEvents.END_CLIENT_TICK.register(WestMod::tick);
        // Dünya paylaşma: e4mc'nin verdiği herkese açık adresi sohbetten yakala
        net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents.GAME.register((msg, overlay) -> WestHud.safe("tunnel", () -> Game121.onChat(msg)));
        // Vanilla başlık ekranında West ana menüsüne dönüş düğmesi (sağ üst)
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.TitleScreen) || WestHud.customTitle()) return;
            net.fabricmc.fabric.api.client.screen.v1.Screens.getButtons(screen).add(net.minecraft.client.gui.components.Button.builder(net.minecraft.network.chat.Component.literal("◆ West"), b -> {
                WestHud.config.data.customTitle = true;
                WestHud.save();
                client.setScreen(new WestHost(WestHud.home()));
            }).bounds(w - 66, 6, 60, 20).build());
        });
        HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, Identifier.fromNamespaceAndPath("west_companion", "hud"),
                (g, delta) -> WestHud.renderHud(new Gfx121(g)));
    }

    private static WestHost pendingMenuWorld;

    private static void tick(Minecraft mc) {
        WestHud.tick();
        WestHud.safe("music", () -> WestMusic.tick(mc));
        if (pendingMenuWorld != null && mc.level == null) {
            WestHost h = pendingMenuWorld;
            pendingMenuWorld = null;
            if (mc.screen == h) WestHud.safe("menuworld", () -> MenuWorld.start(mc, h));
        }
        WestHud.safe("menuworld-tick", () -> MenuWorld.tick(mc));
        // Minecraft'ın başlık ekranı açıldıysa West ana menüsüyle değiştir
        if (mc.screen instanceof net.minecraft.client.gui.screens.TitleScreen && WestHud.customTitle()) {
            Game121.refreshWorlds();
            WestHost h = new WestHost(WestHud.home());
            mc.setScreen(h);
            pendingMenuWorld = h;
        }
        // Duraklatma menüsü (Esc) → West duraklatma menüsü (F3+Esc ile açılan menüsüz duraklatma hariç)
        if (!MenuWorld.active && mc.screen instanceof net.minecraft.client.gui.screens.PauseScreen ps && ps.showsPauseMenu() && WestHud.customTitle()) {
            mc.setScreen(new WestHost(WestHud.pause()));
        }
        while (MENU.consumeClick()) {
            if (mc.screen == null) WestHud.game.openWestScreen(false);
        }
        while (EDITOR.consumeClick()) {
            if (mc.screen == null && mc.player != null) WestHud.game.openWestScreen(true);
        }
    }
}
