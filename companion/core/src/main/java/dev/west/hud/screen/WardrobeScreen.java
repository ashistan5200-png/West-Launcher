package dev.west.hud.screen;

import dev.west.hud.Config;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.cosmetic.Cosmetics;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * Gardırop: West Coin ile alınan aksesuarları tak, çıkar ve karakterin üzerinde nasıl durduğuna bak.
 * Sahip olunanlar launcher'dan gelir; seçim hemen uygulanır ve launcher'a geri yazılır (oyundan çıkınca).
 */
public final class WardrobeScreen extends WestShell {
    private final WestScreen back;
    private int slot;
    private float yaw = 200f, spin = 1f;
    private boolean dragging;
    private double lastX;
    private float scroll;

    public WardrobeScreen(WestScreen back) {
        this.back = back;
    }

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        beginFrame(g, mx, my);
        Theme t = ui.t;
        int sw = g.width(), sh = g.height();
        float in = appear();
        g.blurBehind();
        g.fill(0, 0, sw, sh, (int) (0xA0 * in) << 24 | 0x06070B);

        // Başlık
        if (iconButton("back", Icon.BACK, 12, 10, 20, Tr.t("Geri"), 0)) close();
        bigText(g, Tr.t("Gardırop"), 40, 13, 0xFFFFFFFF, 1.25f);
        Config.Data d = WestHud.config.data;
        String coins = Tr.t("{0} West Coin", d.coins);
        int cw = small(g, coins) + 22;
        Ui.round(g, sw - cw - 12, 10, cw, 18, 9, 0x30F2B654);
        Ui.round(g, sw - cw - 8, 14, 10, 10, 5, 0xFFF2B654);
        smallText(g, coins, sw - cw + 6, 15, 0xFFF6D38F);

        // Sol: karakter önizlemesi
        int lw = Math.max(150, Math.min(sw * 42 / 100, 320));
        int top = 40, bottom = sh - 14;
        Ui.round(g, 12, top, lw, bottom - top, 12, 0x66000000);
        Ui.outline(g, 12, top, lw, bottom - top, 12, 0x1AFFFFFF);
        // Zemin gölgesi
        int feet = bottom - 34;
        Ui.round(g, 12 + lw / 2 - 40, feet - 4, 80, 10, 5, 0x50000000);
        // Fareyle sürükleyerek döndür; bırakınca yavaşça kendi döner
        boolean overModel = ui.hover(12, top, lw, bottom - top);
        modelX0 = 12;
        modelX1 = 12 + lw;
        if (!dragging) yaw += spin * delta * 0.9f;
        int height = Math.min(bottom - top - 60, (int) (lw * 1.25f));
        g.playerStanding(12 + lw / 2, feet, height, yaw);
        smallText(g, ui.fit(Tr.t("Sürükleyerek döndür"), (int) ((lw - 20) / 0.8f)), 22, bottom - 16, overModel ? 0xCCFFFFFF : 0x77FFFFFF);
        if (!WestHud.game.inWorld()) {
            // Aura yalnızca dünyada görünür
            String a = d.cosmetics.get("aura");
            if (a != null) smallText(g, ui.fit(Tr.t("Aura dünyada, karakterinin etrafında görünür."), (int) ((lw - 20) / 0.8f)), 22, top + 8, 0x99FFFFFF);
        }

        // Sağ: yuvalar ve öğeler
        int rx = 12 + lw + 12, rw = sw - rx - 12;
        int tabY = top;
        int tx = rx;
        for (int i = 0; i < Cosmetics.SLOTS.length; i++) {
            String label = Tr.t(Cosmetics.SLOTS[i][1]);
            int w = g.textBoldWidth(label) + 18;
            // Sığmazsa alt satıra geç
            if (tx > rx && tx + w > rx + rw) {
                tx = rx;
                tabY += 26;
            }
            boolean on = slot == i;
            boolean hv = ui.hover(tx, tabY, w, 20);
            Ui.round(g, tx, tabY, w, 20, 10, on ? t.accent | 0xFF000000 : hv ? 0x30FFFFFF : 0x1AFFFFFF);
            g.textBold(label, tx + 9, tabY + 6, on ? t.onAccent : 0xEEFFFFFF, false);
            if (ui.clicked(tx, tabY, w, 20)) {
                WestHud.game.click();
                slot = i;
                scroll = 0;
            }
            tx += w + 6;
        }

        String slotId = Cosmetics.SLOTS[slot][0];
        List<String> items = new ArrayList<>();
        for (String id : d.owned) if (slotId.equals(Cosmetics.slotOf(id))) items.add(id);
        String current = d.cosmetics.get(slotId);

        int gy = tabY + 30, gh = bottom - gy;
        if (items.isEmpty()) {
            emptyMessage(rx + rw / 2, gy + gh / 2 - 10, Tr.t("Bu yuvada aksesuarın yok"),
                    Tr.t("West Client → Mağaza'dan West Coin ile alabilirsin. Oynadığın her saat 100 West Coin kazanırsın."), null);
            ui.end();
            return;
        }
        // Kartlar: ilk kart "Yok" (çıkar)
        int cols = Math.max(2, rw / 120);
        int cardW = (rw - (cols - 1) * 8) / cols, cardH = 64;
        List<String> cards = new ArrayList<>();
        cards.add(null);
        cards.addAll(items);
        g.scissor(rx, gy, rx + rw, bottom);
        for (int i = 0; i < cards.size(); i++) {
            String id = cards.get(i);
            int cx = rx + (i % cols) * (cardW + 8), cy = gy + (i / cols) * (cardH + 8) - Math.round(scroll);
            if (cy > bottom || cy + cardH < gy) continue;
            boolean sel = id == null ? current == null : id.equals(current);
            boolean hv = ui.hover(cx, cy, cardW, cardH) && my >= gy && my <= bottom;
            float h = hov("c" + i, hv);
            Ui.round(g, cx, cy, cardW, cardH, 10, Theme.mix(0x26FFFFFF, 0x3AFFFFFF, h));
            if (sel) Ui.outline(g, cx, cy, cardW, cardH, 10, t.accent | 0xFF000000);
            else Ui.outline(g, cx, cy, cardW, cardH, 10, 0x1AFFFFFF);
            if (id == null) {
                Icons.draw(g, Icon.CLOSE, cx + 10, cy + 12, 14, 0xAAFFFFFF);
                g.textBold(Tr.t("Yok"), cx + 10, cy + 36, 0xFFFFFFFF, false);
                smallText(g, ui.fit(Tr.t("Bu yuvayı boş bırak"), (int) ((cardW - 20) / 0.8f)), cx + 10, cy + 48, 0x88FFFFFF);
            } else {
                int col = Cosmetics.swatch(id);
                Ui.round(g, cx + 10, cy + 10, 22, 22, 6, col);
                Ui.round(g, cx + 14, cy + 14, 14, 14, 4, Theme.alpha(0xFFFFFFFF, 0x30));
                String name = Tr.t(Cosmetics.NAMES.getOrDefault(id, id));
                g.textBold(ui.fit(name, cardW - 20), cx + 10, cy + 38, 0xFFFFFFFF, false);
                boolean plus = id.endsWith("_plus") || id.equals("hat_halo") || id.equals("back_plus_wings") || id.equals("aura_stars") || id.equals("menu_gold");
                smallText(g, sel ? Tr.t("Takılı") : plus ? Tr.t("West Plus") : Tr.t("Takmak için tıkla"), cx + 10, cy + 50, sel ? 0xFF8EE6B6 : plus ? 0xFFF2C77A : 0x88FFFFFF);
            }
            if (sel) {
                Ui.round(g, cx + cardW - 20, cy + 8, 12, 12, 6, t.accent | 0xFF000000);
                Icons.draw(g, Icon.CHECK, cx + cardW - 18, cy + 10, 8, t.onAccent);
            }
            if (hv && ui.clicked(cx, cy, cardW, cardH)) {
                WestHud.game.click();
                if (id == null) d.cosmetics.remove(slotId);
                else d.cosmetics.put(slotId, id);
                WestHud.save();
            }
        }
        g.noScissor();
        int rows = (cards.size() + cols - 1) / cols;
        float max = Math.max(0, rows * (cardH + 8) - 8 - gh);
        scroll = Math.max(0, Math.min(max, scroll));
        ui.end();
    }

    // Model alanında basılı tutup sürükleyince döner; bırakınca yavaşça kendi döner
    private int modelX0, modelX1;

    @Override
    public void mouseClicked(double x, double y, int button) {
        super.mouseClicked(x, y, button);
        if (button == 0 && x >= modelX0 && x <= modelX1) {
            dragging = true;
            lastX = x;
            spin = 0;
        }
    }

    @Override
    public void mouseDragged(double x, double y, int button) {
        if (dragging) {
            yaw += (float) (x - lastX) * 1.6f;
            lastX = x;
        }
    }

    @Override
    public void mouseReleased(double x, double y, int button) {
        if (dragging) {
            dragging = false;
            spin = 0.6f;
        }
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        scroll -= (float) amount * 24;
    }

    private void close() {
        WestHud.game.click();
        go(back);
    }

    @Override
    public WestScreen escape() {
        return back;
    }

    @Override
    public boolean pausesGame() {
        return true;
    }
}
