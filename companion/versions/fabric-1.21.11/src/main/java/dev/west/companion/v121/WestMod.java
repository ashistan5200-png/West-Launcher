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
    /** Mod Merkezi: varsayılan H */
    public static final KeyMapping MODS = new KeyMapping("key.west_companion.mods", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, CATEGORY);
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
        KeyBindingHelper.registerKeyBinding(MODS);
        // /westmods (ve /modmerkezi): sohbetten Mod Merkezi'ni aç (sohbet kapandıktan sonra, bir sonraki tick'te)
        net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback.EVENT.register((dispatcher, ctx) -> {
            for (String name : new String[] { "westmods", "modmerkezi" })
                dispatcher.register(net.fabricmc.fabric.api.client.command.v2.ClientCommandManager.literal(name).executes(c -> {
                    WestHud.later(() -> WestHud.later(WestHud.game::openModHub));
                    return 1;
                }));
        });
        ClientTickEvents.END_CLIENT_TICK.register(WestMod::tick);
        // Dünya paylaşma: e4mc'nin verdiği herkese açık adresi sohbetten yakala
        net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents.GAME.register((msg, overlay) -> WestHud.safe("tunnel", () -> Game121.onChat(msg)));
        // Duraklatma ekranı: sol altta Essential / Flashback kartları
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.PauseScreen ps) || !ps.showsPauseMenu() || !dev.west.hud.compat.ModCards.any()) return;
            WestHud.safe("mod-cards", () -> net.fabricmc.fabric.api.client.screen.v1.Screens.getButtons(screen).add(new ModCardsLayer(w, h)));
        });
        // Bağlantı reddedildiğinde sebebi ve çözümü göster (geçersiz oturum, çevrimdışı hesap, Xbox ayarı…)
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.DisconnectedScreen)) return;
            WestHud.safe("connect-help", () -> {
                java.util.List<String> keys = new java.util.ArrayList<>();
                StringBuilder text = new StringBuilder();
                for (var widget : net.fabricmc.fabric.api.client.screen.v1.Screens.getButtons(screen)) {
                    collectKeys(widget.getMessage(), keys);
                    text.append(widget.getMessage().getString()).append('\n');
                }
                collectKeys(screen.getTitle(), keys);
                boolean offline = client.getUser().getAccessToken().length() < 20;
                String hint = dev.west.hud.compat.ConnectHelp.hint(keys, text.toString(), offline);
                if (hint == null) return;
                var label = new net.minecraft.client.gui.components.MultiLineTextWidget(
                        net.minecraft.network.chat.Component.literal("⚠ " + hint).withStyle(net.minecraft.ChatFormatting.YELLOW), client.font);
                label.setMaxWidth(Math.min(w - 40, 420));
                label.setPosition((w - label.getWidth()) / 2, 10);
                net.fabricmc.fabric.api.client.screen.v1.Screens.getButtons(screen).add(label);
            });
        });
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

    private static void collectKeys(net.minecraft.network.chat.Component c, java.util.List<String> keys) {
        if (c == null) return;
        if (c.getContents() instanceof net.minecraft.network.chat.contents.TranslatableContents tc) {
            keys.add(tc.getKey());
            for (Object a : tc.getArgs()) if (a instanceof net.minecraft.network.chat.Component ac) collectKeys(ac, keys);
        }
        for (var s : c.getSiblings()) collectKeys(s, keys);
    }

    private static boolean gpuChecked;
    private static int gpuWait;

    private static void tick(Minecraft mc) {
        // İlk dünyaya girişte bir kez: oyun zayıf (entegre/yazılımsal) grafikte mi çalışıyor?
        // Dünya yüklenip sohbet hazır olsun diye ~5 sn bekle
        if (!gpuChecked && mc.player != null && ++gpuWait > 100) {
            gpuChecked = true;
            WestHud.safe("gpu-check", () -> {
                String hint = dev.west.hud.compat.GpuCheck.hint(com.mojang.blaze3d.systems.RenderSystem.getDevice().getRenderer(), null);
                if (hint != null) mc.player.displayClientMessage(net.minecraft.network.chat.Component.literal("⚠ " + hint).withStyle(net.minecraft.ChatFormatting.YELLOW), false);
            });
        }
        WestHud.tick();
        WestHud.safe("music", () -> WestMusic.tick(mc));
        WestHud.safe("pinger", Game121::tickPinger);
        WestHud.safe("restore-ops", Game121::restoreOps);
        // Minecraft'ın başlık ekranı açıldıysa West ana menüsüyle değiştir
        if (mc.screen instanceof net.minecraft.client.gui.screens.TitleScreen && WestHud.customTitle()) {
            Game121.refreshWorlds();
            mc.setScreen(new WestHost(WestHud.home()));
        }
        while (MENU.consumeClick()) {
            if (mc.screen == null) WestHud.game.openWestScreen(false);
        }
        while (MODS.consumeClick()) {
            if (mc.screen == null) WestHud.game.openModHub();
        }
        while (EDITOR.consumeClick()) {
            if (mc.screen == null && mc.player != null) WestHud.game.openWestScreen(true);
        }
    }
}
