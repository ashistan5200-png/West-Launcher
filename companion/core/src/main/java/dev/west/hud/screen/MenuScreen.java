package dev.west.hud.screen;

import dev.west.hud.Config;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.HudElement;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.BooleanSupplier;

/** West menüsü: mod kartları (özellikler), yüklü modlar, temalar ve tercihler. */
public final class MenuScreen implements WestScreen {
    private enum Page { MODS, INSTALLED, LOOK, GENERAL }

    private static final String[] PAGE_NAMES = { "Modlar", "Yüklü modlar", "Temalar", "Tercihler" };
    private static final Icon[] PAGE_ICONS = { Icon.LIST, Icon.BOX, Icon.EDIT, Icon.GEAR };
    private static final String[] CATS = { "Tümü", "HUD", "Görsel", "Yardımcı" };
    private static final Icon[] CAT_ICONS = { null, Icon.HUD, Icon.SUN, Icon.SLIDERS };

    /** Bir mod kartı: West özelliği (HUD öğesi ya da ayar) */
    private record Feature(String name, Icon icon, int cat, BooleanSupplier on, Runnable toggle, HudElement element) {}

    private final Ui ui = new Ui();
    private Page page = Page.MODS;
    private int cat;
    private HudElement editing;
    private float scroll, scrollTarget;
    private int contentH;
    private final long opened = System.nanoTime();
    private long last = System.nanoTime();
    private float dt;
    private final java.util.Map<String, Float> anim = new java.util.HashMap<>();
    private String search = "";
    private boolean searchFocus;

    public MenuScreen() {}

    /** 0 ya da 3: Modlar, 1: Temalar, 2: Tercihler, 4: Yüklü modlar */
    public MenuScreen(int p) {
        this.page = switch (p) {
            case 1 -> Page.LOOK;
            case 2 -> Page.GENERAL;
            case 4 -> Page.INSTALLED;
            default -> Page.MODS;
        };
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        int sw = g.width(), sh = g.height();
        float appear = ui.animate ? 1 - (float) Math.pow(1 - Math.min(1, time * 4f), 3) : 1;

        if (!WestHud.game.inWorld()) g.panorama(delta);
        g.blurBehind();
        g.fill(0, 0, sw, sh, (int) (0x99 * appear) << 24 | 0x06070B);

        int pw = Math.min(660, sw - 16), ph = Math.min(390, sh - 16);
        int px = (sw - pw) / 2, py = (sh - ph) / 2 + Math.round((1 - appear) * 12);
        Ui.round(g, px - 1, py + 3, pw + 2, ph + 2, 13, 0x50000000);
        Ui.round(g, px, py, pw, ph, 12, 0xF00E0F16);
        Ui.outline(g, px, py, pw, ph, 12, 0x1FFFFFFF);

        int side = clamp(pw / 4, 96, 150);
        sidebar(px, py, side, ph);
        int cx = px + side + 12, cy = py + 10, cw = pw - side - 24, ch = ph - 20;

        // Başlık satırı: geri, başlık, arama, kapat
        int tx = cx;
        if (editing != null) {
            if (iconButton("back", Icon.BACK, cx - 2, cy, 18, 0)) editing = null;
            tx += 22;
        }
        String title = editing != null ? editing.name : PAGE_NAMES[page.ordinal()];
        bigText(g, ui.fit(title, Math.round((cw / 2f) / 1.3f)), tx, cy + 5, 0xFFFFFFFF, 1.3f);
        if (iconButton("close", Icon.CLOSE, px + pw - 26, cy, 18, 0xFFE5566E)) {
            WestHud.game.closeScreen();
            ui.end();
            return;
        }
        boolean searchable = editing == null && (page == Page.MODS || page == Page.INSTALLED);
        if (searchable) {
            int sbw = clamp(cw / 3, 70, 170);
            searchBox(px + pw - 32 - sbw, cy + 1, sbw, 16);
        }
        int top = cy + 24;
        if (searchable && page == Page.MODS) {
            top = chipsRow(cx, top, cw) + 8;
        }

        int viewH = py + ph - 10 - top;
        scroll += (scrollTarget - scroll) * Math.min(1, dt * 18);
        g.scissor(cx - 2, top, cx + cw + 4, top + viewH);
        g.push();
        g.translate(0, -Math.round(scroll));
        int realMy = ui.my;
        ui.my = my + Math.round(scroll);
        boolean inside = ui.mx >= cx - 2 && ui.mx < cx + cw + 4 && realMy >= top && realMy < top + viewH;
        if (!inside) ui.my = -9999;
        int end;
        if (editing != null) end = elementPage(cx, top + 2, cw);
        else end = switch (page) {
            case MODS -> modsGrid(cx, top + 2, cw);
            case INSTALLED -> installedGrid(cx, top + 2, cw);
            case LOOK -> lookPage(cx, top + 2, cw);
            case GENERAL -> generalPage(cx, top + 2, cw);
        };
        ui.my = realMy;
        g.pop();
        g.noScissor();
        contentH = end - top;
        float max = Math.max(0, contentH - viewH);
        scrollTarget = Math.max(0, Math.min(max, scrollTarget));
        if (max > 0) {
            int barH = Math.max(16, (int) (viewH * viewH / (float) contentH));
            int barY = top + (int) ((viewH - barH) * (scroll / max));
            Ui.round(g, cx + cw + 5, barY, 3, barH, 1, 0x55FFFFFF);
        }
        ui.end();
    }

    private void sidebar(int x, int y, int w, int h) {
        Theme t = ui.t;
        Gfx g = ui.g;
        Ui.round(g, x, y, w, h, 12, 0xF0090A10);
        g.fill(x + w - 1, y + 10, x + w, y + h - 10, 0x14FFFFFF);
        Icons.draw(g, Icon.LOGO, x + 11, y + 12, 12, t.accent | 0xFF000000);
        float cx = x + 28;
        for (char c : "WEST CLIENT".toCharArray()) {
            String ch = String.valueOf(c);
            g.push();
            g.translate(cx, y + 14);
            g.textBold(ch, 0, 0, 0xFFFFFFFF, false);
            g.pop();
            cx += g.textBoldWidth(ch) + 1.2f;
            if (cx > x + w - 10) break;
        }

        int by = y + 36;
        by = section("MODLAR VE SEÇENEKLER", x, by, w);
        by = navItem(Page.MODS, x, by, w);
        by = navItem(Page.INSTALLED, x, by, w);
        by += 6;
        by = section("KİŞİSELLEŞTİRME", x, by, w);
        by = navItem(Page.LOOK, x, by, w);
        by = navItem(Page.GENERAL, x, by, w);

        // Alt: HUD düzenleyici + oyuncu
        int fy = y + h - 30;
        int hy = fy - 24;
        boolean on = ui.hover(x + 6, hy, w - 12, 18);
        float hv = hov("navhud", on);
        if (hv > 0.01f) Ui.round(g, x + 6, hy, w - 12, 18, 6, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x18 * hv))));
        Icons.draw(g, Icon.HUD, x + 13, hy + 4, 10, 0xDDFFFFFF);
        g.textBold(ui.fit("HUD'u düzenle", w - 40), x + 29, hy + 5, 0xFFFFFFFF, false);
        if (ui.clicked(x + 6, hy, w - 12, 18)) {
            WestHud.game.click();
            WestHud.game.openWestScreen(true);
        }
        g.fill(x + 8, fy - 3, x + w - 8, fy - 2, 0x14FFFFFF);
        Ui.round(g, x + 9, fy + 3, 20, 20, 5, Theme.alpha(t.accent, 0xAA));
        g.playerFace(x + 10, fy + 4, 18);
        Game game = WestHud.game;
        g.textBold(ui.fit(game.playerName(), w - 44), x + 35, fy + 4, 0xFFFFFFFF, false);
        smallText(g, ui.fit(game.loaderName() + " " + game.minecraftVersion(), (int) ((w - 44) / 0.8f)), x + 35, fy + 15, 0x88FFFFFF);
    }

    private int section(String label, int x, int y, int w) {
        Gfx g = ui.g;
        g.push();
        g.translate(x + 12, y);
        g.scale(0.65f);
        g.textBold(ui.fit(label, (int) ((w - 20) / 0.65f)), 0, 0, 0x88FFFFFF, false);
        g.pop();
        return y + 11;
    }

    private int navItem(Page p, int x, int y, int w) {
        Theme t = ui.t;
        Gfx g = ui.g;
        boolean active = page == p && editing == null || (editing != null && p == Page.MODS);
        boolean on = ui.hover(x + 6, y, w - 12, 18);
        float hv = hov("nav" + p, on);
        if (active) Ui.round(g, x + 6, y, w - 12, 18, 6, t.accent | 0xFF000000);
        else if (hv > 0.01f) Ui.round(g, x + 6, y, w - 12, 18, 6, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x18 * hv))));
        int c = active ? t.onAccent : Theme.mix(0xCCFFFFFF, 0xFFFFFFFF, hv);
        Icons.draw(g, PAGE_ICONS[p.ordinal()], x + 13, y + 4, 10, c);
        g.textBold(ui.fit(PAGE_NAMES[p.ordinal()], w - 40), x + 29, y + 5, c, false);
        if (ui.clicked(x + 6, y, w - 12, 18)) {
            page = p;
            editing = null;
            scroll = scrollTarget = 0;
            search = "";
            WestHud.game.click();
        }
        return y + 20;
    }

    private int chipsRow(int x, int y, int w) {
        Theme t = ui.t;
        Gfx g = ui.g;
        int cx = x;
        for (int i = 0; i < CATS.length; i++) {
            int tw = g.textBoldWidth(CATS[i]) + (CAT_ICONS[i] != null ? 26 : 14);
            if (cx + tw > x + w) break;
            boolean active = cat == i;
            boolean on = ui.hover(cx, y, tw, 17);
            float hv = hov("cat" + i, on);
            Ui.round(g, cx, y, tw, 17, 6, active ? t.accent | 0xFF000000 : Theme.mix(0x14FFFFFF, 0x28FFFFFF, hv));
            if (!active) Ui.outline(g, cx, y, tw, 17, 6, 0x22FFFFFF);
            int c = active ? t.onAccent : 0xEEFFFFFF;
            int lx = cx + 7;
            if (CAT_ICONS[i] != null) {
                Icons.draw(g, CAT_ICONS[i], lx, y + 4, 9, c);
                lx += 12;
            }
            g.textBold(CATS[i], lx, y + 5, c, false);
            if (ui.clicked(cx, y, tw, 17)) {
                cat = i;
                scroll = scrollTarget = 0;
                WestHud.game.click();
            }
            cx += tw + 5;
        }
        return y + 17;
    }

    private List<Feature> features() {
        Config.Data d = WestHud.config.data;
        List<Feature> out = new ArrayList<>();
        for (HudElement e : WestHud.HUD.elements) {
            Icon icon = switch (e.id) {
                case "fps" -> Icon.CHART;
                case "cps" -> Icon.MOUSE;
                case "coords" -> Icon.PIN;
                case "ping" -> Icon.SIGNAL;
                case "speed" -> Icon.GAUGE;
                case "clock" -> Icon.CLOCK;
                case "memory" -> Icon.CHIP;
                case "server" -> Icon.SERVER;
                case "keystrokes" -> Icon.KEYBOARD;
                case "armor" -> Icon.SHIELD;
                case "compass" -> Icon.COMPASS;
                default -> Icon.HUD;
            };
            out.add(new Feature(e.name, icon, 1, () -> e.enabled, () -> e.enabled = !e.enabled, e));
        }
        out.add(new Feature("FullBright", Icon.SUN, 2, () -> d.fullbright, () -> d.fullbright = !d.fullbright, null));
        out.add(new Feature("Pürüzsüz yazı", Icon.TEXT, 2, () -> d.smoothFont, () -> d.smoothFont = !d.smoothFont, null));
        out.add(new Feature("Animasyonlar", Icon.STAR, 2, () -> d.animations, () -> d.animations = !d.animations, null));
        out.add(new Feature("West ana menüsü", Icon.LOGO, 3, () -> d.customTitle, () -> d.customTitle = !d.customTitle, null));
        out.add(new Feature("Mıknatıslı hizalama", Icon.MAGNET, 3, () -> d.snapping, () -> d.snapping = !d.snapping, null));
        return out;
    }

    private int modsGrid(int x, int y, int w) {
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<Feature> list = new ArrayList<>();
        for (Feature f : features()) {
            if (cat != 0 && f.cat != cat) continue;
            if (!q.isEmpty() && !f.name.toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(f);
        }
        if (list.isEmpty()) {
            ui.g.text("Eşleşen mod yok.", x, y + 4, 0x99FFFFFF, false);
            return y + 20;
        }
        int gap = 8, cols = Math.max(2, (w + gap) / (100 + gap));
        int cw = (w - gap * (cols - 1)) / cols, chh = Math.max(56, Math.min(74, Math.round(cw * 0.62f)));
        for (int i = 0; i < list.size(); i++) {
            int ex = x + (i % cols) * (cw + gap), ey = y + (i / cols) * (chh + gap);
            card(list.get(i), ex, ey, cw, chh, i);
        }
        int rows = (list.size() + cols - 1) / cols;
        return y + rows * (chh + gap);
    }

    private void card(Feature f, int x, int y, int w, int h, int i) {
        Theme t = ui.t;
        Gfx g = ui.g;
        boolean enabled = f.on.getAsBoolean();
        boolean on = ui.hover(x, y, w, h);
        float hv = hov("card" + f.name, on);
        float en = hov("en" + f.name, enabled);
        int lift = Math.round(hv * 1.5f);
        int barH = 18;
        Ui.round(g, x, y + 2, w, h, 9, 0x40000000);
        Ui.round(g, x, y - lift, w, h, 9, Theme.mix(0xFF181A24, 0xFF20222E, hv));
        // Alt isim şeridi (açıkken vurgu renginde)
        Ui.round(g, x, y - lift + h - barH - 6, w, barH + 6, 9, Theme.mix(0xFF262833, t.accent | 0xFF000000, en));
        g.fill(x, y - lift + h - barH - 6, x + w, y - lift + h - barH, Theme.mix(0xFF181A24, 0xFF20222E, hv));
        Ui.outline(g, x, y - lift, w, h, 9, Theme.alpha(0xFFFFFFFF, (int) (0x18 + 0x22 * hv)));
        int is = Math.min(22, h - barH - 14);
        Icons.draw(g, f.icon, x + (w - is) / 2, y - lift + (h - barH - is) / 2, is, Theme.mix(0x99FFFFFF, 0xFFFFFFFF, Math.max(en, hv)));
        String name = ui.fit(f.name, w - 10);
        int nc = Theme.mix(0xAAFFFFFF, t.onAccent | 0xFF000000, en);
        g.textBold(name, x + (w - g.textBoldWidth(name)) / 2, y - lift + h - barH + 5, nc, false);
        // Ayarlar noktası
        boolean hasSettings = f.element != null;
        int dx = x + w - 13, dy = y - lift + 5;
        boolean dotHover = hasSettings && ui.hover(dx - 3, dy - 3, 12, 12);
        if (hasSettings) {
            if (dotHover || hv > 0.3f) {
                Ui.round(g, dx - 3, dy - 3, 12, 12, 6, dotHover ? 0x40FFFFFF : 0x1AFFFFFF);
                Icons.draw(g, Icon.GEAR, dx - 1, dy - 1, 8, 0xEEFFFFFF);
            } else {
                Ui.round(g, dx + 1, dy + 1, 4, 4, 2, t.accent | 0xFF000000);
            }
        }
        if (hasSettings && ui.clicked(dx - 3, dy - 3, 12, 12)) {
            editing = f.element;
            scroll = scrollTarget = 0;
            WestHud.game.click();
        } else if (ui.clicked(x, y, w, h)) {
            f.toggle.run();
            WestHud.save();
            WestHud.game.click();
        }
    }

    private int installedGrid(int x, int y, int w) {
        Theme t = ui.t;
        Gfx g = ui.g;
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<Game.ModInfo> list = new ArrayList<>();
        for (Game.ModInfo m : WestHud.game.mods()) {
            if (!q.isEmpty() && !m.name().toLowerCase(Locale.ROOT).contains(q) && !m.id().toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(m);
        }
        if (list.isEmpty()) {
            g.text("Eşleşen mod yok.", x, y + 4, 0x99FFFFFF, false);
            return y + 20;
        }
        int gap = 8, cols = Math.max(2, (w + gap) / (100 + gap));
        int cw = (w - gap * (cols - 1)) / cols, chh = 58;
        for (int i = 0; i < list.size(); i++) {
            Game.ModInfo m = list.get(i);
            int ex = x + (i % cols) * (cw + gap), ey = y + (i / cols) * (chh + gap);
            boolean on = ui.hover(ex, ey, cw, chh);
            float hv = hov("mod" + m.id(), on);
            Ui.round(g, ex, ey, cw, chh, 9, Theme.mix(0xFF181A24, 0xFF20222E, hv));
            Ui.outline(g, ex, ey, cw, chh, 9, Theme.alpha(0xFFFFFFFF, (int) (0x18 + 0x22 * hv)));
            String ch = m.name().isEmpty() ? "?" : m.name().substring(0, 1).toUpperCase(Locale.ROOT);
            int bs = 22;
            Ui.round(g, ex + (cw - bs) / 2, ey + 8, bs, bs, 6, Theme.alpha(t.accent, 0x50 + (int) (0x50 * hv)));
            g.textBold(ch, ex + (cw - g.textBoldWidth(ch)) / 2, ey + 15, 0xFFFFFFFF, false);
            String n = ui.fit(m.name(), cw - 10);
            g.textBold(n, ex + (cw - g.textBoldWidth(n)) / 2, ey + 35, 0xFFFFFFFF, false);
            String v = ui.fit(m.version(), (int) ((cw - 10) / 0.8f));
            smallText(g, v, ex + (cw - small(g, v)) / 2, ey + 46, 0x88FFFFFF);
        }
        int rows = (list.size() + cols - 1) / cols;
        return y + rows * (chh + gap);
    }

    private void searchBox(int x, int y, int w, int h) {
        Theme t = ui.t;
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        Ui.round(g, x, y, w, h, 6, searchFocus ? 0x99000000 : on ? 0x80000000 : 0x66000000);
        Ui.outline(g, x, y, w, h, 6, searchFocus ? Theme.alpha(t.accent, 0xCC) : 0x26FFFFFF);
        Icons.draw(g, Icon.SEARCH, x + 5, y + (h - 9) / 2, 9, 0x99FFFFFF);
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        String shown = search.isEmpty() && !searchFocus ? "Ara" : search + (searchFocus && blink ? "|" : "");
        g.text(ui.fit(shown, w - 24), x + 18, y + (h - 8) / 2, search.isEmpty() && !searchFocus ? 0x77FFFFFF : 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, h)) searchFocus = true;
        else if (!on && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;
    }

    private boolean iconButton(String id, Icon icon, int x, int y, int s, int hoverColor) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, s, s);
        float h = hov(id, on);
        if (h > 0.01f) Ui.round(g, x, y, s, s, 6, Theme.mix(0x00000000, hoverColor != 0 ? Theme.alpha(hoverColor, 0xE0) : 0x33FFFFFF, h));
        Icons.draw(g, icon, x + 4, y + 4, s - 8, Theme.mix(0xCCFFFFFF, 0xFFFFFFFF, h));
        if (ui.clicked(x, y, s, s)) {
            WestHud.game.click();
            return true;
        }
        return false;
    }

    private float hov(String id, boolean on) {
        float v = anim.getOrDefault(id, on ? 1f : 0f);
        v += ((on ? 1 : 0) - v) * Math.min(1, dt * 14);
        anim.put(id, v);
        return v;
    }

    private static int small(Gfx g, String s) {
        return Math.round(g.textWidth(s) * 0.8f);
    }

    private static void smallText(Gfx g, String s, int x, int y, int color) {
        g.push();
        g.translate(x, y);
        g.scale(0.8f);
        g.text(s, 0, 0, color, false);
        g.pop();
    }

    private static void bigText(Gfx g, String s, int x, int y, int color, float scale) {
        g.push();
        g.translate(x, y);
        g.scale(scale);
        g.textBold(s, 0, 0, color, false);
        g.pop();
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    // ───────── Ayar sayfaları ─────────

    private int row(String title, String sub, int x, int y, int w) {
        Theme t = ui.t;
        ui.text(title, x, y + 2, t.text);
        if (sub != null) {
            ui.g.push();
            ui.g.translate(x, y + 13);
            ui.g.scale(0.75f);
            ui.text(ui.fit(sub, (int) ((w - 80) / 0.75f)), 0, 0, t.muted);
            ui.g.pop();
        }
        ui.g.fill(x, y + 25, x + w, y + 26, t.line);
        return y + 30;
    }

    private int elementPage(int x, int y, int w) {
        HudElement e = editing;
        Theme t = ui.t;
        boolean changed = false;

        int ny = row("Göster", e.description, x, y, w);
        boolean on = ui.toggle(e.enabled, x + w - 24, y + 4);
        if (on != e.enabled) { e.enabled = on; changed = true; }
        y = ny;

        ny = row("Boyut", String.format(Locale.ROOT, "%%%d", Math.round(e.scale * 100)), x, y, w);
        float s = ui.slider(e, e.scale, 0.5f, 2.5f, x + w - 104, y + 8, 100);
        if (Math.abs(s - e.scale) > 0.001f) { e.scale = Math.round(s * 20) / 20f; changed = true; }
        y = ny;

        ny = row("Arka plan", "Öğenin arkasında yarı saydam kutu.", x, y, w);
        on = ui.toggle(e.background, x + w - 24, y + 4);
        if (on != e.background) { e.background = on; changed = true; }
        y = ny;

        ny = row("Yazı gölgesi", "Açık zeminlerde okunurluğu artırır.", x, y, w);
        on = ui.toggle(e.shadow, x + w - 24, y + 4);
        if (on != e.shadow) { e.shadow = on; changed = true; }
        y = ny;

        ui.text("Yazı rengi", x, y + 2, t.text);
        int[] colors = { 0xFFFFFF, 0xE8A25C, 0x6EA8D6, 0x70C48E, 0xEC5A82, 0xF2C14E, 0xA08CB8, 0x111111 };
        for (int i = 0; i < colors.length; i++) {
            if (ui.swatch(colors[i], e.color == colors[i], x + w - (colors.length - i) * 14, y, 10)) { e.color = colors[i]; changed = true; }
        }
        ui.g.fill(x, y + 17, x + w, y + 18, t.line);
        y += 22;

        if (e == WestHud.HUD.keystrokes) {
            ny = row("Fare tuşları", "Sol/sağ tık ve CPS.", x, y, w);
            on = ui.toggle(WestHud.HUD.keystrokes.showMouse, x + w - 24, y + 4);
            if (on != WestHud.HUD.keystrokes.showMouse) { WestHud.HUD.keystrokes.showMouse = on; changed = true; }
            y = ny;
            ny = row("Boşluk tuşu", null, x, y, w);
            on = ui.toggle(WestHud.HUD.keystrokes.showSpace, x + w - 24, y + 4);
            if (on != WestHud.HUD.keystrokes.showSpace) { WestHud.HUD.keystrokes.showSpace = on; changed = true; }
            y = ny;
        }
        if (e == WestHud.HUD.armor) {
            ny = row("Eldeki eşya", "Ana eldeki eşyayı da göster.", x, y, w);
            on = ui.toggle(WestHud.HUD.armor.showHand, x + w - 24, y + 4);
            if (on != WestHud.HUD.armor.showHand) { WestHud.HUD.armor.showHand = on; changed = true; }
            y = ny;
        }

        y += 4;
        if (ui.button("Konumunu düzenle", x, y, 110, 18, true)) WestHud.game.openWestScreen(true);
        if (ui.button("Varsayılana dön", x + 116, y, 100, 18, false)) { e.resetLayout(); changed = true; }
        if (changed) WestHud.save();
        return y + 26;
    }

    private int lookPage(int x, int y, int w) {
        Theme t = ui.t;
        Config.Data d = WestHud.config.data;
        boolean changed = false;
        ui.text("Tema", x, y, t.text);
        y += 12;
        String[] ids = { "night", "day", "pixel-night", "pixel-day" };
        String[] names = { "Gece camı", "Gün camı", "Piksel gece", "Piksel gün" };
        int gap = 6, cw = (w - gap * 3) / 4, chh = 58;
        for (int i = 0; i < 4; i++) {
            int ex = x + i * (cw + gap);
            Theme p = Theme.of(ids[i], d.accent);
            boolean sel = d.theme.equals(ids[i]);
            if (sel) ui.rect(ex - 2, y - 2, cw + 4, chh + 4, t.accent, t.radius + 2);
            ui.rect(ex, y, cw, chh, 0xFF000000 | (p.panel & 0xFFFFFF), p.radius);
            // Küçük önizleme
            ui.g.fill(ex + 5, y + 5, ex + 5 + cw / 4, y + chh - 16, 0xFF000000 | (p.side & 0xFFFFFF));
            for (int r = 0; r < 3; r++) for (int c = 0; c < 2; c++) {
                int bx = ex + 9 + cw / 4 + c * ((cw - cw / 4 - 16) / 2);
                ui.g.fill(bx, y + 7 + r * 11, bx + (cw - cw / 4 - 20) / 2, y + 14 + r * 11, Theme.alpha(p.accent, 230));
            }
            ui.textCentered(names[i], ex + cw / 2, y + chh - 11, p.text);
            if (ui.clicked(ex, y, cw, chh)) { d.theme = ids[i]; changed = true; }
        }
        y += chh + 12;

        int ny = row("Vurgu rengi", "Menülerin ve HUD etiketlerinin rengi.", x, y, w);
        for (int i = 0; i < Theme.ACCENTS.length; i++) {
            int c = Theme.ACCENTS[i];
            if (ui.swatch(c, (d.accent & 0xFFFFFF) == c, x + w - (Theme.ACCENTS.length - i) * 14, y + 4, 10)) { d.accent = c; changed = true; }
        }
        y = ny;
        ny = row("Animasyonlar", "Menü geçişleri ve tuş göstergesi parıltıları.", x, y, w);
        boolean on = ui.toggle(d.animations, x + w - 24, y + 4);
        if (on != d.animations) { d.animations = on; changed = true; }
        y = ny;
        ny = row("Pürüzsüz yazı tipi", "Kapatırsan Minecraft'ın piksel yazı tipi kullanılır.", x, y, w);
        on = ui.toggle(d.smoothFont, x + w - 24, y + 4);
        if (on != d.smoothFont) { d.smoothFont = on; changed = true; }
        y = ny;
        ny = row("Mıknatıslı hizalama", "Düzenleyicide öğeler kenarlara ve birbirine yapışır.", x, y, w);
        on = ui.toggle(d.snapping, x + w - 24, y + 4);
        if (on != d.snapping) { d.snapping = on; changed = true; }
        y = ny;
        if (changed) WestHud.save();
        return y;
    }

    private int generalPage(int x, int y, int w) {
        Config.Data d = WestHud.config.data;
        Theme t = ui.t;
        int ny = row("FullBright", "Mağarada bile her yer aydınlık. Bazı sunucular buna izin vermez.", x, y, w);
        boolean on = ui.toggle(d.fullbright, x + w - 24, y + 4);
        if (on != d.fullbright) { d.fullbright = on; WestHud.save(); WestHud.game.click(); }
        y = ny;
        ny = row("West ana menüsü", "Minecraft'ın başlık ekranı yerine West Client ana menüsü.", x, y, w);
        on = ui.toggle(d.customTitle, x + w - 24, y + 4);
        if (on != d.customTitle) { d.customTitle = on; WestHud.save(); WestHud.game.click(); }
        y = ny;
        ny = row("Arka plan müziği", "West müziği menülerde çalar. Ses düzeyi: Minecraft → Müzik.", x, y, w);
        on = ui.toggle(d.music, x + w - 24, y + 4);
        if (on != d.music) { d.music = on; WestHud.save(); WestHud.game.click(); }
        y = ny;
        ny = row("Oyunda da çal", "Dünyadayken Minecraft'ın kendi müziğinin yerine.", x, y, w);
        on = ui.toggle(d.musicInGame, x + w - 24, y + 4);
        if (on != d.musicInGame) { d.musicInGame = on; WestHud.save(); WestHud.game.click(); }
        y = ny;
        ny = row("Menü tuşu", "Kontroller → West Companion'dan değiştirebilirsin. Varsayılan: Sağ Shift", x, y, w);
        y = ny;
        ny = row("Tüm HUD'u sıfırla", "Bütün öğeleri varsayılan konum ve boyuta döndürür.", x, y, w);
        if (ui.button("Sıfırla", x + w - 60, y - 26, 56, 16, false)) {
            for (HudElement e : WestHud.HUD.elements) e.resetLayout();
            WestHud.save();
        }
        y = ny;
        ui.text("West Companion " + WestHud.VERSION, x, y + 4, t.muted);
        ui.text("West Client launcher'ından ayarlar da canlı uygulanır.", x, y + 16, t.muted);
        return y + 30;
    }

    // ───────── Olaylar ─────────

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
    }

    @Override
    public void mouseReleased(double x, double y, int button) {
        if (ui.dragging != null) {
            ui.dragging = null;
            WestHud.save();
        }
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        scrollTarget -= (float) amount * 28;
    }

    @Override
    public boolean keyPressed(int key) {
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) search = search.substring(0, search.length() - 1);
        else if (key == 256 || key == 257) searchFocus = false;
        return true;
    }

    @Override
    public void charTyped(char c) {
        if (searchFocus && c >= 32 && search.length() < 40) search += c;
    }

    @Override
    public WestScreen escape() {
        if (editing != null) {
            editing = null;
            return this;
        }
        return null;
    }
}
