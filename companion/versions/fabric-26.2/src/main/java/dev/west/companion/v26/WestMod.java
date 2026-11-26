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
    /** Mod Merkezi: varsayılan H */
    public static final KeyMapping MODS = new KeyMapping("key.west_companion.mods", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_H, CATEGORY);
    public static final KeyMapping EDITOR = new KeyMapping("key.west_companion.editor", InputConstants.Type.KEYSYM, InputConstants.UNKNOWN.getValue(), CATEGORY);

    @Override
    public void onInitializeClient() {
        WestHud.init(new Game26());
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
        KeyMappingHelper.registerKeyMapping(MENU);
        KeyMappingHelper.registerKeyMapping(EDITOR);
        KeyMappingHelper.registerKeyMapping(MODS);
        // /westmods (ve /modmerkezi): sohbetten Mod Merkezi'ni aç (sohbet kapandıktan sonra, bir sonraki tick'te)
        net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback.EVENT.register((dispatcher, ctx) -> {
            for (String name : new String[] { "westmods", "modmerkezi" })
                dispatcher.register(net.fabricmc.fabric.api.client.command.v2.ClientCommands.literal(name).executes(c -> {
                    WestHud.later(() -> WestHud.later(WestHud.game::openModHub));
                    return 1;
                }));
        });
        // Yalnızca geliştirmede (-Dwest.dev=1): /westpanorama ana menü arka planı için 6 yüzlü panorama çeker
        if (Boolean.getBoolean("west.dev")) net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback.EVENT.register((dispatcher, ctx) ->
                dispatcher.register(net.fabricmc.fabric.api.client.command.v2.ClientCommands.literal("westpanorama").executes(c -> {
                    WestHud.later(() -> WestHud.later(() -> {
                        var mc = net.minecraft.client.Minecraft.getInstance();
                        var msg = mc.grabPanoramixScreenshot(mc.gameDirectory);
                        WestHud.LOG.info("Panorama: {}", msg.getString());
                    }));
                    return 1;
                })));
        ClientTickEvents.END_CLIENT_TICK.register(WestMod::tick);
        // Oyun kapanırken açık oturumun performans ölçümü launcher'a gider
        net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents.CLIENT_STOPPING.register(c -> WestHud.safe("perf", () -> {
            dev.west.hud.mods.PerfRecorder.finish(WestHud.game);
            try { Thread.sleep(400); } catch (InterruptedException ignored) {}
        }));
        // Arka planda açılan devralma oturumu: pencere hemen simge durumuna
        dev.west.hud.mods.Handoff.early(WestHud.game);
        // Dünya paylaşma: e4mc'nin verdiği herkese açık adresi sohbetten yakala
        net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents.GAME.register((msg, overlay) -> WestHud.safe("tunnel", () -> Game26.onChat(msg)));
        // Duraklatma ekranı: sol altta Essential / Flashback kartları
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.PauseScreen ps) || !ps.showsPauseMenu() || !dev.west.hud.compat.ModCards.any()) return;
            WestHud.safe("mod-cards", () -> net.fabricmc.fabric.api.client.screen.v1.Screens.getWidgets(screen).add(new ModCardsLayer(w, h)));
        });
        // Bağlantı reddedildiğinde sebebi ve çözümü göster (geçersiz oturum, çevrimdışı hesap, Xbox ayarı…)
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.DisconnectedScreen)) return;
            WestHud.safe("connect-help", () -> {
                java.util.List<String> keys = new java.util.ArrayList<>();
                StringBuilder text = new StringBuilder();
                for (var widget : net.fabricmc.fabric.api.client.screen.v1.Screens.getWidgets(screen)) {
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
                net.fabricmc.fabric.api.client.screen.v1.Screens.getWidgets(screen).add(label);
            });
        });
        // Vanilla başlık ekranında West ana menüsüne dönüş düğmesi (sağ üst)
        net.fabricmc.fabric.api.client.screen.v1.ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> {
            if (!(screen instanceof net.minecraft.client.gui.screens.TitleScreen) || WestHud.customTitle()) return;
            net.fabricmc.fabric.api.client.screen.v1.Screens.getWidgets(screen).add(net.minecraft.client.gui.components.Button.builder(net.minecraft.network.chat.Component.literal("◆ West"), b -> {
                WestHud.config.data.customTitle = true;
                WestHud.save();
                client.gui.setScreen(new WestHost(WestHud.home()));
            }).bounds(w - 66, 6, 60, 20).build());
        });
        HudElementRegistry.attachElementBefore(VanillaHudElements.CHAT, Identifier.fromNamespaceAndPath("west_companion", "hud"),
                (g, delta) -> { frame(); WestHud.renderHud(new Gfx26(g)); });
    }

    private static void collectKeys(net.minecraft.network.chat.Component c, java.util.List<String> keys) {
        if (c == null) return;
        if (c.getContents() instanceof net.minecraft.network.chat.contents.TranslatableContents tc) {
            keys.add(tc.getKey());
            for (Object a : tc.getArgs()) if (a instanceof net.minecraft.network.chat.Component ac) collectKeys(ac, keys);
        }
        for (var s : c.getSiblings()) collectKeys(s, keys);
    }

    private static boolean debugPublished;

    /** Yalnızca test: -Dwest.debugPublish=port:offline ile dünya açılınca otomatik paylaş */
    private static void debugPublish(Minecraft mc) {
        String v = System.getProperty("west.debugPublish");
        if (v == null || debugPublished || mc.player == null || mc.getSingleplayerServer() == null) return;
        debugPublished = true;
        String[] p = v.split(":");
        var srv = mc.getSingleplayerServer();
        srv.setUsesAuthentication(!(p.length > 1 && p[1].equals("offline")));
        boolean ok = srv.publishServer(net.minecraft.server.MinecraftServer.MultiplayerScope.LAN, net.minecraft.world.level.GameType.SURVIVAL, false, Integer.parseInt(p[0]));
        WestHud.LOG.info("debugPublish {} -> {}", v, ok);
    }

    // Yalnızca ölçüm: -Dwest.frameLog=1 ile 10 sn'de bir ortalama FPS ve takılma (>50 ms kare) sayısı
    private static final boolean FRAME_LOG = Boolean.getBoolean("west.frameLog");
    private static long lastFrame, winStart;
    private static int frames, spikes;
    private static long worst;

    static void frame() {
        if (!FRAME_LOG) return;
        long now = System.nanoTime();
        if (lastFrame != 0) {
            long d = now - lastFrame;
            if (d > 50_000_000L) spikes++;
            worst = Math.max(worst, d);
        }
        lastFrame = now;
        frames++;
        if (winStart == 0) winStart = now;
        if (now - winStart > 10_000_000_000L) {
            WestHud.LOG.info("frameLog fps={} spikes>50ms={} worst={}ms", Math.round(frames / ((now - winStart) / 1e9)), spikes, worst / 1_000_000);
            winStart = now;
            frames = spikes = 0;
            worst = 0;
        }
    }

    private static boolean gpuChecked;
    private static int gpuWait;

    private static void tick(Minecraft mc) {
        // İlk dünyaya girişte bir kez: oyun zayıf (entegre/yazılımsal) grafikte mi çalışıyor?
        // Dünya yüklenip sohbet hazır olsun diye ~5 sn bekle
        if (!gpuChecked && mc.player != null && ++gpuWait > 100) {
            gpuChecked = true;
            WestHud.safe("gpu-check", () -> {
                var info = com.mojang.blaze3d.systems.RenderSystem.getDevice().getDeviceInfo(); String hint = dev.west.hud.compat.GpuCheck.hint(info.name(), info.type() == null ? null : info.type().name());
                if (hint != null) mc.gui.chatListener().handleSystemMessage(net.minecraft.network.chat.Component.literal("⚠ " + hint).withStyle(net.minecraft.ChatFormatting.YELLOW), false);
            });
        }
        WestHud.tick();
        WestHud.safe("music", () -> WestMusic.tick(mc));
        WestHud.safe("pinger", Game26::tickPinger);
        WestHud.safe("restore-ops", Game26::restoreOps);
        WestHud.safe("debug-publish", () -> debugPublish(mc));
        // Minecraft'ın başlık ekranı açıldıysa West ana menüsüyle değiştir
        if (mc.gui.screen() instanceof net.minecraft.client.gui.screens.TitleScreen && WestHud.customTitle()) {
            Game26.refreshWorlds();
            mc.gui.setScreen(new WestHost(WestHud.home()));
        }
        while (MENU.consumeClick()) {
            if (mc.gui.screen() == null) WestHud.game.openWestScreen(false);
        }
        while (MODS.consumeClick()) {
            if (mc.gui.screen() == null) WestHud.game.openModHub();
        }
        while (EDITOR.consumeClick()) {
            if (mc.gui.screen() == null && mc.player != null) WestHud.game.openWestScreen(true);
        }
    }
}
