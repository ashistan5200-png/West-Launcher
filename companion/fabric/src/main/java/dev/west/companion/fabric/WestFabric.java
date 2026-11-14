package dev.west.companion.fabric;

import dev.west.companion.Hud;
import dev.west.companion.Platform;
import dev.west.companion.West;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.Screens;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;

import java.nio.file.Path;

public final class WestFabric implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        West.init(new Platform() {
            public boolean isModLoaded(String id) { return FabricLoader.getInstance().isModLoaded(id); }
            public Path configDir() { return FabricLoader.getInstance().getConfigDir(); }
            public Path gameDir() { return FabricLoader.getInstance().getGameDir(); }
            public String loaderName() { return "Fabric"; }
        });
        KeyBindingHelper.registerKeyBinding(West.PANEL_KEY);

        // Fabric API'de "açılmadan önce" olayı yok: vanilla TitleScreen açıldığı
        // anda (ilk tick'te) West menüsüne geçilir. Mixin kullanılmaz → çakışma yok.
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            West.onClientTick(mc);
            if (mc.screen != null && mc.screen.getClass() == TitleScreen.class) {
                Screen replacement = West.maybeReplace(mc.screen);
                if (replacement != mc.screen) mc.setScreen(replacement);
            }
        });
        ScreenEvents.AFTER_INIT.register((client, screen, w, h) -> West.afterScreenInit(screen, b -> Screens.getButtons(screen).add(b)));
        HudRenderCallback.EVENT.register((graphics, delta) -> Hud.render(graphics));
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> West.onJoinServer(client));

        // Ashi 1v1: tek oyunculu dünyanın yerleşik sunucusunda çalışır
        ServerTickEvents.END_SERVER_TICK.register(West::onServerTick);
        ServerLifecycleEvents.SERVER_STOPPING.register(West::onServerStopping);
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> West.onPlayerJoin(handler.getPlayer()));
        ServerLivingEntityEvents.ALLOW_DEATH.register((entity, source, amount) -> West.allowDeath(entity));
    }
}
