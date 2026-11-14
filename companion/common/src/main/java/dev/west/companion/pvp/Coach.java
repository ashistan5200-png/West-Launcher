package dev.west.companion.pvp;

import dev.west.companion.SafeHook;
import dev.west.companion.West;
import dev.west.companion.gui.DuelSummaryScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.FormattedCharSequence;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Items;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Ashi PvP Koçu (istemci). Vuruşlarını ve aldığın darbeleri izler, sol altta
 * Ashi'nin konuşma balonuyla kısa ipuçları verir ve maç sonunda rapor çıkarır.
 * Hiçbir şeyi senin yerine yapmaz ve sunucuya hiçbir şey göndermez.
 */
public final class Coach {
    static final ResourceLocation ASHI = ResourceLocation.fromNamespaceAndPath(West.MOD_ID, "textures/entity/ashi.png");

    /** Maç istatistikleri (raporda gösterilir) */
    public static final class Stats {
        public int clicks, hits, fullHits, spam, crits, sprintHits, landed, taken, comboBest, comboTakenBest;
        public int blockedBySword, shieldBreaks, playerBlocks, heals;
        public float cooldownSum, damageDealt, damageTaken;
        public double reachSum;
        int combo, comboTaken;
    }

    static Stats stats = new Stats();
    private static Component tip;
    private static long tipAt;
    private static final Map<String, Long> said = new HashMap<>();
    private static int prevHurt;
    private static float prevPlayerHp = -1, prevBotHp = -1;
    private static final List<Long> recentSpam = new ArrayList<>();
    private static int prevHealItems = -1;
    private static long lowHpSince;

    private Coach() {}

    private static boolean duelFight() {
        Duel.State s = Duel.state;
        return s != null && s.phase() == Duel.Phase.FIGHT;
    }

    private static boolean isBot(Entity e) {
        Duel.State s = Duel.state;
        return s != null && s.bot() != null && s.bot().equals(e.getUUID());
    }

    /** Koç bu hedefe karşı çalışsın mı? (Ashi ya da isteğe bağlı olarak sunucudaki oyuncular) */
    private static boolean coaching(Entity target) {
        return isBot(target) || (West.config.coachEverywhere && target instanceof Player && !Minecraft.getInstance().hasSingleplayerServer());
    }

    /** MultiPlayerGameMode.attack kancası: vuruştan HEMEN önce çağrılır. */
    public static void onAttack(Player p, Entity target) {
        SafeHook.run("coach", () -> {
            if (!coaching(target)) return;
            float cd = p.getAttackStrengthScale(0.5f);
            boolean full = cd > 0.9f;
            boolean crit = full && p.fallDistance > 0 && !p.onGround() && !p.onClimbable() && !p.isInWater() && !p.isPassenger() && !p.isSprinting();
            boolean sprint = full && p.isSprinting();
            Stats s = stats;
            s.hits++;
            s.cooldownSum += cd;
            s.reachSum += p.distanceTo(target);
            if (full) s.fullHits++;
            if (crit) s.crits++;
            if (sprint) s.sprintHits++;
            long now = System.currentTimeMillis();
            if (cd < 0.85f) {
                s.spam++;
                recentSpam.add(now);
                recentSpam.removeIf(t -> now - t > 8000);
                if (recentSpam.size() >= 3) say("spam", 9000);
            }
            boolean critKit = Duel.state == null || Duel.state.kit() != Kit.AXE_SHIELD;
            if (critKit && s.fullHits >= 8 && s.crits * 5 < s.fullHits) say("crit", 25000);
            if (s.fullHits >= 8 && s.sprintHits * 3 < s.fullHits) say("sprint", 30000);
        });
    }

    /** Minecraft.startAttack kancası: her sol tık (ıska dahil) — isabet oranı için. */
    public static void onSwing() {
        if (duelFight()) stats.clicks++;
    }

    public static void tick(Minecraft mc) {
        SafeHook.run("coach", () -> {
            CoachEvent e;
            while ((e = Duel.EVENTS.poll()) != null) handle(mc, e);

            Player p = mc.player;
            if (p == null) return;
            Duel.State st = Duel.state;
            boolean fight = duelFight();


            // alınan darbe ve kombo
            if (fight && p.hurtTime > prevHurt) {
                stats.taken++;
                stats.comboTaken++;
                stats.combo = 0;
                stats.comboTakenBest = Math.max(stats.comboTakenBest, stats.comboTaken);
                if (stats.comboTaken >= 3) say("combo_taken", 15000);
            }
            prevHurt = p.hurtTime;
            if (fight && prevPlayerHp >= 0 && p.getHealth() < prevPlayerHp) stats.damageTaken += prevPlayerHp - p.getHealth();
            prevPlayerHp = p.getHealth();

            // Ashi'ye isabet eden vuruşlar (canı azaldı)
            if (st != null) {
                if (fight && prevBotHp >= 0 && st.botHealth() < prevBotHp - 0.01f) {
                    stats.landed++;
                    stats.damageDealt += prevBotHp - st.botHealth();
                    stats.combo++;
                    stats.comboTaken = 0;
                    stats.comboBest = Math.max(stats.comboBest, stats.combo);
                    if (stats.combo == 3) say("combo_good", 12000);
                }
                prevBotHp = st.botHealth();
            } else {
                prevBotHp = -1;
            }

            // iyileşme eşyası kullanıldı mı + düşük can uyarısı
            if (fight && st != null && st.kit().heal != Kit.Heal.NONE) {
                int items = countHeal(p, st.kit());
                if (prevHealItems >= 0 && items < prevHealItems) stats.heals += prevHealItems - items;
                prevHealItems = items;
                if (p.getHealth() <= 8f && items > 0 && !p.isUsingItem()) {
                    if (lowHpSince == 0) lowHpSince = System.currentTimeMillis();
                    if (System.currentTimeMillis() - lowHpSince > 1200) say(st.kit() == Kit.GAPPLE ? "heal_gapple" : "heal_pot", 12000);
                } else lowHpSince = 0;
            }
        });
    }

    private static int countHeal(Player p, Kit kit) {
        var inv = p.getInventory();
        int n = 0;
        for (int i = 0; i < inv.getContainerSize(); i++) {
            var s = inv.getItem(i);
            if (kit == Kit.GAPPLE && s.is(Items.GOLDEN_APPLE)) n += s.getCount();
            if (kit == Kit.POT && s.is(Items.SPLASH_POTION)) n += s.getCount();
        }
        return n;
    }

    private static void handle(Minecraft mc, CoachEvent e) {
        switch (e) {
            case CoachEvent.Started s -> {
                stats = new Stats();
                said.clear();
                recentSpam.clear();
                prevHealItems = -1;
                prevPlayerHp = prevBotHp = -1;
                say("intro." + s.kit().id, 0);
            }
            case CoachEvent.AshiHeal h -> say(h.heal() == Kit.Heal.GAPPLE ? "ashi_gapple" : "ashi_pot", 8000);
            case CoachEvent.ShieldBlock b -> {
                if (b.playerShield()) {
                    stats.playerBlocks++;
                    if (stats.playerBlocks == 1) say("good_block", 0);
                } else if (b.axe()) {
                    stats.shieldBreaks++;
                    say("shield_broken", 6000);
                } else {
                    stats.blockedBySword++;
                    if (stats.blockedBySword >= 2) say("use_axe", 12000);
                }
            }
            case CoachEvent.RoundEnd r -> {
                stats.combo = stats.comboTaken = 0;
                if (!r.playerWon()) say(weakest(Duel.state == null ? null : Duel.state.kit()), 0);
            }
            case CoachEvent.MatchEnd m -> {
                tip = null;
                if (m.playerWon() == null) {
                    if (mc.player != null) mc.player.displayClientMessage(Component.translatable("west_companion.pvp.aborted"), false);
                } else {
                    mc.setScreen(new DuelSummaryScreen(m, stats, tips(m.kit())));
                }
            }
            case CoachEvent.Failed f -> {
                if (mc.player != null) mc.player.displayClientMessage(Component.translatable(f.reason()), false);
            }
        }
    }

    /** En zayıf yön → ipucu anahtarı */
    static String weakest(Kit kit) {
        List<String> t = tips(kit);
        return t.isEmpty() ? "keep_going" : t.get(0);
    }

    /** Maç raporundaki öneriler, önem sırasına göre. */
    public static List<String> tips(Kit kit) {
        Stats s = stats;
        List<String> out = new ArrayList<>();
        if (s.hits >= 4 && s.spam * 3 > s.hits) out.add("spam");
        if (s.comboTakenBest >= 3) out.add("combo_taken");
        if (kit != Kit.AXE_SHIELD && s.fullHits >= 5 && s.crits * 5 < s.fullHits) out.add("crit");
        if (s.fullHits >= 5 && s.sprintHits * 3 < s.fullHits) out.add("sprint");
        if (kit == Kit.AXE_SHIELD && s.blockedBySword >= 2) out.add("use_axe");
        if (kit != null && kit.heal != Kit.Heal.NONE && s.heals == 0 && s.damageTaken > 14) out.add(kit == Kit.GAPPLE ? "heal_gapple" : "heal_pot");
        if (s.clicks >= 10 && s.hits * 2 < s.clicks) out.add("aim");
        if (out.isEmpty()) out.add("keep_going");
        return out;
    }

    private static void say(String key, long cooldownMs) {
        if (!West.config.coachTips) return;
        long now = System.currentTimeMillis();
        Long last = said.get(key);
        if (last != null && now - last < cooldownMs) return;
        // balon başka bir ipucunu henüz gösteriyorsa (giriş metinleri hariç) acele etme
        if (tip != null && now - tipAt < 2500 && !key.startsWith("intro")) return;
        said.put(key, now);
        tip = Component.translatable("west_companion.coach." + key);
        tipAt = now;
    }

    // ───────── HUD ─────────

    public static void render(GuiGraphics g) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.options.hideGui || mc.player == null) return;
        SafeHook.run("coach-hud", () -> {
            Duel.State s = Duel.state;
            if (s != null) renderScore(g, mc.font, g.guiWidth(), s);
            renderTip(g, mc.font, West.config.fpsOverlay ? 24 : 6);
        });
    }

    private static void renderScore(GuiGraphics g, Font font, int w, Duel.State s) {
        String you = Component.translatable("west_companion.pvp.you").getString();
        String line = you + "  " + s.you() + "  –  " + s.ashi() + "  Ashi";
        Component sub = Component.translatable("west_companion.pvp.hud_sub", s.round(), s.bestOf(), Component.translatable(s.kit().key()), Component.translatable(s.skill().key()));
        int lw = Math.max(font.width(line), font.width(sub)) + 20;
        int x = w / 2 - lw / 2, y = 4;
        g.fill(x, y, x + lw, y + 26, 0xB0101113);
        g.fill(x, y + 25, x + lw, y + 26, 0xFF7FA7C9);
        g.drawCenteredString(font, line, w / 2, y + 4, 0xFFE2E4E7);
        g.drawCenteredString(font, sub, w / 2, y + 15, 0xFF8B9098);
    }

    /** Sol üstte (sohbet ve can barıyla çakışmaz) */
    private static void renderTip(GuiGraphics g, Font font, int top) {
        if (tip == null) return;
        long age = System.currentTimeMillis() - tipAt;
        long life = 6500;
        if (age > life) {
            tip = null;
            return;
        }
        float a = Mth.clamp(Math.min(age / 180f, (life - age) / 400f), 0f, 1f);
        float slide = 1f - (float) Math.pow(1f - Math.min(1f, age / 260f), 3);
        List<FormattedCharSequence> lines = font.split(tip, 190);
        int boxW = 10 + lines.stream().mapToInt(font::width).max().orElse(0) + 10;
        int boxH = 8 + lines.size() * 10 + 4;
        int x = (int) (6 - (1 - slide) * 40), y = top;
        int alpha = (int) (a * 0xC8) << 24;
        // Ashi'nin yüzü (8x8 + şapka katmanı) 24px
        g.fill(x, y, x + 26, y + 26, alpha | 0x101113);
        g.setColor(1f, 1f, 1f, a);
        g.blit(ASHI, x + 1, y + 1, 24, 24, 8, 8, 8, 8, 64, 64);
        g.blit(ASHI, x + 1, y + 1, 24, 24, 40, 8, 8, 8, 64, 64);
        g.setColor(1f, 1f, 1f, 1f);
        int bx = x + 30;
        g.fill(bx, y, bx + boxW, y + boxH, alpha | 0x101113);
        g.fill(bx, y, bx + 2, y + boxH, ((int) (a * 255) << 24) | 0x7FA7C9);
        int ty = y + 6;
        int text = ((int) (Math.max(0.05f, a) * 255) << 24) | 0xE2E4E7;
        for (FormattedCharSequence l : lines) {
            g.drawString(font, l, bx + 9, ty, text, false);
            ty += 10;
        }
    }
}
