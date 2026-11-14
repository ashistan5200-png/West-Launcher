package dev.west.companion.pvp;

import dev.west.companion.SafeHook;
import dev.west.companion.West;
import dev.west.companion.mixin.MobAccessor;
import net.minecraft.client.Minecraft;
import net.minecraft.client.server.IntegratedServer;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.Registries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.Tag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitlesAnimationPacket;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.Difficulty;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.monster.Vindicator;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.AxeItem;
import net.minecraft.world.level.GameType;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.entity.EntityTypeTest;
import net.minecraft.world.level.storage.LevelResource;
import net.minecraft.world.phys.Vec3;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Queue;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Ashi ile 1v1 — yalnızca tek oyunculu dünyada, yerleşik sunucuda çalışır.
 *
 * Güvenlik: oyuncunun envanteri, canı, efektleri, konumu, oyun modu ve dünya
 * zorluğu düello başlamadan hem bellekte hem dünya klasöründe bir dosyada
 * saklanır. Düello biter, iptal edilir, dünya kapanır ya da oyun çökerse
 * (sonraki girişte) her şey geri yüklenir. Kimse ölmez: son vuruşta raund biter.
 */
public final class Duel {
    public enum Phase { COUNTDOWN, FIGHT, ROUND_END }

    /** İstemcinin (HUD/koç) okuduğu anlık görüntü. null = düello yok. */
    public record State(Phase phase, int round, int bestOf, int you, int ashi, int countdown, float botHealth, Kit kit, BotSkill skill, UUID bot) {}

    public static volatile State state;
    static final Queue<CoachEvent> EVENTS = new ConcurrentLinkedQueue<>();

    static final String BOT_TAG = "west_ashi_bot";
    private static final String BACKUP = "west-duel-backup.dat";
    private static final ResourceLocation FREEZE = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "duel_freeze");
    /** Arena iç yarıçapı (blok) */
    private static final int R = 11;
    private static final int WALL = 5;

    private static Duel active; // yalnızca sunucu iş parçacığı
    private static int strayCheck;

    private final MinecraftServer server;
    private final UUID playerId;
    private final Kit kit;
    private final BotSkill skill;
    private final int bestOf;
    private ServerLevel level;
    private BlockPos center;
    private Vindicator bot;
    private AshiBot brain;
    private CompoundTag backup;
    private Phase phase = Phase.COUNTDOWN;
    private int ticks, round = 1, you, ashi;

    private Duel(MinecraftServer server, UUID playerId, Kit kit, BotSkill skill, int bestOf) {
        this.server = server;
        this.playerId = playerId;
        this.kit = kit;
        this.skill = skill;
        this.bestOf = bestOf;
    }

    static void notify(CoachEvent e) {
        EVENTS.add(e);
    }

    // ───────── İstemciden çağrılanlar ─────────

    public static boolean available() {
        Minecraft mc = Minecraft.getInstance();
        return mc.hasSingleplayerServer() && mc.player != null && mc.getSingleplayerServer() != null && !mc.getSingleplayerServer().isPublished();
    }

    public static void request(Kit kit, BotSkill skill, int bestOf) {
        Minecraft mc = Minecraft.getInstance();
        IntegratedServer s = mc.getSingleplayerServer();
        if (s == null || mc.player == null) return;
        UUID id = mc.player.getUUID();
        s.execute(() -> start(s, id, kit, skill, bestOf));
    }

    public static void requestStop() {
        IntegratedServer s = Minecraft.getInstance().getSingleplayerServer();
        if (s != null) s.execute(() -> {
            if (active != null) active.finish(null);
        });
    }

    // ───────── Sunucu tarafı ─────────

    private static void start(MinecraftServer server, UUID id, Kit kit, BotSkill skill, int bestOf) {
        if (active != null) active.finish(null);
        ServerPlayer p = server.getPlayerList().getPlayer(id);
        if (p == null) return;
        if (p.isDeadOrDying() || p.isSleeping() || p.isPassenger()) {
            notify(new CoachEvent.Failed("west_companion.pvp.error.busy"));
            return;
        }
        Duel d = new Duel(server, id, kit, skill, bestOf);
        try {
            d.begin(p);
            active = d;
            notify(new CoachEvent.Started(kit, skill, bestOf));
        } catch (Throwable t) {
            West.LOG.error("Ashi 1v1 başlatılamadı", t);
            d.cleanup(p);
            notify(new CoachEvent.Failed("west_companion.pvp.error.start"));
        }
    }

    private void begin(ServerPlayer p) throws Exception {
        level = server.overworld();
        double x = p.level() == level ? p.getX() : level.getSharedSpawnPos().getX();
        double z = p.level() == level ? p.getZ() : level.getSharedSpawnPos().getZ();
        center = new BlockPos((int) Math.floor(x), level.getMaxBuildHeight() - 14, (int) Math.floor(z));

        backup = snapshot(p);
        NbtIo.writeCompressed(backup, backupPath(server));

        buildArena();
        if (server.getWorldData().getDifficulty() != Difficulty.NORMAL) server.setDifficulty(Difficulty.NORMAL, true);
        p.setGameMode(GameType.SURVIVAL);
        spawnBot();
        startRound(p);
    }

    private CompoundTag snapshot(ServerPlayer p) {
        CompoundTag t = new CompoundTag();
        t.putUUID("Player", p.getUUID());
        t.put("Inventory", p.getInventory().save(new ListTag()));
        t.putFloat("Health", p.getHealth());
        CompoundTag food = new CompoundTag();
        p.getFoodData().addAdditionalSaveData(food);
        t.put("Food", food);
        ListTag effects = new ListTag();
        for (MobEffectInstance e : p.getActiveEffects()) effects.add(e.save());
        t.put("Effects", effects);
        t.putString("Dim", p.level().dimension().location().toString());
        t.putDouble("X", p.getX());
        t.putDouble("Y", p.getY());
        t.putDouble("Z", p.getZ());
        t.putFloat("Yaw", p.getYRot());
        t.putFloat("Pitch", p.getXRot());
        t.putInt("Mode", p.gameMode.getGameModeForPlayer().getId());
        t.putInt("Difficulty", server.getWorldData().getDifficulty().getId());
        t.putInt("AX", center.getX());
        t.putInt("AY", center.getY());
        t.putInt("AZ", center.getZ());
        return t;
    }

    private static Path backupPath(MinecraftServer server) {
        return server.getWorldPath(LevelResource.ROOT).resolve(BACKUP);
    }

    private static boolean ring(int dx, int dz) {
        return Math.abs(dx) == R + 1 || Math.abs(dz) == R + 1;
    }

    private void buildArena() {
        BlockState floor = Blocks.SMOOTH_STONE.defaultBlockState();
        BlockState edge = Blocks.POLISHED_DEEPSLATE.defaultBlockState();
        BlockState line = Blocks.WHITE_CONCRETE.defaultBlockState();
        BlockState wall = Blocks.BARRIER.defaultBlockState();
        for (int dx = -R - 1; dx <= R + 1; dx++) {
            for (int dz = -R - 1; dz <= R + 1; dz++) {
                BlockPos f = center.offset(dx, 0, dz);
                level.setBlock(f, ring(dx, dz) ? edge : dx == 0 ? line : floor, Block.UPDATE_CLIENTS);
                for (int y = 1; y <= WALL; y++) {
                    level.setBlock(f.above(y), ring(dx, dz) ? wall : Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
                }
            }
        }
    }

    private static void clearArena(ServerLevel level, BlockPos c) {
        for (int dx = -R - 1; dx <= R + 1; dx++) {
            for (int dz = -R - 1; dz <= R + 1; dz++) {
                for (int y = 0; y <= WALL; y++) {
                    BlockPos pos = c.offset(dx, y, dz);
                    BlockState s = level.getBlockState(pos);
                    if (s.is(Blocks.SMOOTH_STONE) || s.is(Blocks.POLISHED_DEEPSLATE) || s.is(Blocks.WHITE_CONCRETE) || s.is(Blocks.BARRIER)) {
                        level.setBlock(pos, Blocks.AIR.defaultBlockState(), Block.UPDATE_CLIENTS);
                    }
                }
            }
        }
    }

    private void spawnBot() {
        bot = EntityType.VINDICATOR.create(level);
        if (bot == null) throw new IllegalStateException("bot");
        bot.moveTo(center.getX() + 6.5, center.getY() + 1, center.getZ() + 0.5, 90f, 0f);
        bot.addTag(BOT_TAG);
        bot.setPersistenceRequired();
        bot.setCanPickUpLoot(false);
        bot.setCanJoinRaid(false);
        bot.setLeftHanded(false);
        bot.setSilent(true);
        bot.setCustomNameVisible(true);
        setBase(Attributes.MAX_HEALTH, 20);
        setBase(Attributes.ATTACK_DAMAGE, 1);
        setBase(Attributes.ARMOR, 0);
        setBase(Attributes.KNOCKBACK_RESISTANCE, 0);
        setBase(Attributes.FOLLOW_RANGE, 64);
        // MoveControl.strafe hızı 0.25 ile çarpar → oyuncu yürüme hızı 0.1 için 0.4
        setBase(Attributes.MOVEMENT_SPEED, 0.4 * skill.speed);
        try {
            ((MobAccessor) bot).west$goals().removeAllGoals(g -> true);
            ((MobAccessor) bot).west$targets().removeAllGoals(g -> true);
        } catch (Throwable t) {
            West.LOG.warn("Ashi: vanilla yapay zekâ kapatılamadı", t);
        }
        level.addFreshEntity(bot);
        brain = new AshiBot(bot, kit, skill);
    }

    private void setBase(net.minecraft.core.Holder<net.minecraft.world.entity.ai.attributes.Attribute> a, double v) {
        AttributeInstance i = bot.getAttribute(a);
        if (i != null) i.setBaseValue(v);
    }

    private static void freeze(LivingEntity e, boolean on) {
        for (var a : java.util.List.of(Attributes.MOVEMENT_SPEED, Attributes.JUMP_STRENGTH)) {
            AttributeInstance i = e.getAttribute(a);
            if (i == null) continue;
            i.removeModifier(FREEZE);
            if (on) i.addTransientModifier(new AttributeModifier(FREEZE, -1.0, AttributeModifier.Operation.ADD_MULTIPLIED_TOTAL));
        }
    }

    private void startRound(ServerPlayer p) {
        kit.giveTo(p);
        p.setHealth(p.getMaxHealth());
        p.getFoodData().setFoodLevel(20);
        p.getFoodData().setSaturation(5f);
        p.clearFire();
        p.fallDistance = 0;
        p.teleportTo(level, center.getX() - 5.5, center.getY() + 1, center.getZ() + 0.5, -90f, 0f);
        p.setDeltaMovement(Vec3.ZERO);
        p.inventoryMenu.broadcastChanges();
        freeze(p, true);

        kit.giveTo(bot);
        bot.setHealth(bot.getMaxHealth());
        bot.teleportTo(center.getX() + 6.5, center.getY() + 1, center.getZ() + 0.5);
        bot.setYRot(90f);
        bot.setDeltaMovement(Vec3.ZERO);
        brain.resetRound();
        brain.idle();

        phase = Phase.COUNTDOWN;
        ticks = 0;
        title(p, Component.translatable("west_companion.pvp.round", round, bestOf), score(), 5, 30, 5);
    }

    private Component score() {
        return Component.translatable("west_companion.pvp.score", you, ashi);
    }

    private static void title(ServerPlayer p, Component title, Component sub, int in, int stay, int out) {
        p.connection.send(new ClientboundSetTitlesAnimationPacket(in, stay, out));
        p.connection.send(new ClientboundSetSubtitleTextPacket(sub));
        p.connection.send(new ClientboundSetTitleTextPacket(title));
    }

    private void tick() {
        ServerPlayer p = server.getPlayerList().getPlayer(playerId);
        if (p == null || p.level() != level || bot == null || bot.isRemoved() || p.distanceToSqr(Vec3.atCenterOf(center)) > 40 * 40) {
            finish(null);
            return;
        }
        ticks++;
        switch (phase) {
            case COUNTDOWN -> {
                if (ticks % 20 == 0 && ticks <= 80) {
                    int n = 4 - ticks / 20;
                    if (n > 0) {
                        title(p, Component.literal(String.valueOf(n)), Component.empty(), 0, 18, 2);
                        level.playSound(null, p.getX(), p.getY(), p.getZ(), SoundEvents.NOTE_BLOCK_HAT.value(), SoundSource.MASTER, 1f, 1f);
                    } else {
                        title(p, Component.translatable("west_companion.pvp.fight"), Component.empty(), 0, 14, 6);
                        level.playSound(null, p.getX(), p.getY(), p.getZ(), SoundEvents.NOTE_BLOCK_PLING.value(), SoundSource.MASTER, 1f, 1.4f);
                        freeze(p, false);
                        phase = Phase.FIGHT;
                        ticks = 0;
                    }
                }
            }
            case FIGHT -> brain.tick(p);
            case ROUND_END -> {
                if (ticks == 50) {
                    int need = bestOf / 2 + 1;
                    if (you >= need || ashi >= need) finish(you > ashi);
                    else {
                        round++;
                        startRound(p);
                    }
                }
            }
        }
        if (active != this) return; // maç bu tick'te bitti
        if (bot != null && !bot.isRemoved()) {
            bot.setCustomName(Component.literal("Ashi ").append(Component.literal(String.format("❤ %.1f", bot.getHealth() / 2f)).withColor(0xE07A7A)));
        }
        publish();
    }

    private void publish() {
        int countdown = phase == Phase.COUNTDOWN ? Math.max(0, 4 - ticks / 20) : 0;
        state = new State(phase, round, bestOf, you, ashi, countdown, bot == null ? 0 : bot.getHealth(), kit, skill, bot == null ? null : bot.getUUID());
    }

    private void roundOver(boolean playerWon) {
        if (phase != Phase.FIGHT) return;
        if (playerWon) you++;
        else ashi++;
        phase = Phase.ROUND_END;
        ticks = 0;
        brain.idle();
        ServerPlayer p = server.getPlayerList().getPlayer(playerId);
        if (p != null) {
            freeze(p, true);
            title(p, Component.translatable(playerWon ? "west_companion.pvp.round_won" : "west_companion.pvp.round_lost"), score(), 4, 36, 8);
            level.playSound(null, p.getX(), p.getY(), p.getZ(), playerWon ? SoundEvents.PLAYER_LEVELUP : SoundEvents.VILLAGER_NO, SoundSource.MASTER, 0.8f, 1f);
        }
        notify(new CoachEvent.RoundEnd(playerWon, you, ashi, round));
        publish();
    }

    /** @param playerWon null = iptal */
    private void finish(Boolean playerWon) {
        ServerPlayer p = server.getPlayerList().getPlayer(playerId);
        AshiBot b = brain;
        cleanup(p);
        notify(new CoachEvent.MatchEnd(playerWon, you, ashi, kit, skill, bestOf,
                b == null ? 0 : b.hits, b == null ? 0 : b.crits, b == null ? 0 : b.sprintHits, b == null ? 0 : b.healsUsed));
    }

    /** Botu kaldırır, arenayı siler, oyuncuyu ve dünya zorluğunu eski haline getirir. */
    private void cleanup(ServerPlayer p) {
        if (bot != null) bot.discard();
        if (level != null && center != null) clearArena(level, center);
        if (p != null && backup != null) restore(server, p, backup);
        try {
            Files.deleteIfExists(backupPath(server));
        } catch (Exception e) {
            West.LOG.warn("Düello yedeği silinemedi", e);
        }
        active = null;
        state = null;
    }

    private static void restore(MinecraftServer server, ServerPlayer p, CompoundTag t) {
        freeze(p, false);
        p.getInventory().load(t.getList("Inventory", Tag.TAG_COMPOUND));
        p.removeAllEffects();
        for (Tag e : t.getList("Effects", Tag.TAG_COMPOUND)) {
            MobEffectInstance m = MobEffectInstance.load((CompoundTag) e);
            if (m != null) p.addEffect(m);
        }
        p.getFoodData().readAdditionalSaveData(t.getCompound("Food"));
        p.setHealth(Math.max(1f, t.getFloat("Health")));
        p.clearFire();
        p.fallDistance = 0;
        p.setGameMode(GameType.byId(t.getInt("Mode")));
        server.setDifficulty(Difficulty.byId(t.getInt("Difficulty")), true);
        ServerLevel dim = server.getLevel(ResourceKey.create(Registries.DIMENSION, ResourceLocation.parse(t.getString("Dim"))));
        if (dim == null) dim = server.overworld();
        p.teleportTo(dim, t.getDouble("X"), t.getDouble("Y"), t.getDouble("Z"), t.getFloat("Yaw"), t.getFloat("Pitch"));
        p.setDeltaMovement(Vec3.ZERO);
        p.inventoryMenu.broadcastChanges();
        p.containerMenu.broadcastChanges();
    }

    // ───────── Loader olayları (West üzerinden) ─────────

    public static void onServerTick(MinecraftServer server) {
        SafeHook.run("duel", () -> {
            if (active != null) {
                if (active.server != server) return;
                active.tick();
            } else if (++strayCheck % 200 == 0) {
                // Çökme sonrası kalmış bir Ashi varsa temizle
                for (Vindicator v : server.overworld().getEntities(EntityTypeTest.forClass(Vindicator.class), e -> e.getTags().contains(BOT_TAG))) v.discard();
            }
        });
        if (!SafeHook.enabled("duel") && active != null) {
            Duel d = active;
            active = null;
            state = null;
            try {
                d.cleanup(server.getPlayerList().getPlayer(d.playerId));
            } catch (Throwable ignored) {
            }
        }
    }

    public static void onServerStopping(MinecraftServer server) {
        if (active != null && active.server == server) {
            try {
                active.finish(null);
            } catch (Throwable t) {
                West.LOG.error("Düello kapanışta temizlenemedi; dosya yedeği bir sonraki girişte uygulanacak", t);
            }
        }
        active = null;
        state = null;
    }

    /** Önceki oturum çökmüşse oyuncunun eşyaları dosya yedeğinden geri yüklenir. */
    public static void onPlayerJoin(ServerPlayer p) {
        SafeHook.run("duel-recover", () -> {
            try {
                recover(p);
            } catch (java.io.IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        });
    }

    private static void recover(ServerPlayer p) throws java.io.IOException {
        {
            MinecraftServer server = p.getServer();
            if (server == null || active != null) return;
            Path f = backupPath(server);
            if (!Files.exists(f)) return;
            CompoundTag t = NbtIo.readCompressed(f, NbtAccounter.unlimitedHeap());
            if (!t.hasUUID("Player") || !t.getUUID("Player").equals(p.getUUID())) return;
            clearArena(server.overworld(), new BlockPos(t.getInt("AX"), t.getInt("AY"), t.getInt("AZ")));
            restore(server, p, t);
            Files.deleteIfExists(f);
            p.sendSystemMessage(Component.translatable("west_companion.pvp.recovered"));
        }
    }

    /** false dönerse ölüm iptal edilir (raund biter, kimse gerçekten ölmez). */
    public static boolean allowDeath(LivingEntity e) {
        Duel d = active;
        if (d == null) return true;
        boolean isBot = e == d.bot;
        boolean isPlayer = e instanceof Player && e.getUUID().equals(d.playerId);
        if (!isBot && !isPlayer) return true;
        e.setHealth(1f);
        e.clearFire();
        e.removeAllEffects();
        d.roundOver(isBot);
        return false;
    }

    /** LivingEntity.blockUsingShield kancası */
    public static void onShieldBlock(LivingEntity defender, LivingEntity attacker) {
        Duel d = active;
        if (d == null || defender.level().isClientSide) return;
        boolean axe = attacker.getMainHandItem().getItem() instanceof AxeItem;
        if (defender == d.bot && attacker.getUUID().equals(d.playerId)) {
            d.brain.onShieldHit(axe);
            notify(new CoachEvent.ShieldBlock(false, axe));
        } else if (attacker == d.bot && defender.getUUID().equals(d.playerId)) {
            notify(new CoachEvent.ShieldBlock(true, axe));
        }
    }
}
