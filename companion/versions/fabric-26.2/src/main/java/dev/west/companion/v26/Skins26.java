package dev.west.companion.v26;

import com.mojang.authlib.GameProfile;
import dev.west.hud.lobby.LobbyFrame;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.PlayerSkin;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Lobideki karakterlerin gerçek skinleri. Arkadaşların profili (skin dokuları) Mojang'dan arka planda
 * alınır, ardından oyunun skin yöneticisi dokuyu indirir; o arada varsayılan skin görünür.
 */
final class Skins26 {
    private static final Map<String, Supplier<PlayerSkin>> CACHE = new ConcurrentHashMap<>();
    private static final Map<String, Boolean> FETCHING = new ConcurrentHashMap<>();

    private Skins26() {}

    static PlayerSkin skin(LobbyFrame.Avatar a) {
        Minecraft mc = Minecraft.getInstance();
        String key = a.self ? "self" : a.uuid != null ? a.uuid.toString() : "name:" + a.name;
        Supplier<PlayerSkin> s = CACHE.get(key);
        if (s != null) return s.get();
        if (a.self) {
            s = mc.getSkinManager().createLookup(mc.getGameProfile(), false);
            CACHE.put(key, s);
            return s.get();
        }
        UUID id = a.uuid != null ? a.uuid : UUID.nameUUIDFromBytes(("OfflinePlayer:" + a.name).getBytes());
        GameProfile bare = new GameProfile(id, a.name == null ? "" : a.name);
        if (a.uuid != null && FETCHING.putIfAbsent(key, true) == null) {
            CompletableFuture.supplyAsync(() -> mc.services().sessionService().fetchProfile(id, false)).thenAccept(r -> {
                if (r != null && r.profile() != null) mc.execute(() -> CACHE.put(key, mc.getSkinManager().createLookup(r.profile(), false)));
            });
        }
        return mc.getSkinManager().createLookup(bare, false).get();
    }
}
