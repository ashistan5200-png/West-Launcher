package dev.west.hud.screen;

import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.Hud;
import dev.west.hud.hud.HudElement;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * HUD düzenleyici: öğeleri sürükle, tekerlekle boyutlandır. Kenarlara, ekran ortasına ve
 * diğer öğelere mıknatıslı hizalanır; hizalama çizgileri gösterilir. Seçili öğenin altında
 * küçük bir araç çubuğu, sağda ayar paneli vardır.
 */
public final class EditorScreen implements WestScreen {
    private static final int SNAP = 4;
    private final WestScreen back;
    private final Ui ui = new Ui();
    private final Map<HudElement, int[]> boxes = new HashMap<>();
    private HudElement selected, dragging;
    private int dragOffX, dragOffY;
    private int guideX = -1, guideY = -1;
    private boolean listOpen = false;
    private final long opened = System.nanoTime();

    public EditorScreen(WestScreen back) {
        this.back = back;
        WestHud.editorOpen = true;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        ui.begin(g, t, mx, my, (System.nanoTime() - opened) / 1e9f);
        int sw = g.width(), sh = g.height();
        lastW = sw;
        lastH = sh;
        Hud hud = WestHud.HUD;

        g.fill(0, 0, sw, sh, 0x50000000);
        // Hafif ızgara
        for (int x = 0; x < sw; x += 20) g.fill(x, 0, x + 1, sh, 0x0CFFFFFF);
        for (int y = 0; y < sh; y += 20) g.fill(0, y, sw, y + 1, 0x0CFFFFFF);

        // Sürükleme
        if (dragging != null) {
            int[] b = boxes.get(dragging);
            if (b != null) {
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
        }
        if (guideX >= 0) g.fill(guideX, 0, guideX + 1, sh, Theme.alpha(t.accent, 200));
        if (guideY >= 0) g.fill(0, guideY, sw, guideY + 1, Theme.alpha(t.accent, 200));

        // Öğeler
        boxes.clear();
        HudElement hovered = null;
        for (HudElement e : hud.elements) {
            if (!e.enabled) continue;
            int[] b = Hud.drawElement(g, WestHud.game, t, e, sw, sh);
            boxes.put(e, b);
            if (ui.hover(b[0], b[1], b[2], b[3])) hovered = e;
        }
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            HudElement e = en.getKey();
            int c = e == selected ? t.accent : e == hovered ? Theme.alpha(0xFFFFFF, 150) : Theme.alpha(0xFFFFFF, 50);
            outline(g, b[0] - 1, b[1] - 1, b[2] + 2, b[3] + 2, c);
        }

        if (selected != null && boxes.containsKey(selected) && dragging == null) toolbar(selected, boxes.get(selected), sw, sh);
        topBar(sw);
        // Sağ panel: seçili öğenin ayarları, yoksa (açıksa) öğe listesi
        if (selected != null) sidePanel(selected, sw, sh);
        else if (listOpen) elementList(sw, sh);
        ui.end();
    }

    private void outline(Gfx g, int x, int y, int w, int h, int c) {
        g.fill(x, y, x + w, y + 1, c);
        g.fill(x, y + h - 1, x + w, y + h, c);
        g.fill(x, y, x + 1, y + h, c);
        g.fill(x + w - 1, y, x + w, y + h, c);
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

    private void toolbar(HudElement e, int[] b, int sw, int sh) {
        Theme t = ui.t;
        String size = b[2] + " × " + b[3];
        int lw = ui.g.textWidth(size) + 8;
        int ly = b[1] - 13 < 2 ? b[1] + b[3] + 3 : b[1] - 13;
        ui.rect(b[0] + (b[2] - lw) / 2, ly, lw, 11, t.accent, 2);
        ui.textCentered(size, b[0] + b[2] / 2, ly + 2, t.onAccent);

        int tw = 3 * 16 + 2 * 3, tx = Math.max(2, Math.min(sw - tw - 2, b[0] + (b[2] - tw) / 2));
        int ty = b[1] + b[3] + 4;
        if (ty + 16 > sh - 2 || ly > b[1]) ty = b[1] - 20 >= 2 ? b[1] - 20 : b[1] + 2;
        ui.rect(tx - 3, ty - 2, tw + 6, 20, t.panel);
        String[] icons = { "−", "↺", "✕" };
        String[] tips = { "Küçült", "Varsayılan konum", "Gizle" };
        for (int i = 0; i < 3; i++) {
            int x = tx + i * 19;
            boolean hov = ui.hover(x, ty, 16, 16);
            ui.rect(x, ty, 16, 16, hov ? (i == 2 ? t.danger : Theme.alpha(t.accent, 90)) : t.card);
            ui.textCentered(icons[i], x + 8, ty + 4, t.text);
            if (hov) {
                int w = ui.g.textWidth(tips[i]) + 8;
                ui.rect(x + 8 - w / 2, ty + 18, w, 12, 0xEE000000, 2);
                ui.textCentered(tips[i], x + 8, ty + 20, 0xFFFFFFFF);
            }
            if (ui.clicked(x, ty, 16, 16)) {
                if (i == 0) e.scale = Math.max(0.5f, e.scale - 0.1f);
                if (i == 1) e.resetLayout();
                if (i == 2) { e.enabled = false; selected = null; }
                WestHud.save();
            }
        }
    }

    private void topBar(int sw) {
        Theme t = ui.t;
        String full = "Sürükle: taşı  ·  Tekerlek: boyut  ·  Esc: kaydet";
        String hint = sw >= 420 ? full : "Sürükle · Tekerlek · Esc";
        int bw = 70;
        int w = Math.min(sw - 8, ui.g.textWidth(hint) + bw + 30);
        int x = (sw - w) / 2;
        ui.rect(x, 4, w, 18, t.panel);
        ui.border(x, 4, w, 18, t.line);
        ui.text("◆", x + 6, 9, t.accent);
        ui.text(ui.fit(hint, w - bw - 24), x + 16, 9, t.muted);
        if (ui.button(listOpen && selected == null ? "Kapat" : "Öğeler", x + w - bw - 2, 6, bw, 14, false)) {
            if (selected != null) { selected = null; listOpen = true; } else listOpen = !listOpen;
        }
    }

    private void elementList(int sw, int sh) {
        Theme t = ui.t;
        Hud hud = WestHud.HUD;
        int w = 116, x = sw - w - 4, y = 28, rowH = 15;
        int h = 16 + hud.elements.size() * rowH + 4;
        ui.rect(x, y, w, h, t.panel);
        ui.border(x, y, w, h, t.line);
        ui.text("Öğeler", x + 6, y + 5, t.text);
        int ry = y + 16;
        for (HudElement e : hud.elements) {
            boolean hov = ui.hover(x + 2, ry, w - 4, rowH);
            if (e == selected) ui.rect(x + 2, ry, w - 4, rowH, Theme.alpha(t.accent, 60), 2);
            else if (hov) ui.rect(x + 2, ry, w - 4, rowH, t.cardHover, 2);
            ui.text(ui.fit(e.name, w - 40), x + 6, ry + 4, e.enabled ? t.text : t.muted);
            boolean on = ui.toggle(e.enabled, x + w - 28, ry + 2);
            if (on != e.enabled) {
                e.enabled = on;
                if (on) selected = e;
                WestHud.save();
            } else if (ui.clicked(x + 2, ry, w - 32, rowH) && e.enabled) selected = e;
            ry += rowH;
        }
    }

    private void sidePanel(HudElement e, int sw, int sh) {
        Theme t = ui.t;
        int w = 128, x = sw - w - 4, y = 28, h = 150;
        if (e == WestHud.HUD.keystrokes || e == WestHud.HUD.armor) h += 22;
        ui.rect(x, y, w, h, t.panel);
        ui.border(x, y, w, h, t.line);
        ui.text(ui.fit(e.name, w - 26), x + 8, y + 7, t.text);
        if (ui.button("✕", x + w - 18, y + 4, 14, 14, false)) { selected = null; return; }
        int ry = y + 24;
        boolean changed = false;

        ui.text(String.format(Locale.ROOT, "Boyut %%%d", Math.round(e.scale * 100)), x + 8, ry, t.muted);
        float s = ui.slider(e, e.scale, 0.5f, 2.5f, x + 8, ry + 13, w - 16);
        if (Math.abs(s - e.scale) > 0.001f) { e.scale = Math.round(s * 20) / 20f; }
        ry += 26;
        boolean on;
        ui.text("Arka plan", x + 8, ry + 2, t.text);
        on = ui.toggle(e.background, x + w - 30, ry);
        if (on != e.background) { e.background = on; changed = true; }
        ry += 18;
        ui.text("Gölge", x + 8, ry + 2, t.text);
        on = ui.toggle(e.shadow, x + w - 30, ry);
        if (on != e.shadow) { e.shadow = on; changed = true; }
        ry += 18;
        if (e == WestHud.HUD.keystrokes) {
            ui.text("Fare tuşları", x + 8, ry + 2, t.text);
            on = ui.toggle(WestHud.HUD.keystrokes.showMouse, x + w - 30, ry);
            if (on != WestHud.HUD.keystrokes.showMouse) { WestHud.HUD.keystrokes.showMouse = on; changed = true; }
            ry += 18;
        }
        if (e == WestHud.HUD.armor) {
            ui.text("Eldeki eşya", x + 8, ry + 2, t.text);
            on = ui.toggle(WestHud.HUD.armor.showHand, x + w - 30, ry);
            if (on != WestHud.HUD.armor.showHand) { WestHud.HUD.armor.showHand = on; changed = true; }
            ry += 18;
        }
        ui.text("Renk", x + 8, ry + 2, t.text);
        int[] colors = { 0xFFFFFF, 0xE8A25C, 0x6EA8D6, 0x70C48E, 0xEC5A82, 0xF2C14E };
        for (int i = 0; i < colors.length; i++) {
            if (ui.swatch(colors[i], e.color == colors[i], x + 8 + i * 13 + 30, ry + 1, 9)) { e.color = colors[i]; changed = true; }
        }
        ry += 18;
        if (ui.button("Varsayılan konum", x + 8, ry, w - 16, 16, false)) { e.resetLayout(); changed = true; }
        if (changed) WestHud.save();
    }

    // ───────── Olaylar ─────────

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
        // Önce paneller (tıklamayı onlar tüketir); boşta kalan tıklama öğe seçer/sürükler
        int mx = (int) x, my = (int) y;
        if (button != 0) return;
        if (overUi(mx, my)) return;
        HudElement hit = null;
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            if (mx >= b[0] && my >= b[1] && mx < b[0] + b[2] && my < b[1] + b[3]) hit = en.getKey();
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

    private boolean overUi(int mx, int my) {
        int sw = lastW;
        if (my < 24) return true;
        if (selected != null) return mx > sw - 134 && my < 28 + 180;
        return listOpen && mx > sw - 122 && my < 28 + 16 + WestHud.HUD.elements.size() * 15 + 6;
    }

    private int lastW, lastH;

    @Override
    public void mouseReleased(double x, double y, int button) {
        if (dragging != null || ui.dragging != null) WestHud.save();
        dragging = null;
        ui.dragging = null;
        guideX = guideY = -1;
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        HudElement target = selected;
        for (Map.Entry<HudElement, int[]> en : boxes.entrySet()) {
            int[] b = en.getValue();
            if (x >= b[0] && y >= b[1] && x < b[0] + b[2] && y < b[1] + b[3]) target = en.getKey();
        }
        if (target == null) return;
        target.scale = Math.max(0.5f, Math.min(2.5f, Math.round((target.scale + (amount > 0 ? 0.05f : -0.05f)) * 20) / 20f));
        selected = target;
        WestHud.save();
    }

    @Override
    public boolean keyPressed(int key) {
        if (selected == null) return false;
        int[] b = boxes.get(selected);
        if (b == null) return false;
        // Ok tuşları: 1 piksel taşı
        int dx = key == 263 ? -1 : key == 262 ? 1 : 0, dy = key == 265 ? -1 : key == 264 ? 1 : 0;
        if (dx == 0 && dy == 0) {
            if (key == 261) { selected.enabled = false; selected = null; WestHud.save(); return true; } // Delete
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
        WestHud.editorOpen = false;
        WestHud.save();
        return back;
    }
}
