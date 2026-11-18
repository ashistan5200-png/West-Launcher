package dev.west.companion.v121.mixin;

import dev.west.hud.WestHud;
import dev.west.hud.share.PlayerIdentity;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.players.NameAndId;
import net.minecraft.server.players.PlayerList;
import net.minecraft.world.level.storage.LevelResource;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

import java.util.Optional;

/** Paylaşılan dünyada arkadaşın kimliği (çevrimdışı ↔ Microsoft) değişse de verisi korunsun */
@Mixin(PlayerList.class)
abstract class PlayerIdentityMixin {
    @Inject(method = "loadPlayerData", at = @At("HEAD"), require = 0)
    private void west$identity(NameAndId id, CallbackInfoReturnable<Optional<CompoundTag>> cir) {
        MinecraftServer srv = ((PlayerList) (Object) this).getServer();
        if (srv == null || !srv.isSingleplayer() || srv.isSingleplayerOwner(id)) return;
        WestHud.safe("player-identity", () -> PlayerIdentity.beforeLoad(srv.getWorldPath(LevelResource.ROOT), srv.getWorldPath(LevelResource.PLAYER_DATA_DIR),
                srv.getWorldPath(LevelResource.PLAYER_ADVANCEMENTS_DIR), srv.getWorldPath(LevelResource.PLAYER_STATS_DIR),
                srv.getServerDirectory().resolve("usercache.json"), id.name(), id.id()));
    }
}
