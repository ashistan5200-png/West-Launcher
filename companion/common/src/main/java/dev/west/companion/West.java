package dev.west.companion;

import com.mojang.blaze3d.platform.InputConstants;
import dev.west.companion.gui.WestPanelScreen;
import dev.west.companion.gui.WestTitleScreen;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Consumer;

/**
 * West Companion — West Launcher'ın oyun içi parçası.
 * Loader'a özgü sınıflar (Fabric/NeoForge) yalnızca olayları buraya iletir;
 * tüm davranış bu ortak katmandadır.
 */
public final class West {
    public static final String MOD_ID = "west_companion";
    public static final Logger LOG = LoggerFactory.getLogger("WestCompanion");

    public static Platform platform;
    public static WestConfig config;

    public static final KeyMapping PANEL_KEY = new KeyMapping(
            "key.west_companion.panel", InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_RIGHT_SHIFT, "key.categories.west_companion");

    private static int tick;

    private West() {}

    public static void init(Platform p) {
        platform = p;
        config = WestConfig.load(p.configDir().resolve("west-companion.json"));
        Compat.detect(p);
        LOG.info("West Companion hazır (menü modu: {}, uyumluluk: {})", config.menuMode, Compat.summary());
    }

    /** Her istemci tick'inin sonunda. Ucuz tutulur: ağır iş yok. */
    public static void onClientTick(Minecraft mc) {
        SafeHook.run("tick", () -> {
            while (PANEL_KEY.consumeClick()) {
                if (mc.screen == null || mc.screen instanceof PauseScreen) mc.setScreen(new WestPanelScreen(mc.screen));
            }
            // Launcher'ın yazdığı ayar değişikliklerini ~2 sn'de bir yakala
            if (++tick % 40 == 0) config.reloadIfChanged();
        });
        dev.west.companion.pvp.Coach.tick(mc);
    }

    /**
     * Açılmak üzere olan ekranı West menüsüyle değiştirmeli miyiz?
     * Yalnızca TAM OLARAK vanilla TitleScreen değiştirilir — Essential ve benzerleri
     * kendi alt sınıflarını/ekranlarını açtığı için bunlara hiç dokunulmaz.
     */
    public static Screen maybeReplace(Screen opening) {
        if (opening != null && opening.getClass() == TitleScreen.class && Compat.replaceTitleScreen() && SafeHook.enabled("menu")) {
            return new WestTitleScreen((TitleScreen) opening);
        }
        return opening;
    }

    /** Ekran açıldıktan sonra: duraklat menüsüne ve (uyumluluk modunda) ana menüye küçük "West" düğmesi. */
    public static void afterScreenInit(Screen screen, Consumer<Button> addButton) {
        SafeHook.run("buttons", () -> {
            boolean pause = screen instanceof PauseScreen;
            boolean compatTitle = screen instanceof TitleScreen && !(screen instanceof WestTitleScreen) && config.showWestButton();
            if (!pause && !compatTitle) return;
            int w = 54;
            addButton.accept(Button.builder(Component.literal("◆ West"), b -> Minecraft.getInstance().setScreen(new WestPanelScreen(screen)))
                    // Sağ alt: sağ üst köşe bildirimler (toast) tarafından kapatılabiliyor
                    .bounds(screen.width - w - 6, screen.height - (pause ? 24 : 36), w, 18)
                    .tooltip(net.minecraft.client.gui.components.Tooltip.create(Component.translatable("west_companion.panel.tooltip")))
                    .build());
        });
    }

    public static void onJoinServer(Minecraft mc) {
        SafeHook.run("join", () -> {
            if (config.fullbright && !mc.hasSingleplayerServer() && mc.gui != null) {
                mc.gui.getChat().addMessage(Component.translatable("west_companion.fullbright.server_warning"));
            }
        });
    }

    // ───────── Ashi 1v1 (yerleşik sunucu olayları; loader sınıflarından iletilir) ─────────

    public static void onServerTick(net.minecraft.server.MinecraftServer server) {
        dev.west.companion.pvp.Duel.onServerTick(server);
    }

    public static void onServerStopping(net.minecraft.server.MinecraftServer server) {
        dev.west.companion.pvp.Duel.onServerStopping(server);
    }

    public static void onPlayerJoin(net.minecraft.server.level.ServerPlayer player) {
        dev.west.companion.pvp.Duel.onPlayerJoin(player);
    }

    /** false → ölüm iptal (düellodaki oyuncu veya Ashi) */
    public static boolean allowDeath(net.minecraft.world.entity.LivingEntity e) {
        try {
            return dev.west.companion.pvp.Duel.allowDeath(e);
        } catch (Throwable t) {
            SafeHook.disable("duel", t);
            return true;
        }
    }

    public static boolean isPanelKey(int keyCode) {
        return PANEL_KEY.matches(keyCode, 0);
    }
}
