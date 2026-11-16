package dev.west.hud.screen;

import dev.west.hud.Config;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.Hud;
import dev.west.hud.hud.HudElement;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.List;
import java.util.Locale;

/** West menüsü: HUD öğeleri, öğe ayarları, görünüm, genel ve modlar. */
public final class MenuScreen implements WestScreen {
    private enum Page { HUD, LOOK, GENERAL, MODS }

    private static final String[] PAGE_NAMES = { "HUD öğeleri", "Görünüm", "Genel", "Modlar" };
    private final Ui ui = new Ui();
    private Page page = Page.HUD;
    private HudElement editing;
    private float scroll, scrollTarget;
    private int contentH;
    private final long opened = System.nanoTime();
    private String search = "";
    private boolean searchFocus;

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        int sw = g.width(), sh = g.height();
        float appear = ui.animate ? Math.min(1, time * 6f) : 1;

        g.fill(0, 0, sw, sh, Theme.alpha(t.backdrop, (int) ((t.backdrop >>> 24) * appear)));
        g.blurBehind();

        int pw = Math.min(560, sw - 20), ph = Math.min(330, sh - 20);
        int px = (sw - pw) / 2, py = (sh - ph) / 2 + Math.round((1 - appear) * 10);
        // Gölge + panel
        ui.rect(px - 1, py + 2, pw + 2, ph + 2, 0x55000000, t.radius + 2);
        ui.rect(px, py, pw, ph, t.panel, t.radius + 2);
        ui.border(px, py, pw, ph, t.line);

        int side = Math.min(120, pw / 4);
        sidebar(px, py, side, ph);
        int cx = px + side + 12, cy = py + 12, cw = pw - side - 24, ch = ph - 24;

        // Başlık
        String title = editing != null ? editing.name : PAGE_NAMES[page.ordinal()];
        if (editing != null) {
            if (ui.button("‹", cx, cy - 1, 14, 14, false)) editing = null;
            ui.text(title, cx + 20, cy + 2, t.text);
        } else ui.text(title, cx, cy + 2, t.text);
        if (ui.button("✕", px + pw - 22, py + 8, 14, 14, false)) {
            WestHud.game.closeScreen();
            ui.end();
            return;
        }

        int top = cy + 22;
        int viewH = ch - 22;
        scroll += (scrollTarget - scroll) * (ui.animate ? 0.35f : 1f);
        g.scissor(cx, top, cx + cw, top + viewH);
        g.push();
        g.translate(0, -Math.round(scroll));
        // Kaydırılmış içerikte fare konumu
        int realMy = ui.my;
        ui.my = my + Math.round(scroll);
        boolean inside = ui.mx >= cx && ui.mx < cx + cw && realMy >= top && realMy < top + viewH;
        if (!inside) ui.my = -9999;
        int end;
        if (editing != null) end = elementPage(cx, top, cw);
        else end = switch (page) {
            case HUD -> hudPage(cx, top, cw);
            case LOOK -> lookPage(cx, top, cw);
            case GENERAL -> generalPage(cx, top, cw);
            case MODS -> modsPage(cx, top, cw);
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
            ui.rect(cx + cw + 4, barY, 3, barH, Theme.alpha(t.text, 70), 1);
        }
        ui.end();
    }

    private void sidebar(int x, int y, int w, int h) {
        Theme t = ui.t;
        ui.rect(x, y, w, h, t.side, t.radius + 2);
        Gfx g = ui.g;
        g.textBold("◆", x + 10, y + 12, t.accent, false);
        g.textBold("West", x + 20, y + 12, t.text, false);
        if (20 + g.textBoldWidth("West Companion") < w - 6) g.textBold("Companion", x + 20 + g.textBoldWidth("West "), y + 12, t.accent, false);
        else g.textBold("Client", x + 20 + g.textBoldWidth("West "), y + 12, t.accent, false);

        int by = y + 32;
        // Öne çıkan eylem: HUD düzenleyici
        if (ui.button("HUD'u düzenle", x + 8, by, w - 16, 18, true)) {
            WestHud.game.openWestScreen(true);
            return;
        }
        by += 28;
        ui.text("AYARLAR", x + 10, by, t.muted);
        by += 12;
        for (Page p : Page.values()) {
            boolean on = editing == null && page == p || (editing != null && p == Page.HUD);
            boolean hov = ui.hover(x + 6, by, w - 12, 17);
            if (on) ui.rect(x + 6, by, w - 12, 17, Theme.alpha(t.accent, 60));
            else if (hov) ui.rect(x + 6, by, w - 12, 17, t.cardHover);
            if (on) ui.rect(x + 6, by + 3, 2, 11, t.accent, 1);
            ui.text(PAGE_NAMES[p.ordinal()], x + 14, by + 5, on ? t.text : t.muted);
            if (ui.clicked(x + 6, by, w - 12, 17)) {
                page = p;
                editing = null;
                scroll = scrollTarget = 0;
                WestHud.game.click();
            }
            by += 19;
        }
        // Alt bilgi
        Game game = WestHud.game;
        String v = game.loaderName() + " " + game.minecraftVersion();
        ui.text(ui.fit(v, w - 16), x + 10, y + h - 14, t.muted);
    }

    // ───────── Sayfalar ─────────

    private int hudPage(int x, int y, int w) {
        Theme t = ui.t;
        Hud hud = WestHud.HUD;
        int cols = w >= 380 ? 3 : 2;
        int gap = 6, cw = (w - gap * (cols - 1)) / cols, chh = 44;
        int i = 0;
        for (HudElement e : hud.elements) {
            int col = i % cols, row = i / cols;
            int ex = x + col * (cw + gap), ey = y + row * (chh + gap);
            boolean hov = ui.hover(ex, ey, cw, chh);
            ui.rect(ex, ey, cw, chh, hov ? t.cardHover : t.card);
            if (e.enabled) ui.rect(ex, ey, 2, chh, t.accent, 1);
            ui.text(ui.fit(e.name, cw - 40), ex + 8, ey + 8, t.text);
            ui.g.push();
            ui.g.translate(ex + 8, ey + 22);
            ui.g.scale(0.75f);
            ui.text(ui.fit(e.description, (int) ((cw - 16) / 0.75f)), 0, 0, t.muted);
            ui.text("Ayarlar ›", 0, 12, hov ? t.accent : Theme.alpha(t.muted, 160));
            ui.g.pop();
            boolean on = ui.toggle(e.enabled, ex + cw - 30, ey + 7);
            if (on != e.enabled) {
                e.enabled = on;
                WestHud.save();
                WestHud.game.click();
            } else if (ui.clicked(ex, ey, cw, chh)) {
                editing = e;
                scroll = scrollTarget = 0;
                WestHud.game.click();
            }
            i++;
        }
        int rows = (hud.elements.size() + cols - 1) / cols;
        return y + rows * (chh + gap);
    }

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

    private int modsPage(int x, int y, int w) {
        Theme t = ui.t;
        // Arama kutusu
        boolean hov = ui.hover(x, y, w, 18);
        ui.rect(x, y, w, 18, searchFocus ? t.cardHover : t.card);
        ui.border(x, y, w, 18, searchFocus ? Theme.alpha(t.accent, 180) : t.line);
        String shown = search.isEmpty() && !searchFocus ? "Mod ara…" : search + (searchFocus && ((int) (ui.time * 2)) % 2 == 0 ? "_" : "");
        ui.text(shown, x + 6, y + 5, search.isEmpty() && !searchFocus ? t.muted : t.text);
        if (ui.clicked(x, y, w, 18)) searchFocus = true;
        else if (!hov && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;
        y += 24;
        List<Game.ModInfo> mods = WestHud.game.mods();
        String q = search.toLowerCase(Locale.ROOT);
        int n = 0;
        for (Game.ModInfo m : mods) {
            if (!q.isEmpty() && !m.name().toLowerCase(Locale.ROOT).contains(q) && !m.id().toLowerCase(Locale.ROOT).contains(q)) continue;
            ui.rect(x, y, w, 22, n % 2 == 0 ? t.card : 0);
            ui.text(ui.fit(m.name(), w / 2), x + 6, y + 7, t.text);
            String v = ui.fit(m.version(), w / 3);
            ui.text(v, x + w - 6 - ui.g.textWidth(v), y + 7, t.muted);
            y += 23;
            n++;
        }
        if (n == 0) ui.text("Eşleşen mod yok.", x, y, t.muted);
        return y + 4;
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
        scrollTarget -= (float) amount * 24;
    }

    @Override
    public boolean keyPressed(int key) {
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) search = search.substring(0, search.length() - 1); // backspace
        else if (key == 256 || key == 257) searchFocus = false; // esc, enter
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
