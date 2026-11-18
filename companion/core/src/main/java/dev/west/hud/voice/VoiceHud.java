package dev.west.hud.voice;

import dev.west.hud.Config;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.HudElement;
import dev.west.hud.lobby.LobbyClient;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * Oyun içi sesli sohbet göstergesi (HUD düzenleyicide taşınabilir): o an konuşan grup üyeleri, sen dahil.
 * Yalnızca bir grupta (lobide en az 2 kişi) görünür. Mikrofonun ya da sesin kapalıysa sol altta küçük uyarı.
 */
public final class VoiceHud extends HudElement {
    private static final int ROW = 15, OK = 0xFF5BD68A;

    public VoiceHud() {
        super("voice", Tr.t("Sesli sohbet"), Tr.t("Grup sesli sohbetinde o an konuşanlar."), true);
    }

    private static List<String> rows() {
        List<String> out = new ArrayList<>();
        Config.Data d = WestHud.config.data;
        LobbyClient c = LobbyClient.INSTANCE;
        if (d.voice && c.voiceGroup() >= 2) {
            VoiceEngine v = VoiceEngine.INSTANCE;
            for (LobbyClient.Person p : c.members) {
                boolean me = p.id().equals(c.myId);
                if (me ? v.transmitting : v.speaking(p.id())) out.add(p.display());
            }
        }
        if (out.isEmpty() && WestHud.editorOpen) out.add(Tr.t("Konuşan arkadaşın"));
        return out;
    }

    private static int width(Gfx g, String s) {
        return Math.round(g.textWidth(s) * 0.8f) + 22;
    }

    @Override
    public int[] size(Gfx g, Game game) {
        List<String> r = rows();
        int w = 60;
        for (String s : r) w = Math.max(w, width(g, s));
        return new int[] { w, Math.max(1, r.size() * ROW - 2) };
    }

    @Override
    public void draw(Gfx g, Game game, Theme t, int w, int h) {
        int y = 0;
        for (String name : rows()) {
            int rw = width(g, name);
            if (background) Ui.round(g, 0, y, rw, 13, 6, 0xB00B0D14);
            Ui.outline(g, 0, y, rw, 13, 6, Theme.alpha(OK, 0x90));
            Icons.draw(g, Icons.Icon.SPEAKER, 4, y + 2, 9, OK);
            g.push();
            g.translate(17, y + 3);
            g.scale(0.8f);
            g.text(name, 0, 0, textColor(), shadow);
            g.pop();
            y += ROW;
        }
    }

    @Override
    public int[] defaultPos(int sw, int sh, int w, int h) {
        return new int[] { sw - w - 4, Math.round(sh * 0.26f) };
    }

    /** HUD kapalıyken de konuşanlar ve susturma uyarısı görünsün */
    public static void renderAlways(Gfx g, HudElement self) {
        Config.Data d = WestHud.config.data;
        if (!d.voice || LobbyClient.INSTANCE.voiceGroup() < 2 || WestHud.game.hudHidden() || !WestHud.game.inWorld()) return;
        if (!d.hudEnabled && self != null && self.enabled)
            dev.west.hud.hud.Hud.drawElement(g, WestHud.game, WestHud.theme(), self, g.width(), g.height());
        if (d.voiceMuted || d.voiceDeafened) {
            int bx = 4, by = g.height() - 18;
            Ui.round(g, bx, by, 14, 14, 7, 0xC0E5566E);
            Icons.draw(g, d.voiceDeafened ? Icons.Icon.HEADPHONES_OFF : Icons.Icon.MIC_OFF, bx + 3, by + 3, 8, 0xFFFFFFFF);
        }
    }
}
