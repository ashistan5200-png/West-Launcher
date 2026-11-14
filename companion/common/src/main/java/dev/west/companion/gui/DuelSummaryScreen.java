package dev.west.companion.gui;

import dev.west.companion.pvp.Coach;
import dev.west.companion.pvp.CoachEvent;
import dev.west.companion.pvp.Duel;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.FormattedCharSequence;

import java.util.List;

/** Maç sonu: sonuç, Ashi'nin raporu ve en önemli 3 öneri. */
public class DuelSummaryScreen extends Screen {
    private static final ResourceLocation ASHI = ResourceLocation.fromNamespaceAndPath("west_companion", "textures/entity/ashi.png");
    private final CoachEvent.MatchEnd m;
    private final Coach.Stats s;
    private final List<String> tips;

    public DuelSummaryScreen(CoachEvent.MatchEnd m, Coach.Stats s, List<String> tips) {
        super(Component.translatable("west_companion.pvp.report"));
        this.m = m;
        this.s = s;
        this.tips = tips.subList(0, Math.min(3, tips.size()));
    }

    private int w() { return Math.min(340, width - 20); }
    private int top() { return Math.max(6, (height - 250) / 2); }

    @Override
    protected void init() {
        int w = w(), x = width / 2 - w / 2, half = (w - 4) / 2;
        int y = Math.min(height - 26, top() + 226);
        addRenderableWidget(new WestButton(x, y, half, 20, Component.translatable("west_companion.pvp.rematch"), b -> {
            Duel.request(m.kit(), m.skill(), m.bestOf());
            minecraft.setScreen(null);
        }, 40, true));
        addRenderableWidget(new WestButton(x + half + 4, y, half, 20, Component.translatable("gui.done"), b -> onClose(), 80, false));
    }

    private static String pct(float v) {
        return Math.round(v * 100) + "%";
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int w = w(), x = width / 2 - w / 2, y = top();
        boolean won = Boolean.TRUE.equals(m.playerWon());

        g.blit(ASHI, x, y, 28, 28, 8, 8, 8, 8, 64, 64);
        g.blit(ASHI, x, y, 28, 28, 40, 8, 8, 8, 64, 64);
        g.drawString(font, Component.translatable(won ? "west_companion.pvp.match_won" : "west_companion.pvp.match_lost"), x + 36, y + 3, won ? 0xFF9FC4A8 : 0xFFE09A9A, false);
        g.drawString(font, Component.translatable("west_companion.pvp.final", m.you(), m.ashi(), Component.translatable(m.kit().key()), Component.translatable(m.skill().key())), x + 36, y + 16, 0xFF8B9098, false);

        y += 40;
        float avgCd = s.hits == 0 ? 0 : s.cooldownSum / s.hits;
        float acc = s.clicks == 0 ? 0 : Math.min(1f, (float) s.hits / s.clicks);
        String[][] rows = {
                {"hits", s.landed + " / " + s.taken},
                {"damage", String.format("%.1f / %.1f", s.damageDealt / 2f, s.damageTaken / 2f)},
                {"accuracy", s.clicks == 0 ? "-" : pct(acc)},
                {"cooldown", s.hits == 0 ? "-" : pct(avgCd)},
                {"crits", String.valueOf(s.crits)},
                {"sprint", s.fullHits == 0 ? "-" : pct((float) s.sprintHits / s.fullHits)},
                {"combo", s.comboBest + " / " + s.comboTakenBest},
                {"ashi", m.ashiHits() + " · " + m.ashiCrits() + " · " + m.ashiHeals()},
        };
        int col = (w - 8) / 2;
        for (int i = 0; i < rows.length; i++) {
            int cx = x + (i % 2) * (col + 8), cy = y + (i / 2) * 24;
            g.fill(cx, cy, cx + col, cy + 21, 0x88101113);
            g.drawString(font, Component.translatable("west_companion.pvp.stat." + rows[i][0]), cx + 6, cy + 3, 0xFF8B9098, false);
            g.drawString(font, rows[i][1], cx + 6, cy + 12, 0xFFE2E4E7, false);
        }
        y += 4 * 24 + 6;
        g.drawString(font, Component.translatable("west_companion.pvp.tips"), x, y, 0xFF7FA7C9, false);
        y += 12;
        for (String t : tips) {
            for (FormattedCharSequence l : font.split(Component.literal("• ").append(Component.translatable("west_companion.coach." + t)), w)) {
                if (y > height - 40) break;
                g.drawString(font, l, x, y, 0xFFD5D9DF, false);
                y += 10;
            }
            y += 2;
        }
    }

    @Override
    public boolean isPauseScreen() {
        return false;
    }
}
