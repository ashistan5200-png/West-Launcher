package dev.west.companion.v121;

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

/** 1.21.11 oyun bilgisi köprüsü. */
final class Game121 implements Game {
    private List<ModInfo> mods;

    private static Minecraft mc() {
        return Minecraft.getInstance();
    }

    @Override public boolean inWorld() { return mc().player != null && mc().level != null; }
    @Override public boolean hudHidden() { return mc().options.hideGui; }
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
        ItemStack s = Gfx121.stack(slot);
        if (s == null || s.isEmpty() || !s.isDamageableItem() || s.getMaxDamage() <= 0) return -1;
        return 1f - s.getDamageValue() / (float) s.getMaxDamage();
    }

    @Override
    public String minecraftVersion() {
        return FabricLoader.getInstance().getModContainer("minecraft").map(c -> c.getMetadata().getVersion().getFriendlyString()).orElse("1.21.11");
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
    public void closeScreen() {
        mc().setScreen(null);
    }

    @Override
    public void openWestScreen(boolean editor) {
        mc().setScreen(new WestHost(editor ? WestHud.editor(WestHud.menu()) : WestHud.menu()));
    }
}
