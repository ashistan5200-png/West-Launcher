package dev.west.companion;

import com.mojang.blaze3d.platform.InputConstants;
import dev.west.companion.gui.WestPanelScreen;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.function.Consumer;

/**
 * West Companion — West Client'ın oyun içi parçası: West Paneli (Sağ Shift),
 * FullBright, FPS/MS göstergesi ve offline skin. Ana menüye dokunmaz.
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
        LOG.info("West Companion hazır");
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
    }

    /** Duraklat menüsüne küçük "West" düğmesi. */
    public static void afterScreenInit(Screen screen, Consumer<Button> addButton) {
        SafeHook.run("buttons", () -> {
            if (!(screen instanceof PauseScreen)) return;
            int w = 54;
            addButton.accept(Button.builder(Component.literal("◆ West"), b -> Minecraft.getInstance().setScreen(new WestPanelScreen(screen)))
                    .bounds(screen.width - w - 6, screen.height - 24, w, 18)
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

    public static boolean isPanelKey(int keyCode) {
        return PANEL_KEY.matches(keyCode, 0);
    }
}
