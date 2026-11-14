package dev.west.companion.neoforge;

import dev.west.companion.Hud;
import dev.west.companion.Platform;
import dev.west.companion.West;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModList;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.client.event.ClientPlayerNetworkEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.client.event.ScreenEvent;
import net.neoforged.neoforge.common.NeoForge;

import java.nio.file.Path;

@Mod(value = West.MOD_ID, dist = Dist.CLIENT)
public final class WestNeoForge {
    public WestNeoForge(IEventBus modBus) {
        West.init(new Platform() {
            public boolean isModLoaded(String id) { return ModList.get().isLoaded(id); }
            public Path configDir() { return FMLPaths.CONFIGDIR.get(); }
            public Path gameDir() { return FMLPaths.GAMEDIR.get(); }
            public String loaderName() { return "NeoForge"; }
        });
        modBus.addListener((RegisterKeyMappingsEvent e) -> e.register(West.PANEL_KEY));

        // NeoForge ekranı açılmadan ÖNCE değiştirmeye izin verir (titreme yok)
        NeoForge.EVENT_BUS.addListener((ScreenEvent.Opening e) -> {
            var replacement = West.maybeReplace(e.getNewScreen());
            if (replacement != e.getNewScreen()) e.setNewScreen(replacement);
        });
        NeoForge.EVENT_BUS.addListener((ScreenEvent.Init.Post e) -> West.afterScreenInit(e.getScreen(), b -> e.addListener((GuiEventListener) b)));
        NeoForge.EVENT_BUS.addListener((ClientTickEvent.Post e) -> West.onClientTick(Minecraft.getInstance()));
        NeoForge.EVENT_BUS.addListener((RenderGuiEvent.Post e) -> Hud.render(e.getGuiGraphics()));
        NeoForge.EVENT_BUS.addListener((ClientPlayerNetworkEvent.LoggingIn e) -> West.onJoinServer(Minecraft.getInstance()));
    }
}
