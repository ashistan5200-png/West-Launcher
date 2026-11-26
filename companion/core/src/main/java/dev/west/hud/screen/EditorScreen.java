package dev.west.hud.screen;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.Hud;
import dev.west.hud.hud.HudElement;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Rota;
import dev.west.hud.ui.Rota.Kind;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * HUD düzenleyici ("Rota"): öğeleri sürükle, tekerlekle boyutlandır, ok tuşlarıyla 1 piksel kaydır.
 * Kenarlara, ekran ortasına ve diğer öğelere mıknatıslı hizalanır; hizalama çizgisi görünür.
 * Üstte ortada araç şeridi (ipucu, Öğeler, Bitti); seçili öğenin yanında hızlı araçlar; sağda ayar paneli.
 */
public final class EditorScreen implements WestScreen {
    private static final int SNAP = 4;
    private final WestScreen back;
    private final Ui ui = new Ui();
    private final Rota.Anim anim = new Rota.Anim();
    private final Map<HudElement, int[]> boxes = new HashMap<>();
    /** Bu karede çizilen panellerin alanları: tıklama öğeye değil panele gider */
    private final List<int[]> panels = new ArrayList<>();
    private HudElement selected, dragging;
    private int dragOffX, dragOffY;
    private int guideX = -1, guideY = -1;
    private boolean listOpen;
    /** Öğe listesinin kaydırması ve alanı (kısa ekranlarda liste sığmayabilir) */
    private int listScroll;
    private int[] listRect;
    private boolean done;
    private int lastW, lastH;
    private final long opened = System.nanoTime();

    public EditorScreen(WestScreen back) {
        this.back = back;
        WestHud.editorOpen = true;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        anim.frame();
        Theme t = WestHud.theme();
        ui.begin(g, t, mx, my, (System.nanoTime() - opened) / 1e9f);
        int sw = g.width(), sh = g.height();
        lastW = sw;
        lastH = sh;
        panels.clear();
        listRect = null;
        int acc = t.accent | 0xFF000000;

        if (!WestHud.game.inWorld()) g.panorama(delta);
        g.fill(0, 0, sw, sh, 0x58000000);
        // Ekranın ortası (sürüklerken daha belirgin)
        int mid = dragging != null ? 0x22FFFFFF : 0x0FFFFFFF;
        g.fill(sw / 2, 0, sw / 2 + 1, sh, mid);
        g.fill(0, sh / 2, sw, sh / 2 + 1, mid);

        if (dragging != null) drag(mx, my, sw, sh);
        if (guideX >= 0) g.fill(guideX, 0, guideX + 1, sh, Theme.alpha(acc, 0xD0));
        if (guideY >= 0) g.fill(0, guideY, sw, guideY + 1, Theme.alpha(acc, 0xD0));

        // Öğeler ve çerçeveleri
        boxes.clear();
        HudElement hovered = null;
        for (HudElement e : WestHud.HUD.elements) {
            if (!e.enabled) continue;
            int[] b = Hud.drawElement(g, WestHud.game, t, e, sw, sh);
            boxes.put(e, b);
            if (ui.hover(b[0], b[1], b[2], b[3])) hovered = e;
        }
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            HudElement e = en.getKey();
            boolean sel = e == selected;
            float hv = anim.get("box" + e.id, e == hovered || sel);
            int c = sel ? acc : Theme.mix(0x30FFFFFF, 0x90FFFFFF, hv);
            frame(g, b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4, c);
            if (sel) corners(g, b[0] - 2, b[1] - 2, b[2] + 4, b[3] + 4, acc);
        }

        if (selected != null && boxes.containsKey(selected) && dragging == null) quickTools(selected, boxes.get(selected), sw, sh);
        topBar(sw);
        if (selected != null) settings(selected, sw, sh);
        else if (listOpen) elementList(sw, sh);
        ui.end();
        if (done) {
            // Oyundaysan doğrudan oyuna dön, menüden geldiysen West menüsüne
            WestHud.editorOpen = false;
            WestHud.save();
            if (WestHud.game.inWorld()) WestHud.game.closeScreen();
            else WestHud.game.openWestScreen(false);
        }
    }

    private void drag(int mx, int my, int sw, int sh) {
        int[] b = boxes.get(dragging);
        if (b == null) return;
        int nx = mx - dragOffX, ny = my - dragOffY;
        guideX = guideY = -1;
        if (WestHud.config.data.snapping) {
            int[] s = snap(nx, ny, b[2], b[3], sw, sh);
            nx = s[0];
            ny = s[1];
        }
        nx = Math.max(0, Math.min(sw - b[2], nx));
        ny = Math.max(0, Math.min(sh - b[3], ny));
        dragging.setPixelPos(nx, ny, sw, sh);
    }

    private static void frame(Gfx g, int x, int y, int w, int h, int c) {
        g.fill(x, y, x + w, y + 1, c);
        g.fill(x, y + h - 1, x + w, y + h, c);
        g.fill(x, y + 1, x + 1, y + h - 1, c);
        g.fill(x + w - 1, y + 1, x + w, y + h - 1, c);
    }

    /** Seçili öğenin dört köşesinde küçük kareler */
    private static void corners(Gfx g, int x, int y, int w, int h, int c) {
        for (int[] p : new int[][] { { x, y }, { x + w, y }, { x, y + h }, { x + w, y + h } }) {
            g.fill(p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2, 0xFF0E0F13);
            g.fill(p[0] - 1, p[1] - 1, p[0] + 1, p[1] + 1, c);
        }
    }

    /** Kenarlara, ortaya ve diğer öğelerin kenarlarına yapıştır. */
    private int[] snap(int x, int y, int w, int h, int sw, int sh) {
        int[] xs = { 2, sw - 2, sw / 2 }, ys = { 2, sh - 2, sh / 2 };
        int bestX = x, bestY = y, dx = SNAP + 1, dy = SNAP + 1;
        for (int target : xs) {
            for (int edge : new int[] { 0, w, w / 2 }) {
                int cand = target - edge, d = Math.abs(x - cand);
                if (d < dx) { dx = d; bestX = cand; guideX = target; }
            }
        }
        for (int target : ys) {
            for (int edge : new int[] { 0, h, h / 2 }) {
                int cand = target - edge, d = Math.abs(y - cand);
                if (d < dy) { dy = d; bestY = cand; guideY = target; }
            }
        }
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            if (en.getKey() == dragging) continue;
            int[] o = en.getValue();
            for (int tx : new int[] { o[0], o[0] + o[2] }) for (int edge : new int[] { 0, w }) {
                int cand = tx - edge, d = Math.abs(x - cand);
                if (d < dx) { dx = d; bestX = cand; guideX = tx; }
            }
            for (int ty : new int[] { o[1], o[1] + o[3] }) for (int edge : new int[] { 0, h }) {
                int cand = ty - edge, d = Math.abs(y - cand);
                if (d < dy) { dy = d; bestY = cand; guideY = ty; }
            }
        }
        if (dx > SNAP) { bestX = x; guideX = -1; }
        if (dy > SNAP) { bestY = y; guideY = -1; }
        return new int[] { bestX, bestY };
    }

    // ───────── Seçili öğenin hızlı araçları ─────────

    private void quickTools(HudElement e, int[] b, int sw, int sh) {
        Gfx g = ui.g;
        // Boyut etiketi
        String size = Math.round(e.scale * 100) + "%  ·  " + b[2] + "×" + b[3];
        int lw = Rota.smallWidth(g, size) + 8;
        int ly = b[1] - 16 >= 30 ? b[1] - 16 : b[1] + b[3] + 5;
        int lx = Rota.clamp(b[0] + (b[2] - lw) / 2, 2, sw - lw - 2);
        Ui.round(g, lx, ly, lw, 11, 5, ui.t.accent | 0xFF000000);
        Rota.small(g, size, lx + 4, ly + 2, ui.t.onAccent);

        // Araç şeridi: küçült, büyüt, varsayılan, gizle
        int s = 16, n = 4, tw = n * s + (n - 1) * 2 + 6, th = s + 6;
        int tx = Rota.clamp(b[0] + (b[2] - tw) / 2, 2, sw - tw - 2);
        int ty = ly > b[1] ? ly + 14 : b[1] + b[3] + 5;
        if (ty + th > sh - 2) ty = Math.max(30, b[1] - th - 18);
        Rota.window(g, tx, ty, tw, th);
        panels.add(new int[] { tx, ty, tw, th });
        int bx = tx + 3, by = ty + 3;
        // Küçült: simge kitinde eksi yok, çizgiyle çizilir
        boolean hv0 = ui.hover(bx, by, s, s);
        float k0 = anim.get("qminus", hv0);
        if (k0 > 0.01f) Ui.round(g, bx, by, s, s, Rota.RADIUS_SM, Theme.alpha(0xFFFFFFFF, (int) (0x18 * k0)));
        g.fill(bx + 4, by + 7, bx + s - 4, by + 9, Theme.mix(Rota.MUTED, Rota.TEXT, k0));
        if (ui.clicked(bx, by, s, s)) scale(e, -0.1f);
        bx += s + 2;
        if (Rota.iconButton(ui, anim, "qplus", Icon.PLUS, bx, by, s, 0)) scale(e, 0.1f);
        bx += s + 2;
        if (Rota.iconButton(ui, anim, "qreset", Icon.REFRESH, bx, by, s, 0)) {
            e.resetLayout();
            WestHud.save();
        }
        bx += s + 2;
        if (Rota.iconButton(ui, anim, "qhide", Icon.CLOSE, bx, by, s, Rota.DANGER)) {
            e.enabled = false;
            selected = null;
            WestHud.save();
        }
        // İpucu
        String[] tips = { Tr.t("Küçült"), Tr.t("Büyüt"), Tr.t("Varsayılan konum"), Tr.t("Gizle") };
        for (int i = 0; i < n; i++) {
            int ix = tx + 3 + i * (s + 2);
            if (!ui.hover(ix, by, s, s)) continue;
            int w = g.textWidth(tips[i]) + 10;
            int px = Rota.clamp(ix + s / 2 - w / 2, 2, sw - w - 2), py = ty + th + 3;
            Ui.round(g, px, py, w, 14, 5, 0xF0000000);
            g.text(tips[i], px + 5, py + 3, Rota.TEXT, false);
        }
    }

    private void scale(HudElement e, float d) {
        e.scale = Math.max(0.5f, Math.min(2.5f, Math.round((e.scale + d) * 20) / 20f));
        WestHud.save();
    }

    // ───────── Üst şerit ─────────

    private void topBar(int sw) {
        Gfx g = ui.g;
        String list = listOpen && selected == null ? Tr.t("Listeyi kapat") : Tr.t("Öğeler");
        String ok = Tr.t("Bitti");
        int lw = Rota.buttonWidth(g, list, Icon.LIST), ow = Rota.buttonWidth(g, ok, Icon.CHECK);
        String full = Tr.t("Sürükle: taşı · Tekerlek: boyut · Oklar: ince ayar");
        String hint = Tr.t("Sürükle · Tekerlek · Oklar");
        int fixed = 24 + lw + ow + 16;
        String shown = Rota.smallWidth(g, full) + fixed <= sw - 16 ? full : Rota.smallWidth(g, hint) + fixed <= sw - 16 ? hint : "";
        int w = fixed + (shown.isEmpty() ? 0 : Rota.smallWidth(g, shown) + 10);
        int x = (sw - w) / 2, y = 4, h = 26;
        Rota.window(g, x, y, w, h);
        panels.add(new int[] { x, y, w, h });
        Icons.draw(g, Icon.HUD, x + 9, y + 8, 10, ui.t.accent | 0xFF000000);
        int cx = x + 24;
        if (!shown.isEmpty()) {
            Rota.small(g, shown, cx, y + 10, Rota.MUTED);
            cx += Rota.smallWidth(g, shown) + 10;
        }
        if (Rota.button(ui, anim, "list", list, Icon.LIST, Kind.GHOST, cx, y + 4, lw, 18, true)) {
            WestHud.game.click();
            if (selected != null) {
                selected = null;
                listOpen = true;
            } else listOpen = !listOpen;
        }
        if (Rota.button(ui, anim, "done", ok, Icon.CHECK, Kind.PRIMARY, cx + lw + 6, y + 4, ow, 18, true)) {
            WestHud.game.click();
            done = true;
        }
    }

    // ───────── Sağ paneller ─────────

    private void elementList(int sw, int sh) {
        Gfx g = ui.g;
        List<HudElement> els = WestHud.HUD.elements;
        int rowH = 20, w = 150, x = sw - w - 6, y = 36;
        int h = Math.min(sh - y - 6, 30 + els.size() * rowH + 6);
        Rota.window(g, x, y, w, h);
        panels.add(new int[] { x, y, w, h });
        g.textBold(Tr.t("Öğeler"), x + 10, y + 10, Rota.TEXT, false);
        int on = 0;
        for (HudElement e : els) if (e.enabled) on++;
        String c = on + "/" + els.size();
        Rota.small(g, c, x + w - 10 - Rota.smallWidth(g, c), y + 11, Rota.FAINT);
        listRect = new int[] { x, y, w, h };
        int viewH = y + h - 4 - (y + 26);
        listScroll = Math.max(0, Math.min(listScroll, els.size() * rowH - viewH));
        int ry = y + 26 - listScroll;
        g.scissor(x, y + 26, x + w, y + h - 4);
        int realMy = ui.my;
        if (ui.my < y + 26 || ui.my >= y + h - 4) ui.my = -9999;
        for (HudElement e : els) {
            if (ry + rowH <= y + 26 || ry >= y + h - 4) {
                ry += rowH;
                continue;
            }
            boolean sel = e == selected;
            float hv = anim.get("li" + e.id, ui.hover(x + 4, ry, w - 8, rowH));
            if (sel || hv > 0.01f) Ui.round(g, x + 4, ry, w - 8, rowH, Rota.RADIUS_SM, sel ? 0x14FFFFFF : Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x0D * hv))));
            g.text(ui.fit(e.name, w - 50), x + 10, ry + 6, e.enabled ? Rota.TEXT : Rota.FAINT, false);
            boolean nv = Rota.toggle(ui, e.enabled, x + w - 32, ry + 4);
            if (nv != e.enabled) {
                e.enabled = nv;
                if (nv) selected = e;
                WestHud.save();
                WestHud.game.click();
            } else if (e.enabled && ui.clicked(x + 4, ry, w - 44, rowH)) {
                selected = e;
                WestHud.game.click();
            }
            ry += rowH;
        }
        ui.my = realMy;
        g.noScissor();
        Rota.scrollbar(g, x + w - 4, y + 26, viewH, els.size() * rowH, listScroll);
    }

    private void settings(HudElement e, int sw, int sh) {
        Gfx g = ui.g;
        int w = 160, x = sw - w - 6, y = 36;
        int extra = (e == WestHud.HUD.keystrokes ? 2 : 0) + (e == WestHud.HUD.armor ? 1 : 0);
        int h = 30 + 30 + 3 * 22 + extra * 22 + 30;
        Rota.window(g, x, y, w, h);
        panels.add(new int[] { x, y, w, h });
        g.textBold(ui.fit(e.name, w - 36), x + 10, y + 10, Rota.TEXT, false);
        if (Rota.iconButton(ui, anim, "sclose", Icon.CLOSE, x + w - 22, y + 5, 16, 0)) {
            selected = null;
            return;
        }
        Rota.rule(g, x + 8, y + 25, w - 16);
        int ix = x + 10, iw = w - 20, ry = y + 32;
        boolean changed = false;

        g.text(Tr.t("Boyut"), ix, ry, Rota.MUTED, false);
        String pct = String.format(Locale.ROOT, "%d%%", Math.round(e.scale * 100));
        g.text(pct, ix + iw - g.textWidth(pct), ry, Rota.TEXT, false);
        float s = ui.slider(e, e.scale, 0.5f, 2.5f, ix + 2, ry + 15, iw - 4);
        if (Math.abs(s - e.scale) > 0.001f) e.scale = Math.round(s * 20) / 20f;
        ry += 28;

        boolean v;
        v = toggleLine(Tr.t("Göster"), e.enabled, ix, ry, iw);
        if (v != e.enabled) { e.enabled = v; changed = true; }
        ry += 22;
        v = toggleLine(Tr.t("Arka plan"), e.background, ix, ry, iw);
        if (v != e.background) { e.background = v; changed = true; }
        ry += 22;
        v = toggleLine(Tr.t("Yazı gölgesi"), e.shadow, ix, ry, iw);
        if (v != e.shadow) { e.shadow = v; changed = true; }
        ry += 22;
        if (e == WestHud.HUD.keystrokes) {
            var k = WestHud.HUD.keystrokes;
            v = toggleLine(Tr.t("Fare tuşları"), k.showMouse, ix, ry, iw);
            if (v != k.showMouse) { k.showMouse = v; changed = true; }
            ry += 22;
            v = toggleLine(Tr.t("Boşluk tuşu"), k.showSpace, ix, ry, iw);
            if (v != k.showSpace) { k.showSpace = v; changed = true; }
            ry += 22;
        }
        if (e == WestHud.HUD.armor) {
            v = toggleLine(Tr.t("Eldeki eşya"), WestHud.HUD.armor.showHand, ix, ry, iw);
            if (v != WestHud.HUD.armor.showHand) { WestHud.HUD.armor.showHand = v; changed = true; }
            ry += 22;
        }
        int[] colors = { 0xFFFFFF, 0xE8A25C, 0x6EA8D6, 0x70C48E, 0xEC5A82, 0xF2C14E, 0x111111 };
        int step = Math.min(15, iw / colors.length);
        for (int i = 0; i < colors.length; i++) {
            int sx = ix + 1 + i * step;
            if (ui.swatch(colors[i], e.color == colors[i], sx, ry + 4, 10)) { e.color = colors[i]; changed = true; }
            Ui.outline(g, sx, ry + 4, 10, 10, 5, Rota.LINE_STRONG);
        }
        if (!e.enabled) selected = null;
        if (changed) WestHud.save();
    }

    /** Ad + anahtar satırı; yeni değeri döner */
    private boolean toggleLine(String label, boolean value, int x, int y, int w) {
        ui.g.text(ui.fit(label, w - 30), x, y + 3, Rota.TEXT, false);
        return Rota.toggle(ui, value, x + w - 22, y + 1);
    }

    // ───────── Olaylar ─────────

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
        int mx = (int) x, my = (int) y;
        if (button != 0 || overPanel(mx, my)) return;
        // Boşta kalan tıklama öğe seçer ve sürüklemeye başlar
        HudElement hit = null;
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            if (mx >= b[0] - 2 && my >= b[1] - 2 && mx < b[0] + b[2] + 2 && my < b[1] + b[3] + 2) hit = en.getKey();
        }
        selected = hit;
        if (hit != null) {
            int[] b = boxes.get(hit);
            dragging = hit;
            dragOffX = mx - b[0];
            dragOffY = my - b[1];
            ui.end();
        }
    }

    private boolean overPanel(int mx, int my) {
        for (int[] r : panels) if (mx >= r[0] && my >= r[1] && mx < r[0] + r[2] && my < r[1] + r[3]) return true;
        return false;
    }

    @Override
    public void mouseReleased(double x, double y, int button) {
        if (dragging != null || ui.dragging != null) WestHud.save();
        dragging = null;
        ui.dragging = null;
        guideX = guideY = -1;
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        int[] r = listRect;
        if (listOpen && selected == null && r != null && x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) {
            listScroll -= (int) Math.round(amount * 20);
            return;
        }
        if (overPanel((int) x, (int) y)) return;
        HudElement target = selected;
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            if (x >= b[0] && y >= b[1] && x < b[0] + b[2] && y < b[1] + b[3]) target = en.getKey();
        }
        if (target == null) return;
        selected = target;
        scale(target, amount > 0 ? 0.05f : -0.05f);
    }

    @Override
    public boolean keyPressed(int key) {
        if (selected == null) return false;
        int[] b = boxes.get(selected);
        if (b == null) return false;
        // Ok tuşları: 1 piksel taşı; Delete: gizle
        int dx = key == 263 ? -1 : key == 262 ? 1 : 0, dy = key == 265 ? -1 : key == 264 ? 1 : 0;
        if (dx == 0 && dy == 0) {
            if (key == 261) {
                selected.enabled = false;
                selected = null;
                WestHud.save();
                return true;
            }
            return false;
        }
        int nx = Math.max(0, Math.min(lastW - b[2], b[0] + dx)), ny = Math.max(0, Math.min(lastH - b[3], b[1] + dy));
        selected.setPixelPos(nx, ny, lastW, lastH);
        WestHud.save();
        return true;
    }

    @Override
    public void removed() {
        WestHud.editorOpen = false;
        WestHud.save();
    }

    @Override
    public WestScreen escape() {
        if (selected != null) {
            selected = null;
            return this;
        }
        WestHud.editorOpen = false;
        WestHud.save();
        return back;
    }
}
