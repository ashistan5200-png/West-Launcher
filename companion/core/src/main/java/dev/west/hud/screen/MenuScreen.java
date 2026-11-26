package dev.west.hud.screen;

import dev.west.hud.Config;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.HudElement;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Rota;
import dev.west.hud.ui.Rota.Kind;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.BooleanSupplier;

/**
 * West menüsü ("Rota"): solda yazılı gezinme, sağda ayar listesi.
 * Sayfalar: Özellikler (HUD öğeleri ve West seçenekleri, aç/kapa satırları), Yüklü modlar, Görünüm, Tercihler;
 * bir HUD öğesinin dişlisine basınca o öğenin ayar sayfası açılır.
 */
public final class MenuScreen implements WestScreen {
    private enum Page { FEATURES, INSTALLED, LOOK, GENERAL }

    private static final String[] PAGE_NAMES = { Tr.t("Özellikler"), Tr.t("Yüklü modlar"), Tr.t("Görünüm"), Tr.t("Tercihler") };
    private static final Icon[] PAGE_ICONS = { Icon.LIST, Icon.BOX, Icon.EDIT, Icon.GEAR };
    private static final String[] CATS = { Tr.t("Tümü"), "HUD", Tr.t("Görsel"), Tr.t("Yardımcı") };

    /** Özellik satırı: HUD öğesi ya da West seçeneği */
    private record Feature(String name, String desc, Icon icon, int cat, BooleanSupplier on, Runnable toggle, HudElement element) {}

    private final Ui ui = new Ui();
    private final Rota.Anim anim = new Rota.Anim();
    private final long opened = System.nanoTime();
    private Page page = Page.FEATURES;
    private int cat;
    private HudElement editing;
    private float scroll, scrollTarget;
    private String search = "";
    private boolean searchFocus;

    public MenuScreen() {}

    /** 0 ya da 3: Özellikler, 1: Görünüm, 2: Tercihler, 4: Yüklü modlar */
    public MenuScreen(int p) {
        this.page = switch (p) {
            case 1 -> Page.LOOK;
            case 2 -> Page.GENERAL;
            case 4 -> Page.INSTALLED;
            default -> Page.FEATURES;
        };
    }

    // ───────── Çerçeve ─────────

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        anim.frame();
        float time = (System.nanoTime() - opened) / 1e9f;
        ui.begin(g, WestHud.theme(), mx, my, time);
        ui.animate = WestHud.config.data.animations;
        int sw = g.width(), sh = g.height();
        float appear = ui.animate ? 1 - (float) Math.pow(1 - Math.min(1, time * 5f), 3) : 1;

        if (!WestHud.game.inWorld()) g.panorama(delta);
        g.blurBehind();
        g.fill(0, 0, sw, sh, (int) (0xA0 * appear) << 24 | 0x06070A);

        int pw = Math.min(680, sw - 16), ph = Math.min(400, sh - 16);
        int px = (sw - pw) / 2, py = (sh - ph) / 2 + Math.round((1 - appear) * 8);
        Rota.window(g, px, py, pw, ph);

        int side = Rota.clamp(pw * 28 / 100, 124, 166);
        sidebar(px, py, side, ph);

        int cx = px + side + 16, cw = pw - side - 32;
        int top = header(g, px, py, pw, cx, cw);
        if (top < 0) { ui.end(); return; }

        int viewH = py + ph - 12 - top;
        scroll += (scrollTarget - scroll) * Math.min(1, anim.dt() * 18);
        g.scissor(cx - 4, top, cx + cw + 4, top + viewH);
        g.push();
        g.translate(0, -Math.round(scroll));
        int realMy = ui.my;
        boolean inside = ui.mx >= cx - 4 && ui.mx < cx + cw + 4 && realMy >= top && realMy < top + viewH;
        ui.my = inside ? my + Math.round(scroll) : -9999;
        int y0 = top + 2;
        int end;
        if (editing != null) end = elementPage(cx, y0, cw);
        else end = switch (page) {
            case FEATURES -> featuresPage(cx, y0, cw);
            case INSTALLED -> installedPage(cx, y0, cw);
            case LOOK -> lookPage(cx, y0, cw);
            case GENERAL -> generalPage(cx, y0, cw);
        };
        ui.my = realMy;
        g.pop();
        g.noScissor();
        int contentH = end - top + 6;
        float max = Math.max(0, contentH - viewH);
        scrollTarget = Math.max(0, Math.min(max, scrollTarget));
        Rota.scrollbar(g, cx + cw + 6, top, viewH, contentH, scroll);
        // İçerik kaydırıldıysa başlığın altında ince çizgi
        if (scroll > 1) Rota.rule(g, cx - 4, top - 1, cw + 8);
        ui.end();
    }

    /** Başlık, alt bilgi, arama ve kapat; içeriğin başladığı y'yi döner (kapatıldıysa -1) */
    private int header(Gfx g, int px, int py, int pw, int cx, int cw) {
        int y = py + 14;
        int tx = cx;
        if (editing != null) {
            if (Rota.iconButton(ui, anim, "back", Icon.BACK, cx - 4, y - 3, 18, 0)) {
                WestHud.game.click();
                editing = null;
                scroll = scrollTarget = 0;
            }
            tx += 18;
        }
        if (Rota.iconButton(ui, anim, "close", Icon.CLOSE, px + pw - 26, py + 8, 18, Rota.DANGER)) {
            WestHud.game.click();
            WestHud.game.closeScreen();
            return -1;
        }
        boolean searchable = editing == null && (page == Page.FEATURES || page == Page.INSTALLED);
        int searchW = searchable ? Rota.clamp(cw * 36 / 100, 90, 180) : 0;
        String title = editing != null ? editing.name : PAGE_NAMES[page.ordinal()];
        Rota.title(g, ui.fit(title, Math.round((cw - searchW - 30) / 1.3f)), tx, y);
        Rota.smallFit(ui, subtitle(), tx, y + 14, cw - searchW - 30, Rota.MUTED);
        if (searchable) {
            int sx = px + pw - 32 - searchW;
            if (Rota.field(ui, search, Tr.t("Ara"), Icon.SEARCH, searchFocus, sx, y - 2, searchW, 18)) searchFocus = true;
            else if (!ui.hover(sx, y - 2, searchW, 18) && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;
        }
        y += 30;
        if (editing == null && page == Page.FEATURES) {
            int chx = cx;
            for (int i = 0; i < CATS.length; i++) {
                if (Rota.chip(ui, CATS[i], chx, y, cat == i) && cat != i) {
                    cat = i;
                    scroll = scrollTarget = 0;
                    WestHud.game.click();
                }
                chx += Rota.chipWidth(g, CATS[i]) + 4;
            }
            y += 22;
        }
        return y;
    }

    private String subtitle() {
        if (editing != null) return editing.description;
        return switch (page) {
            case FEATURES -> {
                int on = 0, all = 0;
                for (Feature f : features()) {
                    all++;
                    if (f.on.getAsBoolean()) on++;
                }
                yield Tr.t("{0} özellikten {1} tanesi açık").replace("{0}", String.valueOf(all)).replace("{1}", String.valueOf(on));
            }
            case INSTALLED -> Tr.t("Bu oyunda {0} mod yüklü").replace("{0}", String.valueOf(WestHud.game.mods().size()));
            case LOOK -> Tr.t("Menülerin ve HUD'un görünüşü");
            case GENERAL -> Tr.t("West Companion ") + WestHud.VERSION;
        };
    }

    private void sidebar(int x, int y, int w, int h) {
        Gfx g = ui.g;
        Rota.side(g, x, y, w, h);
        Icons.draw(g, Icon.LOGO, x + 12, y + 12, 12, ui.t.accent | 0xFF000000);
        g.textBold(ui.fit("West Client", w - 40), x + 29, y + 14, Rota.TEXT, false);

        int ny = y + 38, nx = x + 10, nw = w - 20;
        Rota.section(g, Tr.t("Oyun"), nx + 2, ny);
        ny += 10;
        ny = navItem(Page.FEATURES, nx, ny, nw);
        ny = navItem(Page.INSTALLED, nx, ny, nw);
        ny += 8;
        Rota.section(g, Tr.t("Kişiselleştir"), nx + 2, ny);
        ny += 10;
        ny = navItem(Page.LOOK, nx, ny, nw);
        navItem(Page.GENERAL, nx, ny, nw);

        // Alt: HUD düzenleyici ve oyuncu
        int fy = y + h - 30;
        if (Rota.button(ui, anim, "hud", Tr.t("HUD'u düzenle"), Icon.HUD, Kind.GHOST, nx, fy - 28, nw, 20, true)) {
            WestHud.game.click();
            WestHud.game.openWestScreen(true);
        }
        Rota.rule(g, nx, fy - 1, nw);
        Game game = WestHud.game;
        g.playerFace(nx + 1, fy + 6, 16);
        g.text(ui.fit(game.playerName(), nw - 24), nx + 23, fy + 6, Rota.TEXT, false);
        Rota.smallFit(ui, game.loaderName() + " " + game.minecraftVersion(), nx + 23, fy + 17, nw - 24, Rota.FAINT);
    }

    private int navItem(Page p, int x, int y, int w) {
        boolean active = page == p && (editing == null || p == Page.FEATURES) || editing != null && p == Page.FEATURES;
        float hv = anim.get("nav" + p, ui.hover(x, y, w, 18));
        if (Rota.nav(ui, PAGE_ICONS[p.ordinal()], PAGE_NAMES[p.ordinal()], x, y, w, active, hv, 0, false)) {
            page = p;
            editing = null;
            scroll = scrollTarget = 0;
            search = "";
            WestHud.game.click();
        }
        return y + 20;
    }

    // ───────── Özellikler ─────────

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
            out.add(new Feature(e.name, e.description, icon, 1, () -> e.enabled, () -> e.enabled = !e.enabled, e));
        }
        out.add(new Feature(Tr.t("FullBright"), Tr.t("Karanlıkta da her yer aydınlık."), Icon.SUN, 2, () -> d.fullbright, () -> d.fullbright = !d.fullbright, null));
        out.add(new Feature(Tr.t("Pürüzsüz yazı"), Tr.t("Piksel yazı tipi yerine yumuşak yazı."), Icon.TEXT, 2, () -> d.smoothFont, () -> d.smoothFont = !d.smoothFont, null));
        out.add(new Feature(Tr.t("Animasyonlar"), Tr.t("Menü geçişleri ve tuş parıltıları."), Icon.STAR, 2, () -> d.animations, () -> d.animations = !d.animations, null));
        out.add(new Feature(Tr.t("West ana menüsü"), Tr.t("Başlık ekranı yerine West menüsü."), Icon.LOGO, 3, () -> d.customTitle, () -> d.customTitle = !d.customTitle, null));
        out.add(new Feature(Tr.t("Mıknatıslı hizalama"), Tr.t("Düzenleyicide öğeler kenarlara yapışır."), Icon.MAGNET, 3, () -> d.snapping, () -> d.snapping = !d.snapping, null));
        return out;
    }

    private int featuresPage(int x, int y, int w) {
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<Feature> all = features();
        int cols = w >= 380 ? 2 : 1, gap = 6, rw = (w - gap * (cols - 1)) / cols, rh = 34;
        boolean any = false;
        for (int c = 1; c <= 3; c++) {
            if (cat != 0 && cat != c) continue;
            List<Feature> list = new ArrayList<>();
            for (Feature f : all) {
                if (f.cat != c) continue;
                if (!q.isEmpty() && !f.name.toLowerCase(Locale.ROOT).contains(q)) continue;
                list.add(f);
            }
            if (list.isEmpty()) continue;
            any = true;
            if (cat == 0) {
                Rota.section(ui.g, CATS[c], x + 2, y + 2);
                y += 12;
            }
            for (int i = 0; i < list.size(); i++) {
                featureRow(list.get(i), x + (i % cols) * (rw + gap), y + (i / cols) * (rh + gap), rw, rh);
            }
            y += ((list.size() + cols - 1) / cols) * (rh + gap) + 6;
        }
        if (!any) return y + Rota.empty(ui, Icon.SEARCH, Tr.t("Eşleşen özellik yok"), Tr.t("Başka bir sözcük dene ya da süzgeci kaldır."), x, y + 10, w);
        return y;
    }

    private void featureRow(Feature f, int x, int y, int w, int h) {
        Gfx g = ui.g;
        boolean on = f.on.getAsBoolean();
        float hv = anim.get("row" + f.name, ui.hover(x, y, w, h));
        Rota.card(g, x, y, w, h, hv);
        int acc = ui.t.accent | 0xFF000000;
        Ui.round(g, x + 7, y + 7, 20, 20, Rota.RADIUS_SM, on ? Theme.alpha(acc, 0x2A) : 0x10FFFFFF);
        Icons.draw(g, f.icon, x + 12, y + 12, 10, on ? acc : Rota.MUTED);
        int right = 36 + (f.element != null ? 20 : 0);
        g.text(ui.fit(f.name, w - 40 - right), x + 34, y + 7, Rota.TEXT, false);
        Rota.smallFit(ui, f.desc == null ? "" : f.desc, x + 34, y + 19, w - 40 - right, Rota.FAINT);
        // Önce dişli ve anahtar (tıklamayı onlar alır), sonra satırın kendisi
        if (f.element != null && Rota.iconButton(ui, anim, "gear" + f.name, Icon.GEAR, x + w - 54, y + 8, 18, 0)) {
            WestHud.game.click();
            editing = f.element;
            scroll = scrollTarget = 0;
            return;
        }
        boolean nv = Rota.toggle(ui, on, x + w - 30, y + 11);
        if (nv != on || ui.clicked(x, y, w, h)) {
            f.toggle.run();
            WestHud.save();
            WestHud.game.click();
        }
    }

    // ───────── Yüklü modlar ─────────

    private int installedPage(int x, int y, int w) {
        Gfx g = ui.g;
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<Game.ModInfo> list = new ArrayList<>();
        for (Game.ModInfo m : WestHud.game.mods()) {
            if (!q.isEmpty() && !m.name().toLowerCase(Locale.ROOT).contains(q) && !m.id().toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(m);
        }
        if (list.isEmpty()) return y + Rota.empty(ui, Icon.BOX, Tr.t("Eşleşen mod yok"), Tr.t("Ad ya da kimlikle arayabilirsin."), x, y + 10, w);
        int cols = w >= 380 ? 2 : 1, gap = 6, rw = (w - gap * (cols - 1)) / cols, rh = 30;
        for (int i = 0; i < list.size(); i++) {
            Game.ModInfo m = list.get(i);
            int rx = x + (i % cols) * (rw + gap), ry = y + (i / cols) * (rh + gap);
            float hv = anim.get("mod" + m.id(), ui.hover(rx, ry, rw, rh));
            Rota.card(g, rx, ry, rw, rh, hv);
            String ch = m.name().isEmpty() ? "?" : m.name().substring(0, 1).toUpperCase(Locale.ROOT);
            Ui.round(g, rx + 6, ry + 6, 18, 18, Rota.RADIUS_SM, 0x12FFFFFF);
            g.textBold(ch, rx + 15 - g.textBoldWidth(ch) / 2, ry + 11, Rota.MUTED, false);
            String v = m.version();
            int vw = Math.min(Rota.smallWidth(g, v), rw / 3);
            g.text(ui.fit(m.name(), rw - 42 - vw), rx + 31, ry + 6, Rota.TEXT, false);
            Rota.smallFit(ui, m.id(), rx + 31, ry + 17, rw - 42 - vw, Rota.FAINT);
            Rota.smallFit(ui, v, rx + rw - 8 - vw, ry + 11, vw, Rota.MUTED);
        }
        return y + ((list.size() + cols - 1) / cols) * (rh + gap);
    }

    // ───────── Ayar satırları ─────────

    /** Başlık + açıklama satırı ve altında çizgi; denetim sağa (x + w - …, y + 8 civarı) konur. Yüksekliği 34. */
    private int row(String title, String sub, int x, int y, int w, int controlW) {
        Gfx g = ui.g;
        g.text(ui.fit(title, w - controlW - 12), x, y + (sub == null ? 12 : 6), Rota.TEXT, false);
        if (sub != null) Rota.smallFit(ui, sub, x, y + 18, w - controlW - 12, Rota.FAINT);
        Rota.rule(g, x, y + 33, w);
        return y + 34;
    }

    /** Anahtar satırı; değer değiştiyse yeni değeri döner, değişmediyse aynısını */
    private boolean toggleRow(String title, String sub, boolean value, int x, int y, int w) {
        row(title, sub, x, y, w, 30);
        return Rota.toggle(ui, value, x + w - 24, y + 11);
    }

    // ───────── Öğe ayarları ─────────

    private int elementPage(int x, int y, int w) {
        HudElement e = editing;
        boolean changed = false;
        boolean v;

        v = toggleRow(Tr.t("Göster"), Tr.t("Öğeyi HUD'da göster."), e.enabled, x, y, w);
        if (v != e.enabled) { e.enabled = v; changed = true; }
        y += 34;

        row(Tr.t("Boyut"), String.format(Locale.ROOT, "%%%d", Math.round(e.scale * 100)), x, y, w, 110);
        float s = ui.slider(e, e.scale, 0.5f, 2.5f, x + w - 104, y + 15, 100);
        if (Math.abs(s - e.scale) > 0.001f) { e.scale = Math.round(s * 20) / 20f; changed = true; }
        y += 34;

        v = toggleRow(Tr.t("Arka plan"), Tr.t("Öğenin arkasında yarı saydam kutu."), e.background, x, y, w);
        if (v != e.background) { e.background = v; changed = true; }
        y += 34;

        v = toggleRow(Tr.t("Yazı gölgesi"), Tr.t("Açık zeminlerde okunurluğu artırır."), e.shadow, x, y, w);
        if (v != e.shadow) { e.shadow = v; changed = true; }
        y += 34;

        int[] colors = { 0xFFFFFF, 0xE8A25C, 0x6EA8D6, 0x70C48E, 0xEC5A82, 0xF2C14E, 0xA08CB8, 0x111111 };
        row(Tr.t("Yazı rengi"), null, x, y, w, colors.length * 15);
        for (int i = 0; i < colors.length; i++) {
            int sx = x + w - (colors.length - i) * 15 + 2;
            if (ui.swatch(colors[i], e.color == colors[i], sx, y + 12, 10)) { e.color = colors[i]; changed = true; }
            Ui.outline(ui.g, sx, y + 12, 10, 10, 5, Rota.LINE_STRONG);
        }
        y += 34;

        if (e == WestHud.HUD.keystrokes) {
            var k = WestHud.HUD.keystrokes;
            v = toggleRow(Tr.t("Fare tuşları"), Tr.t("Sol/sağ tık ve CPS."), k.showMouse, x, y, w);
            if (v != k.showMouse) { k.showMouse = v; changed = true; }
            y += 34;
            v = toggleRow(Tr.t("Boşluk tuşu"), null, k.showSpace, x, y, w);
            if (v != k.showSpace) { k.showSpace = v; changed = true; }
            y += 34;
        }
        if (e == WestHud.HUD.armor) {
            v = toggleRow(Tr.t("Eldeki eşya"), Tr.t("Ana eldeki eşyayı da göster."), WestHud.HUD.armor.showHand, x, y, w);
            if (v != WestHud.HUD.armor.showHand) { WestHud.HUD.armor.showHand = v; changed = true; }
            y += 34;
        }

        y += 10;
        String a = Tr.t("Konumunu düzenle"), b = Tr.t("Varsayılana dön");
        int aw = Rota.buttonWidth(ui.g, a, Icon.HUD), bw = Rota.buttonWidth(ui.g, b, null);
        if (Rota.button(ui, anim, "pos", a, Icon.HUD, Kind.PRIMARY, x, y, aw, 20, true)) {
            WestHud.game.click();
            WestHud.game.openWestScreen(true);
        }
        if (Rota.button(ui, anim, "reset", b, null, Kind.GHOST, x + aw + 6, y, bw, 20, true)) {
            WestHud.game.click();
            e.resetLayout();
            changed = true;
        }
        if (changed) WestHud.save();
        return y + 26;
    }

    // ───────── Görünüm ─────────

    private int lookPage(int x, int y, int w) {
        Gfx g = ui.g;
        Config.Data d = WestHud.config.data;
        boolean changed = false;
        Rota.section(g, Tr.t("Tema"), x + 2, y + 2);
        y += 12;
        String[] ids = { "night", "day", "pixel-night", "pixel-day" };
        String[] names = { Tr.t("Gece"), Tr.t("Gündüz"), Tr.t("Piksel gece"), Tr.t("Piksel gündüz") };
        int cols = w >= 360 ? 4 : 2, gap = 6, tw = (w - gap * (cols - 1)) / cols, th = 64;
        for (int i = 0; i < ids.length; i++) {
            int ex = x + (i % cols) * (tw + gap), ey = y + (i / cols) * (th + gap);
            Theme p = Theme.of(ids[i], d.accent);
            boolean sel = d.theme.equals(ids[i]);
            float hv = anim.get("theme" + i, ui.hover(ex, ey, tw, th));
            Rota.card(g, ex, ey, tw, th, hv);
            if (sel) Ui.outline(g, ex, ey, tw, th, Rota.RADIUS, ui.t.accent | 0xFF000000);
            // Önizleme: o temanın paneli, kenar çubuğu ve vurgu satırları
            int vx = ex + 6, vy = ey + 6, vw = tw - 12, vh = th - 26;
            Ui.round(g, vx, vy, vw, vh, p.pixel ? 0 : 4, 0xFF000000 | (p.panel & 0xFFFFFF));
            g.fill(vx, vy, vx + vw / 4, vy + vh, 0xFF000000 | (p.side & 0xFFFFFF));
            for (int r = 0; r < 3; r++) {
                int lw = (vw - vw / 4 - 10) * (r == 0 ? 3 : r == 1 ? 2 : 4) / 4;
                g.fill(vx + vw / 4 + 5, vy + 5 + r * 9, vx + vw / 4 + 5 + lw, vy + 9 + r * 9, r == 0 ? (p.accent | 0xFF000000) : Theme.alpha(p.text, 0x60));
            }
            if (sel) Icons.draw(g, Icon.CHECK, ex + 6, ey + th - 15, 9, ui.t.accent | 0xFF000000);
            g.text(ui.fit(names[i], tw - (sel ? 24 : 12)), ex + (sel ? 18 : 6), ey + th - 14, sel ? Rota.TEXT : Rota.MUTED, false);
            if (ui.clicked(ex, ey, tw, th) && !sel) {
                d.theme = ids[i];
                changed = true;
                WestHud.game.click();
            }
        }
        y += ((ids.length + cols - 1) / cols) * (th + gap) + 8;

        Rota.section(g, Tr.t("Ayrıntılar"), x + 2, y + 2);
        y += 10;
        row(Tr.t("Vurgu rengi"), Tr.t("Seçili öğeler, birincil düğmeler ve HUD etiketleri."), x, y, w, Theme.ACCENTS.length * 15);
        for (int i = 0; i < Theme.ACCENTS.length; i++) {
            int c = Theme.ACCENTS[i];
            if (ui.swatch(c, (d.accent & 0xFFFFFF) == c, x + w - (Theme.ACCENTS.length - i) * 15 + 2, y + 12, 10)) { d.accent = c; changed = true; }
        }
        y += 34;
        boolean v = toggleRow(Tr.t("Animasyonlar"), Tr.t("Menü geçişleri ve tuş göstergesi parıltıları."), d.animations, x, y, w);
        if (v != d.animations) { d.animations = v; changed = true; }
        y += 34;
        v = toggleRow(Tr.t("Pürüzsüz yazı tipi"), Tr.t("Kapatırsan Minecraft'ın piksel yazı tipi kullanılır."), d.smoothFont, x, y, w);
        if (v != d.smoothFont) { d.smoothFont = v; changed = true; }
        y += 34;
        v = toggleRow(Tr.t("Mıknatıslı hizalama"), Tr.t("Düzenleyicide öğeler kenarlara ve birbirine yapışır."), d.snapping, x, y, w);
        if (v != d.snapping) { d.snapping = v; changed = true; }
        y += 34;
        if (changed) WestHud.save();
        return y;
    }

    // ───────── Tercihler ─────────

    private int generalPage(int x, int y, int w) {
        Config.Data d = WestHud.config.data;
        boolean changed = false, v;
        Rota.section(ui.g, Tr.t("Oyun"), x + 2, y + 2);
        y += 10;
        v = toggleRow(Tr.t("FullBright"), Tr.t("Mağarada bile her yer aydınlık. Bazı sunucular buna izin vermez."), d.fullbright, x, y, w);
        if (v != d.fullbright) { d.fullbright = v; changed = true; }
        y += 34;
        v = toggleRow(Tr.t("West ana menüsü"), Tr.t("Minecraft'ın başlık ekranı yerine West Client ana menüsü."), d.customTitle, x, y, w);
        if (v != d.customTitle) { d.customTitle = v; changed = true; }
        y += 34;
        row(Tr.t("Menü tuşu"), Tr.t("Kontroller → West Companion'dan değiştirebilirsin."), x, y, w, 70);
        String key = Tr.t("Sağ Shift");
        int kw = g().textWidth(key) + 12;
        Ui.round(g(), x + w - kw, y + 9, kw, 16, Rota.RADIUS_SM, 0x12FFFFFF);
        Ui.outline(g(), x + w - kw, y + 9, kw, 16, Rota.RADIUS_SM, Rota.LINE);
        g().text(key, x + w - kw + 6, y + 13, Rota.MUTED, false);
        y += 34 + 8;

        Rota.section(ui.g, Tr.t("Müzik"), x + 2, y + 2);
        y += 10;
        v = toggleRow(Tr.t("Arka plan müziği"), Tr.t("West müziği menülerde çalar. Ses düzeyi: Minecraft → Müzik."), d.music, x, y, w);
        if (v != d.music) { d.music = v; changed = true; }
        y += 34;
        v = toggleRow(Tr.t("Oyunda da çal"), Tr.t("Dünyadayken Minecraft'ın kendi müziğinin yerine."), d.musicInGame, x, y, w);
        if (v != d.musicInGame) { d.musicInGame = v; changed = true; }
        y += 34 + 8;

        Rota.section(ui.g, Tr.t("Sıfırla"), x + 2, y + 2);
        y += 10;
        String r = Tr.t("Sıfırla");
        int rw = Rota.buttonWidth(g(), r, null);
        row(Tr.t("Tüm HUD'u sıfırla"), Tr.t("Bütün öğeleri varsayılan konum ve boyuta döndürür."), x, y, w, rw);
        if (Rota.button(ui, anim, "resetall", r, null, Kind.DANGER, x + w - rw, y + 7, rw, 20, true)) {
            WestHud.game.click();
            for (HudElement e : WestHud.HUD.elements) e.resetLayout();
            changed = true;
        }
        y += 34 + 10;
        Rota.smallFit(ui, Tr.t("Launcher'dan değiştirdiğin ayarlar da burada canlı uygulanır."), x, y, w, Rota.FAINT);
        if (changed) {
            WestHud.save();
            WestHud.game.click();
        }
        return y + 14;
    }

    private Gfx g() {
        return ui.g;
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
        scrollTarget -= (float) amount * 30;
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
        if (searchFocus && c >= 32 && search.length() < 40) {
            search += c;
            scroll = scrollTarget = 0;
        }
    }

    @Override
    public WestScreen escape() {
        if (searchFocus) {
            searchFocus = false;
            return this;
        }
        if (editing != null) {
            editing = null;
            return this;
        }
        return null;
    }
}
