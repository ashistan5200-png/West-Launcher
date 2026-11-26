package dev.west.hud.compat;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Gfx;
import dev.west.hud.mods.ModBridge;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Rota;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.List;

/**
 * Duraklatma ekranında ve West ana menüsünde kısayol kartları ("Rota"):
 * - Mod Merkezi (oyun West Client'tan açıldıysa; bekleyen değişiklik sayısıyla)
 * - Flashback: oyundayken kayıt başlat/bitir, menüde kayıtları aç
 * - Essential: tıklayınca Gardırop, Arkadaşlar, Ekran görüntüleri, Dünya barındır, Ayarlar listesi açılır
 * Tıklamalar eşzamanlı olarak "bize mi ait" diye yanıtlanır (altta kalan vanilla düğmeleri çalışmaya devam eder);
 * eylem bir sonraki karede çalışır.
 */
public final class ModCards {
    private final List<int[]> hits = new ArrayList<>();
    private final Rota.Anim anim = new Rota.Anim();
    private int clickX = -1, clickY = -1;
    private boolean essentialOpen;
    /** Mod Merkezi satırı gösterilsin mi (ana menüde gezinmede zaten var) */
    public boolean showHub = true;

    /** Gösterilecek kart var mı */
    public static boolean any() {
        return !ModMenus.mods().isEmpty() || ModBridge.INSTANCE.available();
    }

    /** Bu nokta kartlardan birinin üstünde mi (tıklamayı almadan) */
    public boolean over(double x, double y) {
        for (int[] r : hits) if (x >= r[0] && y >= r[1] && x < r[0] + r[2] && y < r[1] + r[3]) return true;
        return false;
    }

    /** Bu nokta kartlardan birinin üstündeyse tıklamayı al */
    public boolean click(double x, double y) {
        if (over(x, y)) {
            clickX = (int) x;
            clickY = (int) y;
            return true;
        }
        essentialOpen = false; // dışarı tıklayınca listeyi kapat (tıklamayı yutmadan)
        return false;
    }

    /**
     * Kartları (x, bottom) noktasından yukarı doğru, w genişliğinde çizer; toplam yüksekliği döner.
     * inWorld: Flashback kartı kayıt kontrolü mü, kayıtlar listesi mi gösterecek.
     */
    public int render(Gfx g, int x, int bottom, int w, int mx, int my, boolean inWorld) {
        anim.frame();
        hits.clear();
        int accent = WestHud.theme().accent | 0xFF000000;
        int y = bottom, gap = 4;
        ModMenus.Mod essential = null, flashback = null;
        for (var m : ModMenus.mods()) {
            if (m.id().equals("essential")) essential = m;
            if (m.id().equals("flashback")) flashback = m;
        }
        int popX = 0, popY = 0;

        // Mod Merkezi
        ModBridge hub = ModBridge.INSTANCE;
        if (showHub && hub.available()) {
            hub.ensureLoaded();
            int h = 22;
            y -= h;
            float a = anim.get("hub", in(mx, my, x, y, w, h));
            Rota.card(g, x, y, w, h, a);
            Icons.draw(g, Icon.BOX, x + 8, y + 6, 10, accent);
            g.text(Rota.fit(g, Tr.t("Mod Merkezi"), w - 60), x + 24, y + 7, Rota.TEXT, false);
            int n = hub.pending.size();
            if (n > 0) {
                String c = String.valueOf(n);
                int bw = Math.max(14, g.textWidth(c) + 8);
                Ui.round(g, x + w - 20 - bw, y + 5, bw, 12, 6, accent);
                g.text(c, x + w - 20 - bw + (bw - g.textWidth(c)) / 2, y + 7, WestHud.theme().onAccent, false);
            }
            Icons.draw(g, Icon.CHEVRON_RIGHT, x + w - 14, y + 7, 8, Theme.mix(Rota.FAINT, Rota.TEXT, a));
            hits.add(new int[] { x, y, w, h });
            if (consume(x, y, w, h)) {
                WestHud.game.click();
                WestHud.game.openModHub();
            }
            y -= gap;
        }

        // Essential
        if (essential != null) {
            int h = 22;
            y -= h;
            float a = anim.get("ess", in(mx, my, x, y, w, h) || essentialOpen);
            Rota.card(g, x, y, w, h, a);
            Icons.draw(g, Icon.GEM, x + 8, y + 6, 10, 0xFF000000 | essential.color());
            g.text("Essential", x + 24, y + 7, Rota.TEXT, false);
            Icons.draw(g, essentialOpen ? Icon.CHEVRON_DOWN : Icon.CHEVRON_RIGHT, x + w - 14, y + 7, 8, Theme.mix(Rota.FAINT, Rota.TEXT, a));
            hits.add(new int[] { x, y, w, h });
            if (consume(x, y, w, h)) {
                WestHud.game.click();
                essentialOpen = !essentialOpen;
            }
            popX = x;
            popY = y;
            y -= gap;
        }

        // Flashback
        if (flashback != null) {
            int h = 30;
            y -= h;
            boolean recording = Flashback.recording(), replay = Flashback.inReplay();
            Rota.card(g, x, y, w, h, 0);
            if (recording) Ui.outline(g, x, y, w, h, Rota.RADIUS, 0x90E5566E);
            if (recording) {
                float pulse = 0.55f + 0.45f * (float) Math.sin(System.nanoTime() / 1e9 * 4);
                Ui.round(g, x + 10, y + 11, 8, 8, 4, ((int) (255 * pulse)) << 24 | 0xE5566E);
            } else Icons.draw(g, inWorld ? Icon.PLAY : Icon.FOLDER, x + 9, y + 10, 10, Rota.MUTED);
            String title = inWorld ? (recording ? Tr.t("Kaydediliyor") : Tr.t("Kayıt")) : Tr.t("Kayıtlar");
            String btn = inWorld ? (recording ? Tr.t("Bitir") : Tr.t("Başlat")) : Tr.t("Aç");
            int bw = Rota.buttonWidth(g, btn, null);
            g.text(Rota.fit(g, title, w - bw - 40), x + 26, y + 6, Rota.TEXT, false);
            Rota.small(g, Rota.fit(g, "Flashback", Math.round((w - bw - 40) / 0.8f)), x + 26, y + 17, Rota.FAINT);
            hits.add(new int[] { x, y, w, h });
            boolean disabled = inWorld && replay;
            Rota.Kind kind = recording ? Rota.Kind.DANGER : Rota.Kind.PRIMARY;
            // Düğme bu sınıfın kendi tıklama mekanizmasıyla çalışır: çizimi Rota'dan, tıklamayı consume'dan
            int bx = x + w - bw - 6, by = y + 7;
            Ui fake = new Ui();
            fake.begin(g, WestHud.theme(), mx, my, 0);
            Rota.button(fake, anim, "fb", btn, null, kind, bx, by, bw, 16, !disabled);
            if (consume(bx, by, bw, 16) && !disabled) {
                WestHud.game.click();
                if (!inWorld) flashback.actions().get(0).run().accept(WestHud.game.screenObject());
                else if (recording) Flashback.finish();
                else Flashback.start();
            }
            y -= gap;
        }

        // Essential listesi (en üstte)
        if (essentialOpen && essential != null) {
            g.nextLayer();
            int rowH = 18, ph = essential.actions().size() * rowH + 8, pw = Math.max(w, 160);
            int px = popX, py = popY - 4 - ph;
            Rota.window(g, px, py, pw, ph);
            hits.add(new int[] { px, py, pw, ph });
            for (int k = 0; k < essential.actions().size(); k++) {
                var act = essential.actions().get(k);
                int ry = py + 4 + k * rowH;
                float a = anim.get("ea" + k, in(mx, my, px + 4, ry, pw - 8, rowH));
                if (a > 0.01f) Ui.round(g, px + 4, ry, pw - 8, rowH, Rota.RADIUS_SM, Theme.alpha(0xFFFFFFFF, (int) (0x14 * a)));
                Icons.draw(g, act.icon(), px + 10, ry + 4, 10, Theme.mix(Rota.MUTED, 0xFF000000 | essential.color(), a));
                g.text(Rota.fit(g, act.label(), pw - 34), px + 26, ry + 5, Rota.TEXT, false);
                if (consume(px + 4, ry, pw - 8, rowH)) {
                    WestHud.game.click();
                    essentialOpen = false;
                    act.run().accept(WestHud.game.screenObject());
                }
            }
        }
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
