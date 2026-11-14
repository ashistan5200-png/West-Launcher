package dev.west.companion.gui;

import dev.west.companion.pvp.BotSkill;
import dev.west.companion.pvp.Duel;
import dev.west.companion.pvp.Kit;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.FormattedCharSequence;

import java.util.List;

/** Ashi ile 1v1: kit, zorluk ve raund sayısı seçimi. Seçim oturum boyunca hatırlanır. */
public class DuelScreen extends Screen {
    static Kit kit = Kit.SWORD;
    static BotSkill skill = BotSkill.NORMAL;
    static int bestOf = 3;

    private final Screen parent;

    public DuelScreen(Screen parent) {
        super(Component.translatable("west_companion.pvp.title"));
        this.parent = parent;
    }

    private int w() { return Math.min(320, width - 20); }
    private int bh() { return height < 300 ? 18 : 20; }
    private int top() { return Math.max(6, (height - 230) / 2); }

    @Override
    protected void init() {
        int w = w(), bh = bh(), gap = 4;
        int x = width / 2 - w / 2;
        int y = top() + 34;
        int d = 0;

        int half = (w - gap) / 2;
        Kit[] kits = Kit.values();
        for (int i = 0; i < kits.length; i++) {
            Kit k = kits[i];
            WestButton b = new WestButton(x + (i % 2) * (half + gap), y + (i / 2) * (bh + gap), half, bh, Component.translatable(k.key()), btn -> { kit = k; rebuildWidgets(); }, d += 25, false);
            b.selected = kit == k;
            addRenderableWidget(b);
        }
        y += 2 * (bh + gap) + 26;

        BotSkill[] skills = BotSkill.values();
        int q = (w - gap * 3) / 4;
        for (int i = 0; i < skills.length; i++) {
            BotSkill s = skills[i];
            WestButton b = new WestButton(x + i * (q + gap), y, q, bh, Component.translatable(s.key()), btn -> { skill = s; rebuildWidgets(); }, d += 25, false);
            b.selected = skill == s;
            addRenderableWidget(b);
        }
        y += bh + gap + 18;

        int[] rounds = {1, 3, 5};
        int t = (w - gap * 2) / 3;
        for (int i = 0; i < rounds.length; i++) {
            int r = rounds[i];
            WestButton b = new WestButton(x + i * (t + gap), y, t, bh, Component.translatable("west_companion.pvp.bestof", r), btn -> { bestOf = r; rebuildWidgets(); }, d += 25, false);
            b.selected = bestOf == r;
            addRenderableWidget(b);
        }
        y += bh + 14;

        WestButton start = new WestButton(x, y, half, bh + 2, Component.translatable("west_companion.pvp.start"), btn -> {
            Duel.request(kit, skill, bestOf);
            minecraft.setScreen(null);
        }, d += 25, true);
        start.active = Duel.available();
        addRenderableWidget(start);
        addRenderableWidget(new WestButton(x + half + gap, y, half, bh + 2, Component.translatable("gui.back"), btn -> onClose(), d + 25, false));
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float partialTick) {
        super.render(g, mouseX, mouseY, partialTick);
        int w = w(), bh = bh(), gap = 4;
        int x = width / 2 - w / 2, top = top();
        g.drawString(font, title, x, top + 6, 0xFFE2E4E7, false);
        g.drawString(font, Component.translatable("west_companion.pvp.subtitle"), x, top + 18, 0xFF8B9098, false);
        int y = top + 34 + 2 * (bh + gap);
        List<FormattedCharSequence> desc = font.split(Component.translatable(kit.key() + ".desc"), w);
        if (!desc.isEmpty()) g.drawString(font, desc.get(0), x, y + 2, 0xFF9FB7CC, false);
        g.drawString(font, Component.translatable("west_companion.pvp.skill"), x, y + 14, 0xFF8B9098, false);
        y += 26 + bh + gap;
        g.drawString(font, Component.translatable("west_companion.pvp.rounds"), x, y + 4, 0xFF8B9098, false);
        int by = y + 18 + bh + 14 + bh + 8;
        Component note = Duel.available() ? Component.translatable("west_companion.pvp.safety") : Component.translatable("west_companion.pvp.singleplayer_only");
        int ny = by;
        for (FormattedCharSequence l : font.split(note, w)) {
            g.drawString(font, l, x, ny, Duel.available() ? 0xFF8B9098 : 0xFFC7A566, false);
            ny += 10;
        }
    }

    @Override
    public void onClose() {
        minecraft.setScreen(parent);
    }

    @Override
    public boolean isPauseScreen() {
        return true;
    }
}
