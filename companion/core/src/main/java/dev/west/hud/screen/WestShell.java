package dev.west.hud.screen;

import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Ana menü ve duraklatma menüsünün ortak iskeleti: üst çubuk (marka, sekmeler, hızlı düğmeler,
 * oyuncu), sol alt bilgi kutucukları, alt satır ve düğme çeşitleri.
 */
abstract class WestShell implements WestScreen {
    protected static final int TOP = 28;

    protected final Ui ui = new Ui();
    protected final long opened = System.nanoTime();
    private long last = System.nanoTime();
    protected final Map<String, Float> anim = new HashMap<>();
    protected float dt;

    protected Theme beginFrame(Gfx g, int mx, int my) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        return t;
    }

    protected float appear() {
        return ui.animate ? ease(Math.min(1, ui.time * 2.4f)) : 1;
    }

    // ───────── Üst çubuk ─────────

    /**
     * @param tabs  sekme adları; ilki bu ekranın kendi sekmesi (etkin)
     * @param pages ilk sekme dışındakilerin açtığı West menüsü sayfası
     * @param full  true: dil / ayarlar / tam ekran / çıkış düğmeleri de gösterilir
     * @return ilk sekmeye tıklandıysa true
     */
    protected boolean topBar(int sw, float in, String[] tabs, int[] pages, boolean full) {
        return topBar(sw, in, tabs, pages, full, null) == 0;
    }

    /**
     * map verilirse: pages[i] == -1 olan sekmeye tıklanınca map[i] döner (ekranın kendi alt sayfası);
     * aksi halde West menüsü sayfası açılır ve -1 döner.
     */
    protected int topBar(int sw, float in, String[] tabs, int[] pages, boolean full, int[] map) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int y = Math.round((1 - in) * -10);
        int cy = y + TOP / 2;
        int hit = -1;

        // Dar ekranda sığdırma: önce marka yazısı, sonra isim gizlenir; sekme aralığı daralır; en son sondaki sekmeler düşer
        int s = 18;
        String name = WestHud.game.playerName();
        int nw = g.textBoldWidth(name);
        int rightW = (full ? 2 * (s + 4) + 6 : 0) + s + 7 + nw + 12 + s + (s + 4) + (full ? s + 4 : 0);
        int brandW = 31 + Math.round(textSpaced(g, "WEST CLIENT", 1.6f));
        int[] tw = new int[tabs.length];
        for (int i = 0; i < tabs.length; i++) tw[i] = g.textBoldWidth(tabs[i]);
        boolean showBrand = true, showName = true;
        int gap = 18, count = tabs.length;
        for (int attempt = 0; attempt < 12; attempt++) {
            int total = 0;
            for (int i = 0; i < count; i++) total += tw[i];
            total += gap * (count - 1);
            int left = (showBrand ? brandW : 30) + 14;
            int right = sw - 10 - (rightW - (showName ? 0 : nw + 7)) - 12;
            if (left + total <= right) break;
            if (gap > 12) gap = 12;
            else if (showBrand) showBrand = false;
            else if (showName) showName = false;
            else if (gap > 8) gap = 8;
            else if (count > 1) count--;
            else break;
        }

        Icons.draw(g, Icon.LOGO, 12, cy - 7, 14, t.accent | 0xFF000000);
        int bx = showBrand ? brand(g, "WEST CLIENT", 31, cy - 4, 0xFFFFFFFF, 1.6f) : 30;

        int x = sw - 10 - s;
        if (full) {
            if (iconButton("quit", Icon.CLOSE, x, cy - s / 2, s, "Oyundan çık", 0xFFE5566E)) WestHud.game.open(Game.Target.QUIT);
            x -= s + 4;
            if (iconButton("fs", Icon.FULLSCREEN, x, cy - s / 2, s, WestHud.game.fullscreen() ? "Pencere" : "Tam ekran", 0)) WestHud.game.toggleFullscreen();
            x -= 10 + s;
        }
        Ui.round(g, x - 1, cy - s / 2 - 1, s + 2, s + 2, 5, Theme.alpha(t.accent, 0xCC));
        g.playerFace(x, cy - s / 2, s);
        if (showName) {
            x -= nw + 7;
            g.textBold(name, x, cy - 4, 0xFFFFFFFF, false);
        }
        x -= 12 + s;
        if (iconButton("opt", Icon.GEAR, x, cy - s / 2, s, "Minecraft ayarları", 0)) WestHud.game.open(Game.Target.OPTIONS);
        x -= s + 4;
        if (iconButton("west", Icon.SLIDERS, x, cy - s / 2, s, "West menüsü", 0)) WestHud.game.openWestScreen(false);
        if (full) {
            x -= s + 4;
            if (iconButton("lang", Icon.GLOBE, x, cy - s / 2, s, "Dil", 0)) WestHud.game.open(Game.Target.LANGUAGE);
        }
        int rightStart = x - 12;

        int total = 0;
        for (int i = 0; i < count; i++) total += tw[i];
        total += gap * (count - 1);
        int tx = Math.max(sw / 2 - total / 2, bx + 14);
        if (tx + total > rightStart) tx = Math.max(bx + 14, rightStart - total);
        if (tx + total <= rightStart + 2) {
            for (int i = 0; i < count; i++) {
                int w = tw[i];
                boolean active = i == 0;
                boolean on = ui.hover(tx - 4, y + 4, w + 8, TOP - 8);
                float h = hov("tab" + i, on || active);
                g.textBold(tabs[i], tx, cy - 4, Theme.mix(0x99FFFFFF, 0xFFFFFFFF, h), false);
                if (active) Ui.round(g, tx + w / 2 - 7, cy + 7, 14, 2, 1, t.accent | 0xFF000000);
                else if (h > 0.05f) Ui.round(g, tx + w / 2 - Math.round(5 * h), cy + 7, Math.max(1, Math.round(10 * h)), 2, 1, Theme.alpha(0xFFFFFFFF, (int) (120 * h)));
                if (ui.clicked(tx - 4, y + 4, w + 8, TOP - 8)) {
                    WestHud.game.click();
                    if (active || pages[i] < 0) hit = map != null ? map[i] : 0;
                    else WestHud.game.openWestScreenPage(pages[i]);
                }
                tx += w + gap;
            }
        }
        return hit;
    }

    private static float textSpaced(Gfx g, String s, float spacing) {
        float w = 0;
        for (int i = 0; i < s.length(); i++) w += g.textBoldWidth(String.valueOf(s.charAt(i))) + spacing;
        return w;
    }

    /** Harf aralıklı kalın marka yazısı; bittiği x'i döndürür. */
    protected static int brand(Gfx g, String s, int x, int y, int color, float spacing) {
        float cx = x;
        for (int i = 0; i < s.length(); i++) {
            String ch = String.valueOf(s.charAt(i));
            g.push();
            g.translate(cx, y);
            g.textBold(ch, 0, 0, color, false);
            g.pop();
            cx += g.textBoldWidth(ch) + spacing;
        }
        return Math.round(cx);
    }

    protected boolean iconButton(String id, Icon icon, int x, int y, int s, String tip, int hoverColor) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, s, s);
        float h = hov(id, on);
        int bg = Theme.mix(0x00000000, hoverColor != 0 ? Theme.alpha(hoverColor, 0xE0) : 0x33FFFFFF, h);
        if (h > 0.01f) Ui.round(g, x, y, s, s, 6, bg);
        int pad = Math.max(3, s / 5);
        Icons.draw(g, icon, x + pad, y + pad, s - 2 * pad, Theme.mix(0xCCFFFFFF, 0xFFFFFFFF, h));
        if (on && tip != null) {
            int w = g.textWidth(tip) + 10;
            int tx = Math.min(g.width() - w - 4, Math.max(4, x + s / 2 - w / 2));
            Ui.round(g, tx, y + s + 4, w, 14, 5, 0xF00C0D12);
            Ui.outline(g, tx, y + s + 4, w, 14, 5, 0x22FFFFFF);
            g.text(tip, tx + 5, y + s + 7, 0xFFFFFFFF, false);
        }
        if (ui.clicked(x, y, s, s)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    // ───────── Sol alt kutucuklar ve alt satır ─────────

    protected void chips(int sh, int maxX, float in, boolean westKey) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int h = 26, y = sh - 18 - h + Math.round((1 - in) * 16);
        int x = 10;
        if (westKey) {
            String k1 = "Sağ Shift", k2 = "West menüsü";
            int w1 = 29 + Math.max(g.textBoldWidth(k1), small(g, k2)) + 10;
            if (x + w1 <= maxX) {
                boolean clicked = chip("c1", x, y, w1, h);
                Icons.draw(g, Icon.KEYBOARD, x + 8, y + 6, 14, 0xDDFFFFFF);
                g.textBold(k1, x + 29, y + 5, 0xFFFFFFFF, false);
                smallText(g, k2, x + 29, y + 16, 0x99FFFFFF);
                if (clicked) WestHud.game.openWestScreen(false);
                x += w1 + 6;
            }
        }
        String name = WestHud.game.playerName();
        int w2 = 29 + Math.max(g.textBoldWidth(name), small(g, "Sen")) + 22;
        if (x + w2 <= maxX) {
            chip("c2", x, y, w2, h);
            Ui.round(g, x + 5, y + 4, 18, 18, 5, Theme.alpha(t.accent, 0xAA));
            g.playerFace(x + 6, y + 5, 16);
            g.textBold(name, x + 29, y + 5, 0xFFFFFFFF, false);
            smallText(g, "Sen", x + 29, y + 16, 0x99FFFFFF);
            Ui.round(g, x + w2 - 13, y + 10, 6, 6, 3, t.ok);
            x += w2 + 6;
        }
        Runtime rt = Runtime.getRuntime();
        long used = (rt.totalMemory() - rt.freeMemory()) >> 20, max = rt.maxMemory() >> 20;
        String fps = WestHud.game.fps() + " FPS";
        int ping = WestHud.game.ping();
        String sub = ping >= 0 ? ping + " ms" : used + " / " + max + " MB";
        int w3 = 29 + Math.max(g.textBoldWidth(fps), small(g, sub)) + 10;
        if (x + w3 <= maxX) {
            chip("c3", x, y, w3, h);
            Icons.draw(g, Icon.CHART, x + 8, y + 6, 14, 0xDDFFFFFF);
            g.textBold(fps, x + 29, y + 5, 0xFFFFFFFF, false);
            smallText(g, sub, x + 29, y + 16, 0x99FFFFFF);
        }
    }

    protected boolean chip(String id, int x, int y, int w, int h) {
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(ui.g, x, y, w, h, 8, Theme.mix(0xC00D0E15, 0xD81A1B24, hv));
        Ui.outline(ui.g, x, y, w, h, 8, Theme.alpha(0xFFFFFFFF, (int) (0x1F + 0x20 * hv)));
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    protected void footer(int sw, int sh) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int y = sh - 12;
        Icons.draw(g, Icon.LOGO, 10, y - 1, 8, t.accent | 0xFF000000);
        g.push();
        g.translate(21, y);
        g.scale(0.75f);
        int bw = brand(g, "WEST CLIENT", 0, 0, 0xFFFFFFFF, 1.2f);
        Game game = WestHud.game;
        String info = game.loaderName() + " " + game.minecraftVersion() + "    West Companion " + WestHud.VERSION;
        g.text(info, bw + 10, 0, 0x88FFFFFF, false);
        String legal = "Copyright Mojang AB. Do not distribute!";
        int lx = Math.round((sw - 10 - 21) / 0.75f) - g.textWidth(legal);
        if (lx > bw + 10 + g.textWidth(info) + 12) g.text(legal, lx, 0, 0x66FFFFFF, false);
        g.pop();
    }

    /** Oyuncu modelinin üstündeki isim etiketi */
    protected void nameTag(int cx, int bottomY, String name, String sub) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String you = "Sen";
        int nw = g.textBoldWidth(name), yw = small(g, you);
        int w = Math.max(nw + 6 + yw, sub == null ? 0 : small(g, sub)) + 14;
        int h = sub == null ? 15 : 24;
        int x = cx - w / 2, y = bottomY - h;
        Ui.round(g, x, y, w, h, 5, 0xD90C0D13);
        Ui.outline(g, x, y, w, h, 5, Theme.alpha(t.accent, 0x99));
        int line = nw + 6 + yw;
        g.textBold(name, x + (w - line) / 2, y + 4, 0xFFFFFFFF, false);
        smallText(g, you, x + (w - line) / 2 + nw + 6, y + 5, 0xAAFFFFFF);
        if (sub != null) smallText(g, sub, x + (w - small(g, sub)) / 2, y + 15, 0xAAFFFFFF);
    }

    // ───────── Düğmeler ─────────

    protected boolean accentButton(String id, String label, Icon icon, int x, int y, int w, int h) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        int base = t.accent | 0xFF000000;
        int lift = Math.round(hv);
        Ui.round(g, x, y + 2, w, h, 8, Theme.alpha(Theme.mix(base, 0xFF000000, 0.5f), 0xAA));
        Ui.round(g, x, y - lift, w, h, 8, Theme.mix(base, Theme.mix(base, 0xFFFFFFFF, 0.18f), hv));
        String l = label.isEmpty() ? "" : ui.fit(label, w - (icon != null ? 30 : 12));
        int lw = g.textBoldWidth(l);
        int is = Math.min(12, h - 10);
        int total = (icon != null ? is + (l.isEmpty() ? 0 : 6) : 0) + lw;
        int lx = x + (w - total) / 2;
        if (icon != null) {
            Icons.draw(g, icon, lx, y + (h - is) / 2 - lift, is, t.onAccent);
            lx += is + 6;
        }
        g.textBold(l, lx, y + (h - 8) / 2 - lift, t.onAccent, false);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    protected boolean outlineButton(String id, String label, Icon icon, int x, int y, int w, int h, boolean tinted) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean on = ui.hover(x, y, w, h);
        float hv = hov(id, on);
        Ui.round(g, x, y, w, h, 6, tinted ? Theme.mix(Theme.alpha(t.accent, 0x30), Theme.alpha(t.accent, 0x60), hv) : Theme.mix(0x14FFFFFF, 0x2AFFFFFF, hv));
        Ui.outline(g, x, y, w, h, 6, tinted ? Theme.alpha(t.accent, 0xCC) : 0x40FFFFFF);
        String l = label.isEmpty() ? "" : ui.fit(label, w - (icon != null ? 24 : 8));
        int lw = g.textBoldWidth(l);
        int total = (icon != null ? (l.isEmpty() ? 8 : 14) : 0) + lw;
        int lx = x + (w - total) / 2;
        if (icon != null) {
            Icons.draw(g, icon, lx, y + (h - 8) / 2, 8, 0xFFFFFFFF);
            lx += 14;
        }
        g.textBold(l, lx, y + (h - 8) / 2, 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, h)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    /** Ortalanmış boş durum: başlık, açıklama ve isteğe bağlı vurgulu düğme */
    protected boolean emptyMessage(int cx, int cy, String title, String sub, String button) {
        Gfx g = ui.g;
        int y = cy - (button != null ? 24 : 12);
        g.textBold(title, cx - g.textBoldWidth(title) / 2, y, 0xFFFFFFFF, false);
        g.text(sub, cx - g.textWidth(sub) / 2, y + 13, 0xAAFFFFFF, false);
        if (button == null) return false;
        int bw = g.textBoldWidth(button) + 34;
        return accentButton("empty", button, Icon.PLUS, cx - bw / 2, y + 28, bw, 20);
    }

    // ───────── Yardımcılar ─────────

    protected float hov(String id, boolean on) {
        float v = anim.getOrDefault(id, 0f);
        v += ((on ? 1 : 0) - v) * Math.min(1, dt * 14);
        anim.put(id, v);
        return v;
    }

    protected static int small(Gfx g, String s) {
        return Math.round(g.textWidth(s) * 0.8f);
    }

    protected static void smallText(Gfx g, String s, int x, int y, int color) {
        g.push();
        g.translate(x, y);
        g.scale(0.8f);
        g.text(s, 0, 0, color, false);
        g.pop();
    }

    protected static void bigText(Gfx g, String s, int x, int y, int color, float scale) {
        g.push();
        g.translate(x, y);
        g.scale(scale);
        g.textBold(s, 0, 0, color, false);
        g.pop();
    }

    protected static List<String> wrap(Gfx g, String text, int maxW) {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : text.split(" ")) {
            String test = line.isEmpty() ? word : line + " " + word;
            if (g.textWidth(test) > maxW && !line.isEmpty()) {
                out.add(line.toString());
                line = new StringBuilder(word);
            } else {
                line = new StringBuilder(test);
            }
        }
        if (!line.isEmpty()) out.add(line.toString());
        return out;
    }

    protected static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    protected static float ease(float x) {
        return 1 - (float) Math.pow(1 - x, 3);
    }

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
    }

    private WestScreen pendingNext;

    /** Bu kareden sonra başka bir West ekranına geç */
    protected void go(WestScreen s) {
        pendingNext = s;
    }

    @Override
    public WestScreen next() {
        WestScreen n = pendingNext;
        pendingNext = null;
        return n;
    }
}
