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

    @Override public boolean inWorld() { return mc().player != null && mc().level != null && !MenuWorld.active; }

    @Override public boolean liveBackground() { return MenuWorld.cameraReady(); }

    @Override
    public void homeStyleChanged() {
        Minecraft m = mc();
        if (!(m.gui.screen() instanceof WestHost h)) return;
        if (MenuWorld.enabled()) {
            if (!MenuWorld.active && m.level == null) MenuWorld.start(m, h);
        } else if (MenuWorld.active) {
            MenuWorld.stop(m);
            m.gui.setScreen(h);
        }
    }

    @Override public boolean liveLoading() { return MenuWorld.active && !MenuWorld.cameraReady(); }
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
        refreshWorlds();
        switch (t) {
            case SINGLEPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.worldselection.SelectWorldScreen(parent));
            case MULTIPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen(parent));
            case OPTIONS -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.OptionsScreen(parent, m.options, m.level != null));
            case LANGUAGE -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.LanguageSelectScreen(parent, m.options, m.getLanguageManager()));
            case QUIT -> {
                MenuWorld.stop(m);
                m.stop();
            }
            case CREATE_WORLD -> net.minecraft.client.gui.screens.worldselection.CreateWorldScreen.openFresh(m, () -> m.gui.setScreen(parent));
            case ADVANCEMENTS -> { if (m.player != null) m.gui.setScreen(new net.minecraft.client.gui.screens.advancements.AdvancementsScreen(m.player.connection.getAdvancements(), parent)); }
            case STATS -> { if (m.player != null) m.gui.setScreen(new net.minecraft.client.gui.screens.achievement.StatsScreen(parent, m.player.getStats())); }
            case SHARE_LAN -> m.gui.setScreen(new net.minecraft.client.gui.screens.MultiplayerOptionsScreen(parent));
            case DISCONNECT -> { refreshWorlds(); m.disconnectFromWorld(net.minecraft.client.multiplayer.ClientLevel.DEFAULT_QUIT_MESSAGE); }
            case WARDROBE -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.SkinCustomizationScreen(parent, m.options));
            case ADD_SERVER -> m.gui.setScreen(new net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen(parent));
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

    /** e4mc'nin sohbete yazdığı herkese açık adres */
    static volatile String tunnel;
    private static final java.util.regex.Pattern TUNNEL = java.util.regex.Pattern.compile("([a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.e4mc\\.link)");

    /** Sohbet mesajlarından e4mc adresini yakala */
    static void onChat(net.minecraft.network.chat.Component msg) {
        String s = msg.getString() + " " + msg;
        if (s.contains("e4mc_minecraft.closeServer") || s.contains("no longer publicly hosted")) {
            tunnel = null;
        tunnelFailed = false;
            return;
        }
        if (s.contains("e4mc_minecraft.error") || s.contains("An error occurred in e4mc")) {
            tunnelFailed = true;
            return;
        }
        var m = TUNNEL.matcher(s);
        if (m.find()) tunnel = m.group(1);
    }

    @Override
    public boolean hasTunnel() {
        return FabricLoader.getInstance().isModLoaded("e4mc");
    }

    @Override
    public String tunnelAddress() {
        return tunnel;
    }

    static volatile boolean tunnelFailed;

    @Override
    public boolean tunnelFailed() {
        return tunnelFailed;
    }

    @Override
    public int publishWorld(int mode, boolean cheats) {
        var srv = mc().getSingleplayerServer();
        if (srv == null) return -1;
        if (srv.isPublished()) return srv.getPort();
        tunnel = null;
        int port = net.minecraft.util.HttpUtil.getAvailablePort();
        return srv.publishServer(net.minecraft.server.MinecraftServer.MultiplayerScope.LAN, net.minecraft.world.level.GameType.byId(mode), cheats, port) ? port : -1;
    }

    @Override
    public int publishedPort() {
        var srv = mc().getSingleplayerServer();
        return srv != null && srv.isPublished() ? srv.getPort() : -1;
    }

    @Override
    public void connect(String name, String address) {
        if (address == null || address.isBlank()) return;
        ServerData d = new ServerData(name == null || name.isBlank() ? address : name, address, ServerData.Type.OTHER);
        net.minecraft.client.gui.screens.ConnectScreen.startConnecting(mc().gui.screen(), mc(), net.minecraft.client.multiplayer.resolver.ServerAddress.parseString(address), d, false, null);
    }

    @Override
    public String playerName() {
        return mc().getUser().getName();
    }

    // ───── Dünyalar ─────
    static volatile List<WorldInfo> worldCache;
    private static volatile boolean worldsLoading;

    /** Ana menü yeniden açıldığında dünya listesi tazelensin */
    static void refreshWorlds() {
        if (!worldsLoading) worldCache = null;
    }

    @Override
    public List<WorldInfo> worlds(int max) {
        if (worldCache == null && !worldsLoading) {
            worldsLoading = true;
            try {
                var src = mc().getLevelSource();
                src.loadLevelSummaries(src.findLevelCandidates()).thenAccept(list -> {
                    List<WorldInfo> out = new ArrayList<>();
                    for (net.minecraft.world.level.storage.LevelSummary s : list) {
                        if (s.isDisabled()) continue;
                        out.add(new WorldInfo(s.getLevelId(), s.getLevelName(), s.getLastPlayed(), s.getGameMode().getId(), s.isHardcore(),
                                s.getIcon() == null ? null : s.getIcon().toString()));
                    }
                    out.sort(Comparator.comparingLong(WorldInfo::lastPlayed).reversed());
                    worldCache = out;
                    worldsLoading = false;
                }).exceptionally(e -> {
                    worldCache = List.of();
                    worldsLoading = false;
                    return null;
                });
            } catch (Exception e) {
                worldCache = List.of();
                worldsLoading = false;
            }
        }
        List<WorldInfo> c = worldCache;
        return c == null ? List.of() : c.subList(0, Math.min(max, c.size()));
    }

    private static final String[] MODE_NAMES = { "Hayatta kalma", "Yaratıcı", "Macera", "İzleyici" };

    @Override
    public Session session() {
        Minecraft m = mc();
        boolean sp = m.hasSingleplayerServer();
        String mode = m.gameMode == null ? "" : MODE_NAMES[Math.max(0, Math.min(3, m.gameMode.getPlayerMode().getId()))];
        if (sp) {
            var srv = m.getSingleplayerServer();
            String diff = m.level == null ? "" : m.level.getDifficulty().getDisplayName().getString();
            return new Session(true, srv.getWorldData().getLevelName(), mode + (diff.isEmpty() ? "" : " · " + diff), !srv.isPublished());
        }
        ServerData d = m.getCurrentServer();
        return new Session(false, d == null ? "Sunucu" : d.name, d == null ? mode : d.ip, false);
    }

    @Override
    public void joinWorld(String id) {
        refreshWorlds();
        mc().createWorldOpenFlows().openWorld(id, () -> mc().gui.setScreen(new WestHost(WestHud.home())));
    }

    @Override
    public boolean fullscreen() {
        return mc().getWindow().isFullscreen();
    }

    @Override
    public void toggleFullscreen() {
        mc().getWindow().toggleFullScreen();
        mc().options.fullscreen().set(mc().getWindow().isFullscreen());
    }

    @Override
    public void openVanillaTitle() {
        WestHud.config.data.customTitle = false;
        WestHud.save();
        mc().gui.setScreen(new net.minecraft.client.gui.screens.TitleScreen());
    }

    @Override
    public void openWestScreenPage(int page) {
        if (page < 0) return;
        mc().gui.setScreen(new WestHost(new dev.west.hud.screen.MenuScreen(page)));
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
