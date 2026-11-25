package dev.west.companion.v26;

import dev.west.hud.Tr;
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
public final class Game26 implements Game {
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
        refreshWorlds();
        switch (t) {
            case SINGLEPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.worldselection.SelectWorldScreen(parent));
            case MULTIPLAYER -> m.gui.setScreen(new net.minecraft.client.gui.screens.multiplayer.JoinMultiplayerScreen(parent));
            case OPTIONS -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.OptionsScreen(parent, m.options, m.level != null));
            case LANGUAGE -> m.gui.setScreen(new net.minecraft.client.gui.screens.options.LanguageSelectScreen(parent, m.options, m.getLanguageManager()));
            case QUIT -> m.stop();
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
    public static void onChat(net.minecraft.network.chat.Component msg) {
        // Metin + bileşen ağacı (gizli adres "kopyalamak için tıkla" olayının içindedir)
        String s = msg.getString() + " " + msg;
        if (s.contains("e4mc_minecraft.domainAssigned") || s.contains("e4mc.link")) dev.west.hud.WestHud.LOG.info("e4mc: {}", msg.getString());
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
    public int publishWorld(int mode, boolean cheats, boolean offline) {
        var srv = mc().getSingleplayerServer();
        if (srv == null) return -1;
        if (srv.isPublished()) return srv.getPort();
        tunnel = null;
        tunnelFailed = false;
        // Varsayılan: yalnızca Microsoft hesapları (oturum doğrulanır). İstenirse offline hesaplar da girebilir.
        srv.setUsesAuthentication(!offline);
        int port = net.minecraft.util.HttpUtil.getAvailablePort();
        boolean ok = srv.publishServer(net.minecraft.server.MinecraftServer.MultiplayerScope.LAN, net.minecraft.world.level.GameType.byId(mode), cheats, port);
        if (ok && System.getProperty("west.debugTunnel") != null) debugTunnel(System.getProperty("west.debugTunnel"));
        return ok ? port : -1;
    }

    /** Yalnızca test: e4mc'nin adres mesajının birebir aynısını sohbete yazar (gizli adres + kopyalama tıklaması) */
    private void debugTunnel(String domain) {
        new Thread(() -> {
            try { Thread.sleep(2000); } catch (InterruptedException ignored) {}
            mc().execute(() -> {
                var hidden = net.minecraft.network.chat.Component.translatable("text.e4mc_minecraft.hiddenDomain")
                        .withStyle(st -> st.withClickEvent(new net.minecraft.network.chat.ClickEvent.CopyToClipboard(domain)));
                var m = net.minecraft.network.chat.Component.translatable("text.e4mc_minecraft.domainAssigned", hidden)
                        .append(net.minecraft.network.chat.Component.translatable("text.e4mc_minecraft.clickToStop"));
                mc().gui.hud.getChat().addClientSystemMessage(m);
            });
        }, "west-debug-tunnel").start();
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

    // ───── Lobi ─────
    private static final net.minecraft.client.multiplayer.ServerStatusPinger PINGER = new net.minecraft.client.multiplayer.ServerStatusPinger();
    private static final java.util.Map<String, ServerData> PINGS = new java.util.HashMap<>();
    private static final java.util.Map<String, Long> PINGED_AT = new java.util.HashMap<>();

    /** İstemci tick'inde: açık ping bağlantılarını ilerlet */
    private static final java.util.concurrent.ExecutorService PING_POOL = java.util.concurrent.Executors.newFixedThreadPool(2, r -> {
        Thread t = new Thread(r, "West Server Pinger");
        t.setDaemon(true);
        t.setContextClassLoader(Minecraft.class.getClassLoader());
        return t;
    });

    static void tickPinger() {
        PINGER.tick();
    }

    @Override
    public ServerStatus serverStatus(String address) {
        if (address == null || address.isBlank()) return null;
        long now = System.currentTimeMillis();
        ServerData d = PINGS.get(address);
        Long at = PINGED_AT.get(address);
        if (d == null || at == null || now - at > 30_000) {
            ServerData nd = new ServerData(address, address, ServerData.Type.OTHER);
            nd.setState(ServerData.State.PINGING);
            PINGS.put(address, d == null ? nd : d);
            PINGED_AT.put(address, now);
            ServerData target = d == null ? nd : d;
            target.setState(ServerData.State.PINGING);
            // Minecraft'ın kendi ping havuzu gibi, oyunun sınıf yükleyicisine sahip ayrı bir iş parçacığında.
            // (Java'nın ortak havuzunda ağ katmanı ilk kez başlatılırsa başlatma bozulur ve oturum boyunca
            // hiçbir sunucuya ping atılamaz/bağlanılamaz.)
            PING_POOL.execute(() -> {
                try {
                    PINGER.pingServer(target, () -> {}, () -> {}, net.minecraft.server.network.EventLoopGroupHolder.remote(mc().options.useNativeTransport()));
                } catch (Throwable e) {
                    target.setState(ServerData.State.UNREACHABLE);
                    WestHud.LOG.debug("Sunucu durumu alınamadı ({}): {}", target.ip, e.toString());
                }
            });
            if (d == null) return new ServerStatus(0, 0, 0, -1);
        }
        // Pinger yanıt gelince yalnızca verileri doldurur; durumu (vanilla listesi gibi) sürüme göre biz belirleriz
        if (d.state() == ServerData.State.PINGING && d.players != null)
            d.setState(d.protocol == net.minecraft.SharedConstants.getCurrentVersion().protocolVersion() ? ServerData.State.SUCCESSFUL : ServerData.State.INCOMPATIBLE);
        return switch (d.state()) {
            case SUCCESSFUL -> new ServerStatus(1, d.players == null ? 0 : d.players.online(), d.players == null ? 0 : d.players.max(), d.ping);
            case UNREACHABLE -> new ServerStatus(2, 0, 0, -1);
            case INCOMPATIBLE -> new ServerStatus(3, d.players == null ? 0 : d.players.online(), d.players == null ? 0 : d.players.max(), d.ping);
            default -> new ServerStatus(0, 0, 0, -1);
        };
    }

    @Override
    public void playSound(String id, float volume, float pitch) {
        var ev = net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.getOptional(net.minecraft.resources.Identifier.parse(id));
        ev.ifPresent(s -> mc().getSoundManager().play(net.minecraft.client.resources.sounds.SimpleSoundInstance.forUI(s, pitch, volume)));
    }

    @Override
    public java.util.UUID playerUuid() {
        return mc().getUser().getProfileId();
    }

    @Override
    public boolean onlineAccount() {
        var u = mc().getUser();
        return u.getXuid().isPresent() || (u.getAccessToken() != null && u.getAccessToken().chars().filter(c -> c == '.').count() == 2);
    }

    @Override
    public boolean mojangJoin(String serverId) {
        try {
            var u = mc().getUser();
            mc().services().sessionService().joinServer(u.getProfileId(), u.getAccessToken(), serverId);
            return true;
        } catch (Exception e) {
            WestHud.LOG.warn("Mojang oturum doğrulaması başarısız: {}", e.toString());
            return false;
        }
    }

    // ───── Paylaşılan dünyadaki oyuncular ve OP ─────
    private static int opTick;

    /** Dünya sahibinin bu dünyada OP verdiği arkadaşlar yeniden girince OP'leri geri verilir */
    static void restoreOps() {
        if (++opTick % 40 != 0) return;
        var srv = Minecraft.getInstance().getSingleplayerServer();
        if (srv == null || !srv.isPublished()) return;
        var world = srv.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT);
        srv.execute(() -> {
            var list = srv.getPlayerList();
            for (var p : list.getPlayers()) {
                var id = p.nameAndId();
                if (srv.isSingleplayerOwner(id) || list.isOp(id)) continue;
                if (dev.west.hud.share.PlayerIdentity.isSavedOp(world, id.name())) list.op(id);
            }
        });
    }

    @Override
    public List<SharedPlayer> sharedPlayers() {
        var srv = mc().getSingleplayerServer();
        if (srv == null) return List.of();
        List<SharedPlayer> out = new ArrayList<>();
        try {
            var list = srv.getPlayerList();
            for (var p : new ArrayList<>(list.getPlayers())) {
                var id = p.nameAndId();
                if (srv.isSingleplayerOwner(id)) continue;
                out.add(new SharedPlayer(id.name(), id.id().toString(), list.isOp(id)));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    @Override
    public void setOp(String uuid, boolean op) {
        var srv = mc().getSingleplayerServer();
        if (srv == null) return;
        srv.execute(() -> {
            var list = srv.getPlayerList();
            for (var p : list.getPlayers()) {
                var id = p.nameAndId();
                if (!id.id().toString().equals(uuid) || srv.isSingleplayerOwner(id)) continue;
                if (op) list.op(id);
                else list.deop(id);
                dev.west.hud.share.PlayerIdentity.setSavedOp(srv.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT), id.name(), op);
                p.sendSystemMessage(net.minecraft.network.chat.Component.literal(op ? Tr.t("Dünya sahibi sana OP verdi") : Tr.t("Dünya sahibi OP yetkini aldı")));
            }
        });
    }

    @Override
    public float masterVolume() {
        return mc().options.getSoundSourceVolume(net.minecraft.sounds.SoundSource.MASTER);
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
        String mode = m.gameMode == null ? "" : Tr.t(MODE_NAMES[Math.max(0, Math.min(3, m.gameMode.getPlayerMode().getId()))]);
        if (sp) {
            var srv = m.getSingleplayerServer();
            String diff = m.level == null ? "" : m.level.getDifficulty().getDisplayName().getString();
            return new Session(true, srv.getWorldData().getLevelName(), mode + (diff.isEmpty() ? "" : " · " + diff), !srv.isPublished());
        }
        ServerData d = m.getCurrentServer();
        return new Session(false, d == null ? Tr.t("Sunucu") : d.name, d == null ? mode : d.ip, false);
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

    @Override
    public Object screenObject() {
        return mc().gui.screen();
    }

    @Override
    public void setScreenObject(Object screen) {
        if (screen instanceof net.minecraft.client.gui.screens.Screen) mc().gui.setScreen((net.minecraft.client.gui.screens.Screen) screen);
    }

    // ───── Oyun içi mod merkezi ─────
    @Override public String worldFolder() { return LiveContent.worldFolder(); }
    @Override public String serverAddress() { return LiveContent.serverAddress(); }
    @Override public void stopGame() { LiveContent.stop(); }
    @Override public void applyResourcePacks(List<String> enable, List<String> disable, Runnable then) { LiveContent.applyResourcePacks(enable, disable, then); }
    @Override public java.util.Set<String> activeResourcePacks() { return LiveContent.activeResourcePacks(); }
    @Override public boolean shadersSupported() { return LiveContent.shadersSupported(); }
    @Override public String activeShader() { return LiveContent.activeShader(); }
    @Override public boolean applyShader(String file) { return LiveContent.applyShader(file); }
    @Override public void enableDatapack(String file) { LiveContent.enableDatapack(file); }
    @Override public java.util.Set<String> loadedMods() { return LiveContent.loadedMods(); }
    @Override public void openUrl(String url) { LiveContent.openUrl(url); }

    @Override
    public void openModHub() {
        var back = mc().gui.screen();
        dev.west.hud.screen.WestScreen inner = back instanceof WestHost h ? h.inner() : null;
        hubReturn = back instanceof WestHost ? null : back;
        mc().gui.setScreen(new WestHost(new dev.west.hud.screen.ModHubScreen(inner)));
    }

    private net.minecraft.client.gui.screens.Screen hubReturn;

    @Override
    public void closeModHub() {
        var r = hubReturn;
        hubReturn = null;
        mc().gui.setScreen(r);
    }

    @Override
    public boolean modLoaded(String id) {
        return net.fabricmc.loader.api.FabricLoader.getInstance().isModLoaded(id);
    }
}
