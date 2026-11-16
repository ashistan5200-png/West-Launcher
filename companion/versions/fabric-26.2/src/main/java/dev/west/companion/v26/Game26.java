package dev.west.companion.v26;

import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModMetadata;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.world.item.ItemStack;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/** 26.x oyun bilgisi köprüsü. */
final class Game26 implements Game {
    private List<ModInfo> mods;

    private static Minecraft mc() {
        return Minecraft.getInstance();
    }

    @Override public boolean inWorld() { return mc().player != null && mc().level != null; }
    @Override public boolean hudHidden() { return mc().gui.hud.isHidden(); }
    @Override public boolean debugOpen() { return mc().getDebugOverlay().showDebugScreen(); }
    @Override public int fps() { return mc().getFps(); }

    @Override
    public int ping() {
        Minecraft m = mc();
        if (m.hasSingleplayerServer() || m.player == null) return -1;
        ClientPacketListener c = m.getConnection();
        if (c == null) return -1;
        PlayerInfo info = c.getPlayerInfo(m.player.getUUID());
        return info == null ? -1 : info.getLatency();
    }

    @Override public double x() { return mc().player == null ? 0 : mc().player.getX(); }
    @Override public double y() { return mc().player == null ? 0 : mc().player.getY(); }
    @Override public double z() { return mc().player == null ? 0 : mc().player.getZ(); }
    @Override public float yaw() { return mc().player == null ? 0 : mc().player.getYRot(); }

    @Override
    public boolean keyDown(Key k) {
        var o = mc().options;
        KeyMapping m = switch (k) {
            case FORWARD -> o.keyUp;
            case BACK -> o.keyDown;
            case LEFT -> o.keyLeft;
            case RIGHT -> o.keyRight;
            case JUMP -> o.keyJump;
            case SNEAK -> o.keyShift;
            case ATTACK -> o.keyAttack;
            case USE -> o.keyUse;
        };
        return m.isDown();
    }

    @Override
    public String server() {
        if (mc().hasSingleplayerServer()) return null;
        ServerData d = mc().getCurrentServer();
        return d == null ? null : d.ip;
    }

    @Override
    public float durability(int slot) {
        ItemStack s = Gfx26.stack(slot);
        if (s == null || s.isEmpty() || !s.isDamageableItem() || s.getMaxDamage() <= 0) return -1;
        return 1f - s.getDamageValue() / (float) s.getMaxDamage();
    }

    @Override
    public String minecraftVersion() {
        return FabricLoader.getInstance().getModContainer("minecraft").map(c -> c.getMetadata().getVersion().getFriendlyString()).orElse("26.2");
    }

    @Override public String loaderName() { return "Fabric"; }
    @Override public Path configDir() { return FabricLoader.getInstance().getConfigDir(); }

    @Override
    public List<ModInfo> mods() {
        if (mods != null) return mods;
        List<ModInfo> out = new ArrayList<>();
        for (ModContainer c : FabricLoader.getInstance().getAllMods()) {
            ModMetadata m = c.getMetadata();
            String id = m.getId();
            // Gömülü alt modlar (ör. Fabric API'nin parçaları) ve sistem girdileri listelenmez
            if (c.getContainingMod().isPresent() || id.equals("java") || id.equals("minecraft") || id.equals("fabricloader") || id.equals("mixinextras")) continue;
            out.add(new ModInfo(id, m.getName(), m.getVersion().getFriendlyString(), m.getDescription()));
        }
        out.sort(Comparator.comparing(i -> i.name().toLowerCase()));
        return mods = out;
    }

    @Override
    public void click() {
        mc().getSoundManager().play(SimpleSoundInstance.forUI(SoundEvents.UI_BUTTON_CLICK, 1f));
    }

    @Override
    public void open(Target t) {
        Minecraft m = mc();
        var parent = m.gui.screen();
        switch (t) {
            case SINGLEPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.worldselection.SelectWorldScreen(parent));
            case MULTIPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen(parent));
            case OPTIONS -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.OptionsScreen(parent, m.options, false));
            case LANGUAGE -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.LanguageSelectScreen(parent, m.options, m.getLanguageManager()));
            case QUIT -> m.stop();
        }
    }

    private net.minecraft.client.multiplayer.ServerList serverList() {
        var l = new net.minecraft.client.multiplayer.ServerList(mc());
        l.load();
        return l;
    }

    @Override
    public List<ServerInfo> servers(int max) {
        var l = serverList();
        List<ServerInfo> out = new ArrayList<>();
        for (int i = 0; i < Math.min(max, l.size()); i++) out.add(new ServerInfo(l.get(i).name, l.get(i).ip));
        return out;
    }

    @Override
    public void joinServer(int index) {
        var l = serverList();
        if (index < 0 || index >= l.size()) return;
        ServerData d = l.get(index);
        net.minecraft.client.gui.screens.ConnectScreen.startConnecting(mc().gui.screen(), mc(), net.minecraft.client.multiplayer.resolver.ServerAddress.parseString(d.ip), d, false, null);
    }

    @Override
    public String playerName() {
        return mc().getUser().getName();
    }

    @Override
    public void closeScreen() {
        mc().gui.setScreen(null);
    }

    @Override
    public void openWestScreen(boolean editor) {
        mc().gui.setScreen(new WestHost(editor ? WestHud.editor(WestHud.menu()) : WestHud.menu()));
    }
}
