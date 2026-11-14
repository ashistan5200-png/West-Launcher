package dev.west.companion.pvp;

import dev.west.companion.West;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.Mth;
import net.minecraft.util.RandomSource;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.ai.attributes.AttributeInstance;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.monster.Vindicator;
import net.minecraft.world.entity.projectile.ThrownPotion;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;

/**
 * Ashi'nin dövüş beyni (sunucu iş parçacığı, her tick).
 * Vanilla yapay zekâ kapatılır; hareket, nişan, vuruş zamanlaması, w-tap,
 * kritik zıplama, kalkan ve iyileşme burada bir oyuncu gibi yönetilir.
 */
final class AshiBot {
    private static final ResourceLocation CRIT = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "bot_crit");
    private static final ResourceLocation SPRINT_KB = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "bot_sprint_kb");

    final Vindicator bot;
    private final Kit kit;
    private final BotSkill s;
    private final RandomSource rnd;

    private float aimYaw;
    private int cooldown, strafeDir = 1, strafeTimer, sprintTimer, stapTimer, decideTimer, inReach;
    private int heals, healCooldown, shieldDisabled, blockTicks;
    private boolean eating, blocking, plannedCrit;
    private ItemStack weapon = ItemStack.EMPTY;

    // Maç raporu için Ashi'nin kendi istatistikleri
    int hits, crits, sprintHits, healsUsed;

    AshiBot(Vindicator bot, Kit kit, BotSkill skill) {
        this.bot = bot;
        this.kit = kit;
        this.s = skill;
        this.rnd = bot.getRandom();
        this.aimYaw = bot.getYRot();
    }

    void resetRound() {
        cooldown = 10;
        sprintTimer = stapTimer = decideTimer = inReach = healCooldown = shieldDisabled = blockTicks = 0;
        eating = blocking = plannedCrit = false;
        heals = kit.heals;
        weapon = bot.getMainHandItem().copy();
        aimYaw = bot.getYRot();
        if (bot.isUsingItem()) bot.stopUsingItem();
    }

    /** Raund bitince: dur, elindekini bırak. */
    void idle() {
        if (bot.isUsingItem()) bot.stopUsingItem();
        bot.setSprinting(false);
        bot.getMoveControl().strafe(0, 0);
        blocking = eating = false;
    }

    void tick(ServerPlayer p) {
        if (bot.isRemoved()) return;
        bot.setRemainingFireTicks(0);
        Vec3 d = p.position().subtract(bot.position());
        double dist = Math.sqrt(d.x * d.x + d.z * d.z);

        // ── nişan: zorluk arttıkça daha hızlı ve isabetli döner
        float want = (float) (Mth.atan2(d.z, d.x) * Mth.RAD_TO_DEG) - 90f + (rnd.nextFloat() - 0.5f) * s.jitter;
        aimYaw = Mth.approachDegrees(aimYaw, want, s.turn);
        bot.setYRot(aimYaw);
        bot.setYHeadRot(aimYaw);
        bot.setYBodyRot(aimYaw);
        bot.getLookControl().setLookAt(p, 360f, 90f);

        if (cooldown > 0) cooldown--;
        if (healCooldown > 0) healCooldown--;
        if (shieldDisabled > 0) shieldDisabled--;

        // ── yemek yerken: geri çekil ve yana kaç
        if (eating) {
            if (bot.isUsingItem()) {
                bot.setSprinting(false);
                bot.getMoveControl().strafe(-0.8f, strafeDir * 0.7f);
                return;
            }
            eating = false;
            bot.setItemSlot(EquipmentSlot.MAINHAND, weapon.copy());
            cooldown = Math.max(cooldown, 6);
        }

        // ── iyileşme
        if (heals > 0 && healCooldown == 0 && !blocking && bot.getHealth() <= s.healAt) {
            if (kit.heal == Kit.Heal.GAPPLE && (dist > 3.3 || rnd.nextFloat() < 0.03f)) {
                startEating();
                return;
            }
            if (kit.heal == Kit.Heal.POT && (dist > 2.2 || rnd.nextFloat() < 0.15f)) throwPot();
        }

        // ── kalkan (balta + kalkan kiti)
        if (kit.shield) shieldLogic(p, dist);

        // ── hareket
        float fwd = dist > 3.0 ? 1f : dist < 1.7 ? (s.stap ? -0.6f : 0.2f) : 0.6f;
        if (stapTimer > 0) {
            stapTimer--;
            fwd = -1f;
        }
        if (blocking) fwd *= 0.3f;
        if (sprintTimer > 0) {
            sprintTimer--;
            bot.setSprinting(false);
        } else {
            bot.setSprinting(fwd > 0.5f && !blocking);
        }
        if (--strafeTimer <= 0 || bot.horizontalCollision) {
            strafeDir = rnd.nextFloat() < 0.7f ? -strafeDir : strafeDir;
            strafeTimer = 10 + rnd.nextInt(28);
        }
        float side = dist < 5.5 ? strafeDir * s.strafe : 0f;

        // ── kritik planı: vuruşa ~5 tick kala zıplayıp düşerken vur
        if (cooldown == 5) plannedCrit = rnd.nextFloat() < s.crit;
        if (plannedCrit && bot.onGround() && cooldown <= 5 && dist > 2.2 && dist < 3.9 && !blocking) bot.getJumpControl().jump();
        bot.getMoveControl().strafe(fwd, side);

        // ── vuruş: tepki süresi + menzil + görüş
        boolean inRange = dist <= s.reach && bot.hasLineOfSight(p);
        inReach = inRange ? inReach + 1 : 0;
        if (cooldown == 0 && !blocking && inRange && inReach > s.reaction) {
            boolean falling = !bot.onGround() && bot.getDeltaMovement().y < 0;
            boolean rising = !bot.onGround() && !falling;
            if (!(plannedCrit && rising)) attack(p, falling);
        }
    }

    private void attack(ServerPlayer p, boolean crit) {
        AttributeInstance dmg = bot.getAttribute(Attributes.ATTACK_DAMAGE);
        AttributeInstance kb = bot.getAttribute(Attributes.ATTACK_KNOCKBACK);
        boolean sprintHit = bot.isSprinting();
        if (crit && dmg != null) dmg.addTransientModifier(new AttributeModifier(CRIT, 0.5, AttributeModifier.Operation.ADD_MULTIPLIED_TOTAL));
        if (sprintHit && kb != null) kb.addTransientModifier(new AttributeModifier(SPRINT_KB, 1.0, AttributeModifier.Operation.ADD_VALUE));
        bot.swing(InteractionHand.MAIN_HAND);
        boolean hit = bot.doHurtTarget(p);
        if (dmg != null) dmg.removeModifier(CRIT);
        if (kb != null) kb.removeModifier(SPRINT_KB);

        ServerLevel level = (ServerLevel) bot.level();
        if (hit) {
            hits++;
            if (crit) {
                crits++;
                level.sendParticles(ParticleTypes.CRIT, p.getX(), p.getY(0.6), p.getZ(), 14, 0.3, 0.4, 0.3, 0.25);
                level.playSound(null, p.getX(), p.getY(), p.getZ(), SoundEvents.PLAYER_ATTACK_CRIT, SoundSource.HOSTILE, 1f, 1f);
            } else {
                level.playSound(null, p.getX(), p.getY(), p.getZ(), sprintHit ? SoundEvents.PLAYER_ATTACK_KNOCKBACK : SoundEvents.PLAYER_ATTACK_STRONG, SoundSource.HOSTILE, 1f, 1f);
            }
            if (sprintHit) sprintHits++;
        } else {
            level.playSound(null, p.getX(), p.getY(), p.getZ(), SoundEvents.PLAYER_ATTACK_NODAMAGE, SoundSource.HOSTILE, 1f, 1f);
        }
        // w-tap: koşu sıfırlanır; iyi oyuncu hemen, acemi geç yeniden koşar
        if (sprintHit) {
            bot.setSprinting(false);
            sprintTimer = rnd.nextFloat() < s.wtap ? s.wtapDelay : s.slowResprint;
        }
        if (s.stap && rnd.nextFloat() < 0.45f) stapTimer = 2;
        cooldown = kit.cooldown;
        plannedCrit = false;
    }

    private void startEating() {
        weapon = bot.getMainHandItem().copy();
        bot.setItemSlot(EquipmentSlot.MAINHAND, new ItemStack(Items.GOLDEN_APPLE));
        bot.startUsingItem(InteractionHand.MAIN_HAND);
        eating = true;
        heals--;
        healsUsed++;
        healCooldown = 60;
        Duel.notify(new CoachEvent.AshiHeal(kit.heal));
    }

    private void throwPot() {
        ThrownPotion pot = new ThrownPotion(bot.level(), bot);
        pot.setItem(Kit.healPotion());
        // ayağına at: neredeyse dik aşağı
        pot.shootFromRotation(bot, 88f, bot.getYRot(), -20f, 0.5f, 0f);
        bot.level().addFreshEntity(pot);
        bot.swing(InteractionHand.MAIN_HAND);
        heals--;
        healsUsed++;
        healCooldown = 28;
        Duel.notify(new CoachEvent.AshiHeal(kit.heal));
    }

    private void shieldLogic(ServerPlayer p, double dist) {
        if (shieldDisabled > 0) {
            if (blocking) stopBlock();
            return;
        }
        if (blocking) {
            blockTicks++;
            if ((cooldown == 0 && dist <= s.reach) || blockTicks > 30 || dist > 5) stopBlock();
        } else if (--decideTimer <= 0) {
            decideTimer = 4;
            if (dist < 3.8 && p.getAttackStrengthScale(0f) > 0.85f && cooldown > 3 && rnd.nextFloat() < s.block) {
                bot.startUsingItem(InteractionHand.OFF_HAND);
                blocking = true;
                blockTicks = 0;
            }
        }
    }

    private void stopBlock() {
        if (bot.isUsingItem()) bot.stopUsingItem();
        blocking = false;
    }

    /** Ashi'nin kalkanı bir vuruşu engelledi. Balta ise kalkan 5 sn devre dışı. */
    void onShieldHit(boolean axe) {
        if (!axe) return;
        stopBlock();
        shieldDisabled = 100;
        bot.level().playSound(null, bot.getX(), bot.getY(), bot.getZ(), SoundEvents.SHIELD_BREAK, SoundSource.HOSTILE, 0.8f, 0.8f + rnd.nextFloat() * 0.4f);
    }
}
