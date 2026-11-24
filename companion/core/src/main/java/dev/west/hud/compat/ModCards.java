package dev.west.hud.compat;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * Duraklatma ekranında ve West ana menüsünde, yüklü modların kısayol kartları:
 * - Flashback: oyundayken "Kayıt" kartı (Başlat / Durdur), menüde "Kayıtlar" (tekrarları aç).
 * - Essential: tek satır; tıklayınca Gardırop, Arkadaşlar, Ekran görüntüleri, Dünya barındır, Ayarlar listesi açılır.
 * Tıklamalar eşzamanlı olarak "bize mi ait" diye yanıtlanır (altta kalan vanilla düğmeleri çalışmaya devam eder);
 * eylem bir sonraki karede çalışır.
 */
public final class ModCards {
    private final List<int[]> hits = new ArrayList<>();
    private int clickX = -1, clickY = -1;
    private boolean essentialOpen;
    private final java.util.Map<String, Float> anim = new java.util.HashMap<>();
    private long last = System.nanoTime();

    /** Kart var mı (hiç mod yoksa çizilecek bir şey yok) */
    public static boolean any() {
        return !ModMenus.mods().isEmpty();
    }

    /** Bu nokta kartlardan birinin üstünde mi (tıklamayı almadan) */
    public boolean over(double x, double y) {
        for (int[] r : hits) if (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) return true;
        return false;
    }

    /** Bu nokta kartlardan birinin üstünde mi; öyleyse tıklamayı al */
    public boolean click(double x, double y) {
        for (int[] r : hits) {
            if (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) {
                clickX = (int) x;
                clickY = (int) y;
                return true;
            }
        }
        if (essentialOpen) { // dışarı tıklayınca listeyi kapat (tıklamayı yutmadan)
            essentialOpen = false;
        }
        return false;
    }

    /**
     * Kartları (x, bottom) noktasından yukarı doğru, w genişliğinde çizer; toplam yüksekliği döner.
     * inWorld: Flashback kartı kayıt kontrolü mü, kayıtlar listesi mi gösterecek.
     */
    public int render(Gfx g, int x, int bottom, int w, int mx, int my, boolean inWorld) {
        long now = System.nanoTime();
        float dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        hits.clear();
        int accent = WestHud.theme().accent;
        int y = bottom;
        int gap = 5;
        List<ModMenus.Mod> mods = ModMenus.mods();
        ModMenus.Mod essential = null, flashback = null;
        for (var m : mods) {
            if (m.id().equals("essential")) essential = m;
            if (m.id().equals("flashback")) flashback = m;
        }
        int popX = 0, popY = 0;
        boolean drawPop = false;

        // Essential satırı (en altta)
        if (essential != null) {
            int h = 22;
            y -= h;
            boolean hv = in(mx, my, x, y, w, h);
            float a = ease("ess", hv || essentialOpen, dt);
            Ui.round(g, x, y, w, h, 7, mix(0xB80D0E13, 0xE01A1C24, a));
            Ui.outline(g, x, y, w, h, 7, mix(0x1EFFFFFF, (0x99 << 24) | essential.color(), a));
            Icons.draw(g, Icon.GEM, x + 8, y + 6, 10, 0xFF000000 | essential.color());
            g.textBold("Essential", x + 24, y + 7, 0xFFFFFFFF, false);
            Icons.draw(g, essentialOpen ? Icon.CHEVRON_DOWN : Icon.CHEVRON_RIGHT, x + w - 14, y + 7, 8, 0xAAFFFFFF);
            hits.add(new int[] { x, y, w, h });
            if (consume(x, y, w, h)) {
                WestHud.game.click();
                essentialOpen = !essentialOpen;
            }
            popX = x;
            popY = y;
            drawPop = essentialOpen;
            y -= gap;
        }

        // Flashback kartı
        if (flashback != null) {
            int h = 34;
            y -= h;
            boolean recording = Flashback.recording();
            boolean replay = Flashback.inReplay();
            Ui.round(g, x, y, w, h, 8, 0xC20D0E13);
            Ui.outline(g, x, y, w, h, 8, recording ? 0x88F0574A : 0x1EFFFFFF);
            // simge kutusu
            Ui.round(g, x + 6, y + 6, 22, 22, 6, 0xFF1A1C24);
            if (recording) {
                float pulse = 0.55f + 0.45f * (float) Math.sin(now / 1e9 * 4);
                Ui.round(g, x + 12, y + 12, 10, 10, 5, ((int) (255 * pulse)) << 24 | 0xF0574A);
            } else Icons.draw(g, inWorld ? Icon.PLAY : Icon.FOLDER, x + 11, y + 11, 12, 0xFFB9BDC7);
            String title = inWorld ? (recording ? Tr.t("Kaydediliyor") : Tr.t("Kayıt")) : Tr.t("Kayıtlar");
            String sub = inWorld ? (recording ? Tr.t("Flashback · kayıt sürüyor") : Tr.t("Flashback ile kaydet")) : Tr.t("Flashback tekrarları");
            int btnW = Math.max(38, g.textBoldWidth(inWorld ? (recording ? Tr.t("Bitir") : Tr.t("Başlat")) : Tr.t("Aç")) + 16);
            int maxText = w - 34 - btnW - 12;
            g.textBold(fit(g, title, maxText), x + 34, y + 8, 0xFFFFFFFF, false);
            g.text(fit(g, sub, maxText), x + 34, y + 20, 0xFF8D909A, false);
            String btn = inWorld ? (recording ? Tr.t("Bitir") : Tr.t("Başlat")) : Tr.t("Aç");
            int bx = x + w - btnW - 7, by = y + 9, bh = 16;
            boolean disabled = inWorld && replay;
            boolean bhv = !disabled && in(mx, my, bx, by, btnW, bh);
            int bc = disabled ? 0xFF3A3C46 : recording ? 0xFFF0574A : 0xFF000000 | (accent & 0xFFFFFF);
            Ui.round(g, bx, by, btnW, bh, bh / 2, bhv ? mix(bc, 0xFFFFFFFF, 0.15f) : bc);
            int tc = recording || disabled ? 0xFFFFFFFF : WestHud.theme().onAccent;
            g.textBold(btn, bx + (btnW - g.textBoldWidth(btn)) / 2, by + 4, tc, false);
            hits.add(new int[] { x, y, w, h });
            if (consume(bx, by, btnW, bh) && !disabled) {
                WestHud.game.click();
                if (!inWorld) flashback.actions().get(0).run().accept(WestHud.game.screenObject());
                else if (recording) Flashback.finish();
                else Flashback.start();
            }
            y -= gap;
        }

        // Essential listesi (en üstte çizilsin)
        if (drawPop && essential != null) {
            g.nextLayer();
            int rowH = 18, ph = essential.actions().size() * rowH + 8, pw = Math.max(w, 160);
            int px = popX, py = popY - 4 - ph;
            Ui.round(g, px, py + 2, pw, ph, 9, 0x50000000);
            Ui.round(g, px, py, pw, ph, 8, 0xF40F1016);
            Ui.outline(g, px, py, pw, ph, 8, (0x55 << 24) | essential.color());
            hits.add(new int[] { px, py, pw, ph });
            for (int k = 0; k < essential.actions().size(); k++) {
                var act = essential.actions().get(k);
                int ry = py + 4 + k * rowH;
                boolean hv = in(mx, my, px + 4, ry, pw - 8, rowH);
                if (hv) Ui.round(g, px + 4, ry, pw - 8, rowH, 5, 0x1FFFFFFF);
                Icons.draw(g, act.icon(), px + 10, ry + 4, 10, hv ? 0xFF000000 | essential.color() : 0xFFB9BDC7);
                g.text(fit(g, act.label(), pw - 34), px + 26, ry + 5, 0xFFE6E7EA, false);
                if (consume(px + 4, ry, pw - 8, rowH)) {
                    WestHud.game.click();
                    essentialOpen = false;
                    act.run().accept(WestHud.game.screenObject());
                }
            }
        }
        // Kartların dışındaki bir tıklama (zaten click() reddetti) burada temizlenir
        clickX = clickY = -1;
        return bottom - y - gap;
    }

    private boolean consume(int x, int y, int w, int h) {
        if (clickX < 0 || !in(clickX, clickY, x, y, w, h)) return false;
        clickX = clickY = -1;
        return true;
    }

    private static boolean in(int px, int py, int x, int y, int w, int h) {
        return px >= x && py >= y && px < x + w && py < y + h;
    }

    private float ease(String key, boolean on, float dt) {
        float v = anim.getOrDefault(key, 0f);
        v += ((on ? 1f : 0f) - v) * Math.min(1f, dt * 14f);
        anim.put(key, v);
        return v;
    }

    private static String fit(Gfx g, String s, int max) {
        if (g.textWidth(s) <= max) return s;
        while (s.length() > 1 && g.textWidth(s + "…") > max) s = s.substring(0, s.length() - 1);
        return s + "…";
    }

    private static int mix(int a, int b, float t) {
        int r = 0;
        for (int sh = 0; sh < 32; sh += 8) {
            int ca = (a >>> sh) & 0xFF, cb = (b >>> sh) & 0xFF;
            r |= Math.round(ca + (cb - ca) * t) << sh;
        }
        return r;
    }

    /** Flashback'in kayıt durumunu ve komutlarını yansıma ile kullanır */
    static final class Flashback {
        private static final String CLS = "com.moulberry.flashback.Flashback";

        static boolean recording() {
            try {
                return Class.forName(CLS).getField("RECORDER").get(null) != null;
            } catch (Throwable e) {
                return false;
            }
        }

        static boolean inReplay() {
            return call("isInReplay") instanceof Boolean b && b;
        }

        static void start() { call("startRecordingReplay"); }

        static void finish() { call("finishRecordingReplay"); }

        private static Object call(String m) {
            try {
                return Class.forName(CLS).getMethod(m).invoke(null);
            } catch (Throwable e) {
                WestHud.LOG.warn("Flashback komutu çalışmadı ({}): {}", m, e.toString());
                return null;
            }
        }
    }
}
