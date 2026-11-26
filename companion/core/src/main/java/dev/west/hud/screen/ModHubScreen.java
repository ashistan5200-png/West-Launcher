package dev.west.hud.screen;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.mods.ModBridge;
import dev.west.hud.ui.Icons;
import dev.west.hud.ui.Icons.Icon;
import dev.west.hud.ui.Theme;
import dev.west.hud.ui.Ui;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Oyun içi Mod Merkezi: kurulu modları/paketleri aç-kapa, sil, güncelle; Modrinth'ten mod, kaynak paketi,
 * shader ve veri paketi kur; bekleyen değişiklikleri gör, geri al, tek tıkla uygula ve kaldığın yere dön.
 * Kaynak paketleri, shader'lar ve veri paketleri anında; mod dosyaları (Fabric modları çalışırken yüklenip
 * kaldırılamadığı için) yeniden başlatınca uygulanır. Yeniden başlatma aynı dünyaya / sunucuya geri döner.
 */
public final class ModHubScreen implements WestScreen {
    private enum Tab { INSTALLED, BROWSE, SETS, UPDATES, PENDING }

    private static final String[] TAB_NAMES = { Tr.t("Yüklü"), Tr.t("Keşfet"), Tr.t("Setler"), Tr.t("Güncellemeler"), Tr.t("Bekleyenler") };
    private static final Icon[] TAB_ICONS = { Icon.BOX, Icon.COMPASS, Icon.LIST, Icon.STAR, Icon.CLOCK };
    private static final String[] FILTERS = { Tr.t("Tümü"), Tr.t("Modlar"), Tr.t("Paketler"), Tr.t("Shader") };
    private static final String[] KINDS = { "mod", "resourcepack", "shader", "datapack" };
    private static final String[] KIND_NAMES = { Tr.t("Mod"), Tr.t("Kaynak paketi"), Tr.t("Shader"), Tr.t("Veri paketi") };
    private static final String[] SORTS = { "relevance", "downloads", "updated", "newest" };
    private static final String[] SORT_NAMES = { Tr.t("Önerilen"), Tr.t("Popüler"), Tr.t("Güncel"), Tr.t("Yeni") };
    /** Keşfet için hızlı kategori çipleri (Modrinth kategori kimlikleri) */
    private static final String[][] MOD_CATS = { { "", Tr.t("Hepsi") }, { "optimization", Tr.t("Performans") }, { "utility", Tr.t("Yardımcı") },
            { "decoration", Tr.t("Dekorasyon") }, { "adventure", Tr.t("Macera") }, { "technology", Tr.t("Teknoloji") }, { "magic", Tr.t("Büyü") },
            { "worldgen", Tr.t("Dünya") }, { "mobs", Tr.t("Yaratıklar") }, { "food", Tr.t("Yemek") } };
    private static final String[][] PACK_CATS = { { "", Tr.t("Hepsi") }, { "16x", "16x" }, { "32x", "32x" }, { "realistic", Tr.t("Gerçekçi") },
            { "simplistic", Tr.t("Sade") }, { "vanilla-like", Tr.t("Vanilla gibi") }, { "combat", Tr.t("PvP") }, { "gui", Tr.t("Arayüz") } };
    private static final String[][] SHADER_CATS = { { "", Tr.t("Hepsi") }, { "potato", Tr.t("Zayıf PC") }, { "low", Tr.t("Düşük") }, { "medium", Tr.t("Orta") },
            { "high", Tr.t("Yüksek") }, { "realistic", Tr.t("Gerçekçi") }, { "fantasy", Tr.t("Fantastik") }, { "vanilla-like", Tr.t("Vanilla gibi") } };

    private final WestScreen back;
    private final ModBridge api = ModBridge.INSTANCE;
    private final Game game = WestHud.game;
    private final Ui ui = new Ui();
    private Tab tab = Tab.INSTALLED;
    private int filter;
    private int kind, sort, cat;
    private String search = "";
    private boolean searchFocus;
    private long typedAt;
    private float scroll, scrollTarget;
    private final long opened = System.nanoTime();
    private long last = System.nanoTime();
    private float dt;
    private final Map<String, Float> anim = new HashMap<>();
    private Dialog dialog;
    /** Keşfet ayrıntısı açık mı (proje kimliği) */
    private String detailId;
    private float detailScroll, detailScrollTarget;
    /** Çözülmüş "data:" simgeleri (dosya kimliği → PNG) */
    private final Map<String, byte[]> dataIcons = new HashMap<>();
    /** İşlem sürerken satırlarda dönen gösterge */
    private final Set<String> busy = new LinkedHashSet<>();
    private boolean dropHover, goBack;
    /** Setler: yeni set adı alanı */
    private String setName = "";
    private boolean setNameFocus;
    private static int lastTab;

    /** Onay penceresi */
    private record Dialog(String title, String body, List<String> list, String yes, boolean danger, Runnable onYes) {}

    public ModHubScreen(WestScreen back) {
        this.back = back;
        this.tab = Tab.values()[Math.min(lastTab, Tab.values().length - 1)];
        if (tab == Tab.SETS) api.loadSets();
        if (tab == Tab.PENDING) api.loadPoints();
        if (api.available()) {
            api.reload();
            if (!api.loaded) api.checkUpdates();
        }
    }

    // ───────── Çizim ─────────

    @Override
    public void render(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        ui.suspended = dialog != null || detailId != null;
        int sw = g.width(), sh = g.height();
        float appear = ui.animate ? 1 - (float) Math.pow(1 - Math.min(1, time * 4f), 3) : 1;

        if (!game.inWorld()) g.panorama(delta);
        g.blurBehind();
        g.fill(0, 0, sw, sh, (int) (0x99 * appear) << 24 | 0x06070B);

        int pw = Math.min(680, sw - 16), ph = Math.min(400, sh - 16);
        int px = (sw - pw) / 2, py = (sh - ph) / 2 + Math.round((1 - appear) * 12);
        Ui.round(g, px - 1, py + 3, pw + 2, ph + 2, 13, 0x50000000);
        Ui.round(g, px, py, pw, ph, 12, 0xF00E0F16);
        Ui.outline(g, px, py, pw, ph, 12, 0x1FFFFFFF);

        if (!api.available()) {
            unavailable(px, py, pw, ph);
            ui.end();
            return;
        }

        int side = clamp(pw * 28 / 100, 112, 160);
        sidebar(px, py, side, ph);
        int cx = px + side + 12, cy = py + 10, cw = pw - side - 24;

        // Başlık: sayfa adı, arama, yenile, kapat
        bigText(g, ui.fit(TAB_NAMES[tab.ordinal()], Math.round((cw / 2.4f) / 1.3f)), cx, cy + 5, 0xFFFFFFFF, 1.3f);
        if (iconButton("close", Icon.CLOSE, px + pw - 26, cy, 18, 0xFFE5566E)) {
            close();
            ui.end();
            return;
        }
        int rx = px + pw - 48;
        boolean spinning = api.refreshing || api.loading || api.searching;
        if (iconButton("refresh", Icon.REFRESH, rx, cy, 18, 0)) refresh();
        if (spinning) spinner(g, rx + 9, cy + 9, 0xAAFFFFFF);
        if (tab == Tab.INSTALLED || tab == Tab.BROWSE) {
            int sbw = clamp(cw / 3, 80, 180);
            searchBox(rx - 6 - sbw, cy + 1, sbw, 16);
        }
        int top = cy + 24;
        top = toolbar(cx, top, cw);

        // Alt şerit (bekleyen değişiklikler) ve bildirim
        int footH = !api.pending.isEmpty() && tab != Tab.PENDING ? 30 : 0;
        int viewH = py + ph - 10 - top - footH;

        scroll += (scrollTarget - scroll) * Math.min(1, dt * 18);
        g.scissor(cx - 2, top, cx + cw + 4, top + viewH);
        g.push();
        g.translate(0, -Math.round(scroll));
        int realMy = ui.my;
        ui.my = my + Math.round(scroll);
        boolean inside = ui.mx >= cx - 2 && ui.mx < cx + cw + 4 && realMy >= top && realMy < top + viewH;
        if (!inside) ui.my = -9999;
        int end = switch (tab) {
            case INSTALLED -> installed(cx, top + 2, cw);
            case BROWSE -> browse(cx, top + 2, cw);
            case UPDATES -> updates(cx, top + 2, cw);
            case PENDING -> pendingList(cx, top + 2, cw);
            case SETS -> setsTab(cx, top + 2, cw);
        };
        ui.my = realMy;
        g.pop();
        g.noScissor();
        int contentH = end - top;
        float max = Math.max(0, contentH - viewH);
        scrollTarget = Math.max(0, Math.min(max, scrollTarget));
        if (max > 0) {
            int barH = Math.max(16, (int) (viewH * viewH / (float) contentH));
            int barY = top + (int) ((viewH - barH) * (scroll / max));
            Ui.round(g, cx + cw + 5, barY, 3, barH, 1, 0x55FFFFFF);
        }
        if (footH > 0) pendingBar(cx, py + ph - 10 - footH + 4, cw, footH - 4);

        // Üst katmanlar
        if (detailId != null) {
            g.nextLayer();
            ui.suspended = dialog != null;
            detail(px, py, pw, ph);
        }
        if (dialog != null) {
            g.nextLayer();
            ui.suspended = false;
            dialog(sw, sh);
        }
        toast(g, sw, py + ph - footH);
        ui.end();
    }

    private void unavailable(int px, int py, int pw, int ph) {
        Gfx g = ui.g;
        int cx = px + pw / 2;
        Icons.draw(g, Icon.BOX, cx - 12, py + ph / 2 - 46, 24, Theme.alpha(ui.t.accent, 0xDD));
        String a = Tr.t("Mod Merkezi kullanılamıyor");
        g.textBold(a, cx - g.textBoldWidth(a) / 2, py + ph / 2 - 12, 0xFFFFFFFF, false);
        String b = Tr.t("Mod Merkezi, oyun West Client launcher'ından açıldığında çalışır.");
        g.text(b, cx - g.textWidth(b) / 2, py + ph / 2 + 2, 0xFF9A9DA6, false);
        String c = Tr.t("Launcher'ı açık tutup oyunu oradan başlat.");
        g.text(c, cx - g.textWidth(c) / 2, py + ph / 2 + 14, 0xFF9A9DA6, false);
        if (ui.button(Tr.t("Geri"), cx - 40, py + ph / 2 + 34, 80, 18, true)) close();
    }

    private void sidebar(int x, int y, int w, int h) {
        Theme t = ui.t;
        Gfx g = ui.g;
        Ui.round(g, x, y, w, h, 12, 0xF0090A10);
        g.fill(x + w - 1, y + 10, x + w, y + h - 10, 0x14FFFFFF);
        Icons.draw(g, Icon.BOX, x + 11, y + 12, 12, t.accent | 0xFF000000);
        g.textBold(ui.fit(Tr.t("Mod Merkezi"), w - 36), x + 28, y + 14, 0xFFFFFFFF, false);

        int by = y + 36;
        for (Tab p : Tab.values()) {
            int count = switch (p) {
                case UPDATES -> updatable().size();
                case PENDING -> api.pending.size();
                default -> 0;
            };
            boolean active = tab == p;
            boolean on = ui.hover(x + 6, by, w - 12, 18);
            float hv = hov("nav" + p, on);
            if (active) Ui.round(g, x + 6, by, w - 12, 18, 6, t.accent | 0xFF000000);
            else if (hv > 0.01f) Ui.round(g, x + 6, by, w - 12, 18, 6, Theme.alpha(0xFFFFFFFF, Math.max(1, (int) (0x18 * hv))));
            int c = active ? t.onAccent : Theme.mix(0xCCFFFFFF, 0xFFFFFFFF, hv);
            Icons.draw(g, TAB_ICONS[p.ordinal()], x + 13, by + 4, 10, c);
            String n = count > 99 ? "99+" : String.valueOf(count);
            int bw = count > 0 ? Math.max(14, g.textWidth(n) + 8) : 0;
            g.textBold(ui.fit(TAB_NAMES[p.ordinal()], w - 44 - bw), x + 29, by + 5, c, false);
            if (count > 0) {
                Ui.round(g, x + w - 12 - bw, by + 3, bw, 12, 6, active ? Theme.alpha(t.onAccent, 0x40) : p == Tab.PENDING ? 0xFFE8A33D : 0x40FFFFFF);
                g.text(n, x + w - 12 - bw + (bw - g.textWidth(n)) / 2, by + 5, active ? t.onAccent : p == Tab.PENDING ? 0xFF1A140C : 0xFFFFFFFF, false);
            }
            if (ui.clicked(x + 6, by, w - 12, 18)) setTab(p);
            by += 20;
        }

        // Alt: durum + sürükle-bırak ipucu
        int fy = y + h - 64;
        g.fill(x + 8, fy - 4, x + w - 8, fy - 3, 0x14FFFFFF);
        int mods = 0, packs = 0, shaders = 0;
        for (JsonObject it : api.items) {
            switch (ModBridge.str(it, "kind")) {
                case "mod" -> mods++;
                case "resourcepack" -> packs++;
                case "shader" -> shaders++;
                default -> {}
            }
        }
        smallText(g, ui.fit(Tr.t("{0} mod · {1} paket · {2} shader", mods, packs, shaders), (int) ((w - 20) / 0.8f)), x + 10, fy, 0x99FFFFFF);
        int dy = fy + 12;
        float pulse = dropHover ? 1 : 0.5f + 0.5f * (float) Math.sin(ui.time * 2);
        Ui.outline(g, x + 8, dy, w - 16, 38, 7, Theme.alpha(t.accent, (int) (0x40 + 0x50 * pulse)));
        Icons.draw(g, Icon.PLUS, x + 14, dy + 7, 9, Theme.alpha(t.accent, 0xEE));
        g.text(ui.fit(Tr.t("Dosya sürükle"), w - 44), x + 28, dy + 8, 0xFFE6E7EA, false);
        smallText(g, ui.fit(Tr.t(".jar · .zip"), (int) ((w - 30) / 0.8f)), x + 14, dy + 22, 0x88FFFFFF);
    }

    /** Sekmeye göre süzgeç / tür seçimi satırı; içeriğin başladığı y'yi döner */
    private int toolbar(int x, int y, int w) {
        switch (tab) {
            case INSTALLED -> {
                int nf = tabs(FILTERS, filter, x, y, w);
                if (nf != filter) {
                    filter = nf;
                    scrollTarget = 0;
                    game.click();
                }
                return y + 24;
            }
            case BROWSE -> {
                Gfx g = ui.g;
                // Sıralama: tıkladıkça sıradakine geçer
                String sl = Tr.t("Sırala: {0}", SORT_NAMES[sort]);
                int sw = g.textWidth(sl) + 16;
                if (pill(sl, x + w - sw, y, sw, 16, false)) {
                    sort = (sort + 1) % SORTS.length;
                    newSearch();
                }
                int nk = tabs(KIND_NAMES, kind, x, y, w - sw - 8);
                if (nk != kind) {
                    kind = nk;
                    cat = 0;
                    newSearch();
                    game.click();
                }
                y += 22;
                y = chips(x, y, w) + 6;
                return y;
            }
            case UPDATES -> {
                List<JsonObject> up = updatable();
                Gfx g = ui.g;
                String s = up.isEmpty() ? Tr.t("Her şey güncel.") : Tr.t("{0} güncelleme var", up.size());
                g.text(s, x, y + 4, 0xFFB9BDC7, false);
                if (!up.isEmpty() && ui.button(Tr.t("Tümünü güncelle"), x + w - 110, y, 110, 16, true)) updateItems(up);
                if (ui.button(api.refreshing ? Tr.t("Denetleniyor…") : Tr.t("Denetle"), x + w - (up.isEmpty() ? 80 : 196), y, 80, 16, false) && !api.refreshing) api.checkUpdates();
                return y + 24;
            }
            default -> {
                return y + 2;
            }
        }
    }

    /** Yazı genişliğine göre boyutlanan sekmeler; seçileni döner */
    private int tabs(String[] labels, int sel, int x, int y, int maxW) {
        Gfx g = ui.g;
        Theme t = ui.t;
        int total = 4;
        for (String l : labels) total += g.textWidth(l) + 16;
        float k = Math.min(1f, maxW / (float) total);
        Ui.round(g, x, y, Math.round(total * k), 16, 8, 0x22FFFFFF);
        int cx = x + 2;
        for (int i = 0; i < labels.length; i++) {
            int bw = Math.round((g.textWidth(labels[i]) + 16) * k);
            boolean on = i == sel;
            boolean hv = ui.hover(cx, y, bw, 16);
            if (on) Ui.round(g, cx, y + 2, bw, 12, 6, t.accent | 0xFF000000);
            else if (hv) Ui.round(g, cx, y + 2, bw, 12, 6, 0x22FFFFFF);
            String l = ui.fit(labels[i], bw - 6);
            g.text(l, cx + (bw - g.textWidth(l)) / 2, y + 4, on ? t.onAccent : 0xFFD0D2D8, false);
            if (ui.clicked(cx, y, bw, 16)) sel = i;
            cx += bw;
        }
        return sel;
    }

    private int chips(int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String[][] cats = cats();
        if (cats.length == 0) return y;
        int cx = x;
        for (int i = 0; i < cats.length; i++) {
            String label = cats[i][1];
            int cw = g.textWidth(label) + 14;
            if (cx + cw > x + w) break;
            boolean on = i == cat;
            boolean hv = ui.hover(cx, y, cw, 14);
            Ui.round(g, cx, y, cw, 14, 7, on ? t.accent | 0xFF000000 : hv ? 0x30FFFFFF : 0x18FFFFFF);
            g.text(label, cx + 7, y + 3, on ? t.onAccent : 0xFFD0D2D8, false);
            if (ui.clicked(cx, y, cw, 14) && !on) {
                cat = i;
                newSearch();
                game.click();
            }
            cx += cw + 4;
        }
        return y + 14;
    }

    private String[][] cats() {
        return switch (kind) {
            case 0 -> MOD_CATS;
            case 1 -> PACK_CATS;
            case 2 -> SHADER_CATS;
            default -> new String[0][];
        };
    }

    // ───────── Yüklü ─────────

    private int installed(int x, int y, int w) {
        Gfx g = ui.g;
        if (!api.loaded) return loadingText(x, y, Tr.t("Yükleniyor…"));
        String q = search.toLowerCase(Locale.ROOT).trim();
        List<JsonObject> list = new ArrayList<>();
        for (JsonObject it : api.items) {
            String k = ModBridge.str(it, "kind");
            if (filter == 1 && !k.equals("mod") || filter == 2 && !k.equals("resourcepack") || filter == 3 && !k.equals("shader")) continue;
            if (!q.isEmpty() && !ModBridge.str(it, "title").toLowerCase(Locale.ROOT).contains(q) && !ModBridge.str(it, "file").toLowerCase(Locale.ROOT).contains(q)) continue;
            list.add(it);
        }
        list.sort((a, b) -> ModBridge.str(a, "title").compareToIgnoreCase(ModBridge.str(b, "title")));
        if (list.isEmpty()) {
            g.text(q.isEmpty() ? Tr.t("Burada henüz bir şey yok. Keşfet'ten kurabilir ya da dosya sürükleyebilirsin.") : Tr.t("Eşleşen içerik yok."), x, y + 4, 0x99FFFFFF, false);
            if (!q.isEmpty() && ui.button(Tr.t("Keşfet'te ara"), x, y + 18, 100, 16, true)) {
                setTab(Tab.BROWSE);
                newSearch();
            }
            return y + 40;
        }
        y = handoffCard(x, y, w);
        if (filter == 3 && !game.shadersSupported()) {
            y = note(x, y, w, Icon.SUN, Tr.t("Shader'ları canlı açmak için Iris gerekli. Keşfet → Mod'dan Iris'i kurabilirsin."));
        }
        for (JsonObject it : list) y = installedRow(it, x, y, w) + 4;
        return y;
    }

    private int installedRow(JsonObject it, int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String id = ModBridge.str(it, "id");
        String k = ModBridge.str(it, "kind");
        boolean managed = ModBridge.bool(it, "managed");
        int h = 34;
        boolean hv = ui.hover(x, y, w, h);
        float a = hov("row" + id, hv);
        Ui.round(g, x, y, w, h, 8, Theme.mix(0xFF15161E, 0xFF1C1E28, a));
        Ui.outline(g, x, y, w, h, 8, Theme.alpha(0xFFFFFFFF, (int) (0x12 + 0x18 * a)));
        icon(g, it, x + 6, y + 6, 22);

        // Durum
        String op = pendingKind(id);
        boolean on = state(it, op);
        int right = x + w - 8;
        // Eylemler: sil, güncelle, aç/kapa
        if (!managed) {
            if (smallIcon("del" + id, Icon.CLOSE, right - 16, y + 9, 16, 0xFFE5566E, Tr.t("Sil"))) askDelete(it);
            right -= 20;
        }
        JsonElement up = it.get("update");
        boolean hasUpdate = up != null && up.isJsonObject() && !"update".equals(op);
        if (hasUpdate && !managed) {
            String lbl = Tr.t("Güncelle");
            int bw = g.textWidth(lbl) + 12;
            if (pill(lbl, right - bw, y + 10, bw, 14, true)) updateItems(List.of(it));
            right -= bw + 6;
        }
        if (!managed) {
            if (busy.contains(id)) spinner(g, right - 12, y + 17, 0xCCFFFFFF);
            else {
                boolean nv = ui.toggle(on, right - 24, y + 11);
                if (nv != on) toggle(it, nv);
            }
            right -= 30;
        } else {
            badge(g, Tr.t("West"), right - g.textWidth("West") - 10, y + 11, Theme.alpha(t.accent, 0x50), 0xFFFFFFFF);
            right -= g.textWidth("West") + 16;
        }

        int tx = x + 34, maxT = right - tx - 6;
        String title = ModBridge.str(it, "title");
        if (title.isEmpty()) title = ModBridge.str(it, "file");
        int tw = Math.min(g.textBoldWidth(title), maxT);
        g.textBold(ui.fit(title, maxT), tx, y + 7, on ? 0xFFFFFFFF : 0xFF8D909A, false);
        // Rozetler: tür + bekleyen işlem + yeni
        int bx = tx + tw + 6;
        String kindLabel = switch (k) {
            case "resourcepack" -> Tr.t("Paket");
            case "shader" -> Tr.t("Shader");
            default -> null;
        };
        if (kindLabel != null && filter == 0 && bx + 40 < right) bx = badge(g, kindLabel, bx, y + 6, 0x26FFFFFF, 0xFFD0D2D8) + 4;
        if (op != null && bx + 60 < right) {
            String s = switch (op) {
                case "enable" -> Tr.t("açılacak");
                case "disable" -> Tr.t("kapanacak");
                case "delete" -> Tr.t("silinecek");
                case "update" -> Tr.t("güncellenecek");
                case "failed" -> Tr.t("açılamadı");
                default -> Tr.t("yeni");
            };
            boolean bad = op.equals("failed");
            bx = badge(g, s, bx, y + 6, bad ? 0x40E5566E : 0x40E8A33D, bad ? 0xFFF08A9A : 0xFFF2C27A) + 4;
        } else if (k.equals("mod") && ModBridge.bool(it, "enabled") && !loadedNow(it) && bx + 60 < right) {
            bx = badge(g, Tr.t("yeniden başlatınca"), bx, y + 6, 0x40E8A33D, 0xFFF2C27A) + 4;
        } else if (hasUpdate && bx + 40 < right) {
            bx = badge(g, Tr.t("güncelleme"), bx, y + 6, 0x4049C27A, 0xFF8BE3B0) + 4;
        }
        String ver = ModBridge.str(it, "version");
        String author = ModBridge.str(it, "author");
        String sub = (ver.isEmpty() ? ModBridge.str(it, "file") : ver) + (author.isEmpty() ? "" : " · " + author);
        String dep = ModBridge.str(it, "dependencyOf");
        if (!dep.isEmpty()) sub += " · " + Tr.t("{0} için", dep);
        smallText(g, ui.fit(sub, (int) (maxT / 0.8f)), tx, y + 20, 0x88FFFFFF);
        return y + h;
    }

    /** Görünen açık/kapalı durumu (bekleyen işlem ve canlı durum dikkate alınarak) */
    private boolean state(JsonObject it, String op) {
        String id = ModBridge.str(it, "id");
        boolean enabled = ModBridge.bool(it, "enabled");
        switch (ModBridge.str(it, "kind")) {
            case "resourcepack" -> {
                return enabled && game.activeResourcePacks().contains(id);
            }
            case "shader" -> {
                String act = game.activeShader();
                return enabled && act != null && act.equals(ModBridge.str(it, "file").replace(".disabled", ""));
            }
            default -> {
                if ("enable".equals(op)) return true;
                if ("disable".equals(op) || "delete".equals(op)) return false;
                return enabled;
            }
        }
    }

    /** Bu mod şu anki oturumda yüklü mü (dosyası yeni eklendiyse hayır) */
    private boolean loadedNow(JsonObject it) {
        JsonElement ids = it.get("modIds");
        if (ids == null || !ids.isJsonArray() || ids.getAsJsonArray().isEmpty()) return true;
        Set<String> loaded = game.loadedMods();
        if (loaded.isEmpty()) return true;
        for (JsonElement e : ids.getAsJsonArray()) if (loaded.contains(e.getAsString())) return true;
        return false;
    }

    private void toggle(JsonObject it, boolean on) {
        game.click();
        String id = ModBridge.str(it, "id");
        String k = ModBridge.str(it, "kind");
        boolean fileEnabled = ModBridge.bool(it, "enabled");
        switch (k) {
            case "resourcepack" -> {
                busy.add(id);
                if (on) {
                    Runnable apply = () -> WestHud.later(() -> game.applyResourcePacks(List.of(id), List.of(), () -> {
                        busy.remove(id);
                        api.say(Tr.t("{0} etkin", ModBridge.str(it, "title")));
                    }));
                    if (fileEnabled) apply.run();
                    else api.toggle(List.of(id), true, live -> apply.run());
                } else {
                    // Önce oyundan çıkar (Windows dosyayı kilitli tutar), sonra dosyayı kapat
                    game.applyResourcePacks(List.of(), List.of(id), () -> {
                        busy.remove(id);
                        api.say(Tr.t("{0} kapatıldı", ModBridge.str(it, "title")));
                    });
                }
            }
            case "shader" -> {
                if (!game.shadersSupported()) {
                    api.say(Tr.t("Shader için Iris gerekli"));
                    return;
                }
                String file = ModBridge.str(it, "file").replace(".disabled", "");
                if (!on) {
                    game.applyShader(null);
                    api.say(Tr.t("Shader kapatıldı"));
                } else if (fileEnabled) {
                    applyShader(file);
                } else {
                    busy.add(id);
                    api.toggle(List.of(id), true, live -> WestHud.later(() -> {
                        busy.remove(id);
                        applyShader(file);
                    }));
                }
            }
            default -> {
                busy.add(id);
                api.plan(List.of(id), on, extra -> {
                    if (extra.isEmpty()) {
                        doToggle(id, on);
                        return;
                    }
                    busy.remove(id);
                    List<String> names = new ArrayList<>();
                    for (JsonObject e : extra) names.add(ModBridge.str(e, "title"));
                    String title = ModBridge.str(it, "title");
                    dialog = on
                            ? new Dialog(Tr.t("Gerekli modlar da açılsın mı?"), Tr.t("{0} çalışmak için şunlara ihtiyaç duyuyor:", title), names, Tr.t("Hepsini aç"), false, () -> doToggle(id, true))
                            : new Dialog(Tr.t("Bağlı modlar da kapansın mı?"), Tr.t("Şu modlar {0} olmadan çalışmaz, onlar da kapanacak:", title), names, Tr.t("Hepsini kapat"), true, () -> doToggle(id, false));
                });
            }
        }
    }

    private void doToggle(String id, boolean on) {
        busy.add(id);
        api.toggle(List.of(id), on, live -> {
            busy.remove(id);
            api.say(on ? Tr.t("Yeniden başlatınca açılacak") : Tr.t("Yeniden başlatınca kapanacak"));
        });
    }

    private void applyShader(String file) {
        if (game.applyShader(file)) api.say(Tr.t("Shader uygulandı: {0}", file));
        else api.say(Tr.t("Shader uygulanamadı"));
    }

    private void askDelete(JsonObject it) {
        game.click();
        String id = ModBridge.str(it, "id");
        String k = ModBridge.str(it, "kind");
        String title = ModBridge.str(it, "title");
        String body = k.equals("mod") ? Tr.t("{0} oyun yeniden başlatılınca silinecek. Bekleyenler'den geri alabilirsin.", title) : Tr.t("{0} hemen silinecek.", title);
        List<String> extra = new ArrayList<>();
        dialog = new Dialog(Tr.t("Silinsin mi?"), body, extra, Tr.t("Sil"), true, () -> {
            busy.add(id);
            Runnable del = () -> api.delete(List.of(id), live -> {
                busy.remove(id);
                api.say(k.equals("mod") ? Tr.t("Yeniden başlatınca silinecek") : Tr.t("{0} silindi", title));
            });
            if (k.equals("resourcepack") && game.activeResourcePacks().contains(id)) game.applyResourcePacks(List.of(), List.of(id), del);
            else if (k.equals("shader") && ModBridge.str(it, "file").equals(game.activeShader())) {
                game.applyShader(null);
                del.run();
            } else del.run();
        });
    }

    // ───────── Güncellemeler ─────────

    private List<JsonObject> updatable() {
        List<JsonObject> out = new ArrayList<>();
        for (JsonObject it : api.items) {
            JsonElement up = it.get("update");
            if (up != null && up.isJsonObject() && !ModBridge.bool(it, "managed") && !"update".equals(pendingKind(ModBridge.str(it, "id")))) out.add(it);
        }
        return out;
    }

    private int updates(int x, int y, int w) {
        Gfx g = ui.g;
        if (!api.loaded) return loadingText(x, y, Tr.t("Yükleniyor…"));
        List<JsonObject> up = updatable();
        if (up.isEmpty()) {
            Icons.draw(g, Icon.CHECK, x, y + 4, 12, 0xFF4ADE80);
            g.text(api.refreshing ? Tr.t("Modrinth'te yeni sürümler aranıyor…") : Tr.t("Kurulu her şey en son sürümde."), x + 18, y + 6, 0xFFB9BDC7, false);
            return y + 24;
        }
        for (JsonObject it : up) {
            int h = 34;
            String id = ModBridge.str(it, "id");
            Ui.round(g, x, y, w, h, 8, 0xFF15161E);
            Ui.outline(g, x, y, w, h, 8, 0x14FFFFFF);
            icon(g, it, x + 6, y + 6, 22);
            JsonObject u = it.getAsJsonObject("update");
            String lbl = Tr.t("Güncelle");
            int bw = g.textWidth(lbl) + 14;
            int maxT = w - 34 - bw - 20;
            g.textBold(ui.fit(ModBridge.str(it, "title"), maxT), x + 34, y + 7, 0xFFFFFFFF, false);
            smallText(g, ui.fit(ModBridge.str(it, "version") + "  →  " + ModBridge.str(u, "versionNumber"), (int) (maxT / 0.8f)), x + 34, y + 20, 0xFF8BE3B0);
            if (busy.contains(id)) spinner(g, x + w - 20, y + 17, 0xCCFFFFFF);
            else if (pill(lbl, x + w - bw - 8, y + 10, bw, 14, true)) updateItems(List.of(it));
            y += h + 4;
        }
        smallText(g, Tr.t("Mod güncellemeleri yeniden başlatınca, paket ve shader güncellemeleri hemen uygulanır."), x, y + 2, 0x77FFFFFF);
        return y + 14;
    }

    private void updateItems(List<JsonObject> list) {
        game.click();
        List<String> ids = new ArrayList<>();
        List<String> activePacks = new ArrayList<>();
        Map<String, String> projectOf = new HashMap<>();
        Set<String> act = game.activeResourcePacks();
        for (JsonObject it : list) {
            String id = ModBridge.str(it, "id");
            ids.add(id);
            busy.add(id);
            if (act.contains(id)) {
                activePacks.add(id);
                projectOf.put(id, ModBridge.str(it, "projectId"));
            }
        }
        Runnable run = () -> api.update(ids, live -> {
            busy.removeAll(ids);
            int mods = 0;
            for (String i : ids) if (i.startsWith("mods/")) mods++;
            api.say(mods > 0 ? Tr.t("{0} mod yeniden başlatınca güncellenecek", mods) : Tr.t("Güncellendi"));
            // Güncellenen etkin paketleri yeni dosya adıyla yeniden etkinleştir
            if (!activePacks.isEmpty()) api.reload(() -> {
                List<String> again = new ArrayList<>();
                for (JsonObject it : api.items) if (projectOf.containsValue(ModBridge.str(it, "projectId")) && "resourcepack".equals(ModBridge.str(it, "kind"))) again.add(ModBridge.str(it, "id"));
                WestHud.later(() -> game.applyResourcePacks(again, List.of(), null));
            });
        });
        // Etkin kaynak paketleri önce bırakılır ki dosya değiştirilebilsin
        if (!activePacks.isEmpty()) game.applyResourcePacks(List.of(), activePacks, run);
        else run.run();
    }

    // ───────── Bekleyenler ─────────

    private int pendingList(int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        y = handoffCard(x, y, w);
        List<JsonObject> ops = api.pending;
        if (ops.isEmpty()) {
            Icons.draw(g, Icon.CHECK, x, y + 4, 12, 0xFF4ADE80);
            g.text(Tr.t("Bekleyen değişiklik yok."), x + 18, y + 6, 0xFFB9BDC7, false);
            smallText(g, Tr.t("Mod açma, kapama, silme ve kurma işlemleri burada toplanır; tek tıkla uygulanır."), x, y + 22, 0x77FFFFFF);
            return points(x, y + 40, w);
        }
        String failed = api.failedReason();
        if (failed != null) {
            y = note(x, y, w, Icon.CLOSE, Tr.t("Yeni oyun bu değişikliklerle açılamadı, oyunun korundu: {0}.", failed) + " " + Tr.t("Sorunlu olanı geri al, sonra Tekrar dene. Bu değişiklikler sen karar verene dek uygulanmaz."));
        } else y = note(x, y, w, Icon.SHIELD, Tr.t("Uygula'ya basınca oyun kapanmaz: yeni mod düzeni arka planda yüklenir, hazır olunca aynı yere geçersin. Yeni düzen çökerse bu oyun açık kalır."));
        for (int i = 0; i < ops.size(); i++) {
            JsonObject op = ops.get(i);
            int h = 28;
            Ui.round(g, x, y, w, h, 8, 0xFF15161E);
            Ui.outline(g, x, y, w, h, 8, 0x14FFFFFF);
            String k = ModBridge.str(op, "kind");
            Icon ic = switch (k) {
                case "delete" -> Icon.CLOSE;
                case "update" -> Icon.STAR;
                case "install" -> Icon.PLUS;
                case "disable" -> Icon.PAUSE;
                default -> Icon.PLAY;
            };
            boolean bad = op.has("failed") && !op.get("failed").isJsonNull();
            if (bad) Ui.outline(g, x, y, w, h, 8, 0x80E5566E);
            int col = bad || k.equals("delete") ? 0xFFE5566E : k.equals("disable") ? 0xFF9A9DA6 : t.accent | 0xFF000000;
            Ui.round(g, x + 6, y + 5, 18, 18, 5, Theme.alpha(col, 0x30));
            Icons.draw(g, ic, x + 10, y + 9, 10, col);
            String lbl = Tr.t("Geri al");
            int bw = g.textWidth(lbl) + 12;
            g.text(ui.fit(ModBridge.str(op, "label"), w - 40 - bw - 10), x + 30, y + 10, 0xFFE6E7EA, false);
            if (pill(lbl, x + w - bw - 8, y + 7, bw, 14, false)) {
                game.click();
                api.undo(i);
            }
            y += h + 4;
        }
        y += 4;
        if (!api.handoffRunning() && failed != null) {
            if (ui.button(Tr.t("Tekrar dene"), x, y, 160, 20, true)) {
                game.click();
                api.retry(() -> WestHud.later(this::askRestart));
            }
        } else if (!api.handoffRunning() && ui.button(Tr.t("Uygula"), x, y, 160, 20, true)) askRestart();
        if (failed == null) smallText(g, Tr.t("Ya da oyunu kapattığında otomatik uygulanır."), x, y + 26, 0x88FFFFFF);
        return points(x, y + 44, w);
    }

    /** Önceki düzenler: her uygulamadan önce kaydedilen geri dönüş noktaları */
    private int points(int x, int y, int w) {
        Gfx g = ui.g;
        List<JsonObject> pts = api.points;
        if (!api.pointsLoaded || pts.isEmpty()) return y;
        g.fill(x, y, x + w, y + 1, 0x14FFFFFF);
        y += 8;
        g.textBold(Tr.t("Önceki düzenler"), x, y, 0xFFFFFFFF, false);
        y += 12;
        for (String l : wrap(g, Tr.t("Her uygulamadan önce kaydedilir. Geri dönünce sonradan eklenenler silinmez, kapatılır."), (int) (w / 0.8f))) {
            smallText(g, l, x, y, 0x88FFFFFF);
            y += 9;
        }
        y += 6;
        java.time.format.DateTimeFormatter fmt = java.time.format.DateTimeFormatter.ofPattern("dd.MM HH:mm");
        for (JsonObject p : pts) {
            int h = 28;
            Ui.round(g, x, y, w, h, 8, 0xFF15161E);
            Ui.outline(g, x, y, w, h, 8, 0x14FFFFFF);
            long at = p.has("at") ? p.get("at").getAsLong() : 0;
            String when = java.time.Instant.ofEpochSecond(at).atZone(java.time.ZoneId.systemDefault()).format(fmt);
            Icons.draw(g, Icon.CLOCK, x + 9, y + 9, 10, 0xFF9A9DA6);
            String lbl = Tr.t("Bu düzene dön");
            int bw = g.textWidth(lbl) + 14;
            g.text(when, x + 26, y + 6, 0xFFE6E7EA, false);
            int counts = p.has("mods") ? p.get("mods").getAsInt() : 0;
            smallText(g, ui.fit(Tr.t("{0} mod · sonra: {1}", counts, ModBridge.str(p, "label")), (int) ((w - 40 - bw) / 0.8f)), x + 26, y + 17, 0x88FFFFFF);
            if (pill(lbl, x + w - bw - 8, y + 7, bw, 14, false)) {
                String id = ModBridge.str(p, "id");
                dialog = new Dialog(Tr.t("Bu düzene dönülsün mü?"), Tr.t("{0} tarihindeki mod düzenine dönülür. Diğer bekleyen değişiklikler iptal olur; sonradan eklenen modlar silinmez, kapatılır.", when), List.of(), Tr.t("Devam"), false,
                        () -> api.restorePoint(id, () -> WestHud.later(this::askRestart)));
            }
            y += h + 4;
        }
        return y;
    }

    private void pendingBar(int x, int y, int w, int h) {
        Gfx g = ui.g;
        Theme t = ui.t;
        Ui.round(g, x, y, w, h, 8, Theme.alpha(t.accent, 0x28));
        Ui.outline(g, x, y, w, h, 8, Theme.alpha(t.accent, 0x70));
        Icons.draw(g, Icon.CLOCK, x + 8, y + (h - 10) / 2, 10, t.accent | 0xFF000000);
        String lbl = api.handoffRunning() ? Tr.t("Yükleniyor… {0} sn", api.handoffSecs) : api.failedReason() != null ? Tr.t("İncele") : Tr.t("Uygula");
        int bw = g.textWidth(lbl) + 14;
        String see = Tr.t("Gör");
        int sw = g.textWidth(see) + 12;
        String s = api.failedReason() != null ? Tr.t("Bazı değişikliklerle oyun açılamadı") : Tr.t("{0} bekleyen değişiklik", api.pending.size());
        g.text(ui.fit(s, w - 30 - bw - sw - 16), x + 24, y + (h - 8) / 2, 0xFFFFFFFF, false);
        if (pill(see, x + w - bw - sw - 12, y + (h - 14) / 2, sw, 14, false)) setTab(Tab.PENDING);
        if (pill(lbl, x + w - bw - 6, y + (h - 14) / 2, bw, 14, true)) {
            if (api.handoffRunning() || api.failedReason() != null) setTab(Tab.PENDING);
            else askRestart();
        }
    }

    private void askRestart() {
        game.click();
        if (api.handoffRunning()) {
            api.say(Tr.t("Yeni mod düzeni zaten yükleniyor"));
            return;
        }
        String world = game.worldFolder(), server = game.serverAddress();
        String where = world != null ? Tr.t("Hazır olunca dünyan kaydedilir ve aynı dünyaya geçersin.") : server != null ? Tr.t("Hazır olunca sunucuya ({0}) otomatik yeniden bağlanırsın.", server) : "";
        List<String> names = new ArrayList<>();
        for (JsonObject op : api.pending) names.add(ModBridge.str(op, "label"));
        dialog = new Dialog(Tr.t("Değişiklikler uygulansın mı?"),
                (Tr.t("Oyun kapanmaz: yeni mod düzeni arka planda yüklenirken oynamaya devam edersin.") + " " + where + " "
                        + Tr.t("Yeni düzen çökerse bu oyun açık kalır ve hiçbir şey değişmez.")).replace("  ", " ").strip(),
                names, Tr.t("Uygula"), false, () -> {
                    String join = world != null ? "world:" + world : server;
                    api.restart(join, () -> {
                        // Yeterli bellek yoksa: klasik ama hızlı yeniden başlatma
                        api.say(Tr.t("Yeniden başlatılıyor…"));
                        WestHud.later(game::stopGame);
                    });
                    api.say(Tr.t("Yeni mod düzeni hazırlanıyor…"));
                    close();
                });
    }

    /** Devralma sürüyorsa ya da çöktüyse durum kartı; içerik y'sini döner */
    private int handoffCard(int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String st = api.handoffState;
        if (st == null) return y;
        boolean failed = "failed".equals(st);
        if (!failed && !api.handoffRunning()) return y;
        String msg = failed ? Tr.t("Yeni mod düzeni açılamadı; oyunun açık kaldı, değişiklikler uygulanmadı.")
                : "ready".equals(st) ? Tr.t("Yeni mod düzeni hazır · geçiliyor…") : Tr.t("Yeni mod düzeni arka planda yükleniyor · {0} sn", api.handoffSecs);
        List<String> lines = wrap(g, msg, w - 100);
        if (failed && api.handoffError != null) lines.addAll(wrap(g, api.handoffError, w - 100));
        int h = 12 + lines.size() * 11;
        Ui.round(g, x, y, w, h, 8, failed ? 0x30E5566E : Theme.alpha(t.accent, 0x26));
        Ui.outline(g, x, y, w, h, 8, failed ? 0x80E5566E : Theme.alpha(t.accent, 0x80));
        if (failed) Icons.draw(g, Icon.CLOSE, x + 8, y + 7, 9, 0xFFE5566E);
        else spinner(g, x + 12, y + 11, t.accent | 0xFF000000);
        int ly = y + 7;
        for (int i = 0; i < lines.size(); i++) {
            g.text(lines.get(i), x + 24, ly, i == 0 ? 0xFFFFFFFF : 0xFFF08A9A, false);
            ly += 11;
        }
        String b = failed ? Tr.t("Tamam") : Tr.t("İptal");
        int bw = g.textWidth(b) + 14;
        if (pill(b, x + w - bw - 8, y + (h - 14) / 2, bw, 14, false)) {
            if (failed) api.handoffState = null;
            else api.cancelHandoff();
        }
        return y + h + 6;
    }

    // ───────── Setler ─────────

    private int setsTab(int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        y = note(x, y, w, Icon.LIST, Tr.t("Set, hangi modların ve paketlerin açık olacağını hatırlar (ör. PvP, Shader, Hafif). Sete geçince paketler hemen değişir, modlar oyun kapanmadan arka planda uygulanır."));
        if (!api.setsLoaded) return loadingText(x, y, Tr.t("Yükleniyor…"));
        List<JsonObject> sets = api.sets;
        if (sets.isEmpty()) {
            g.text(Tr.t("Henüz set yok. Modlarını istediğin gibi aç-kapat, sonra aşağıdan kaydet."), x, y + 2, 0x99FFFFFF, false);
            y += 18;
        }
        for (JsonObject m : sets) {
            String id = ModBridge.str(m, "id"), name = ModBridge.str(m, "name");
            boolean active = id.equals(api.activeSet);
            int h = 30;
            Ui.round(g, x, y, w, h, 8, active ? Theme.alpha(t.accent, 0x22) : 0xFF15161E);
            Ui.outline(g, x, y, w, h, 8, active ? Theme.alpha(t.accent, 0x80) : 0x14FFFFFF);
            letter(g, name, "mod", x + 6, y + 5, 20);
            int on = m.get("enabled") instanceof JsonArray a ? a.size() : 0, off = m.get("disabled") instanceof JsonArray b ? b.size() : 0;
            String lbl = active ? Tr.t("Etkin") : Tr.t("Geç");
            int bw = g.textWidth(lbl) + 16;
            g.textBold(ui.fit(name, w - 40 - bw - 16), x + 32, y + 6, 0xFFFFFFFF, false);
            smallText(g, Tr.t("{0} açık · {1} kapalı", on, off), x + 32, y + 18, 0x88FFFFFF);
            if (active) badge(g, lbl, x + w - bw - 8, y + 10, Theme.alpha(t.accent, 0x50), 0xFFFFFFFF);
            else if (pill(lbl, x + w - bw - 8, y + 8, bw, 14, true)) switchSet(id, name);
            if (smallIcon("share" + id, Icon.SHARE, x + w - bw - 30, y + 7, 16, t.accent | 0xFF000000, Tr.t("Paylaş"))) {
                game.click();
                api.exportSet(id, (code, skipped) -> WestHud.later(() -> {
                    game.setClipboard(code);
                    api.say(skipped > 0 ? Tr.t("Kod kopyalandı · {0} dosya Modrinth'te olmadığı için dışarıda kaldı", skipped) : Tr.t("Set kodu kopyalandı; arkadaşına yapıştır"));
                }));
            }
            y += h + 4;
        }
        // Yeni set: şu anki düzeni kaydet
        y += 6;
        String saveLbl = Tr.t("Şu anki düzeni kaydet");
        int sbw = g.textWidth(saveLbl) + 16;
        int fw = Math.min(220, w - sbw - 6);
        boolean hv = ui.hover(x, y, fw, 18);
        Ui.round(g, x, y, fw, 18, 6, setNameFocus ? 0x99000000 : hv ? 0x80000000 : 0x66000000);
        Ui.outline(g, x, y, fw, 18, 6, setNameFocus ? Theme.alpha(t.accent, 0xCC) : 0x26FFFFFF);
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        String shown = setName.isEmpty() && !setNameFocus ? Tr.t("Yeni set adı (ör. PvP)") : setName + (setNameFocus && blink ? "|" : "");
        g.text(ui.fit(shown, fw - 12), x + 6, y + 5, setName.isEmpty() && !setNameFocus ? 0x77FFFFFF : 0xFFFFFFFF, false);
        if (ui.clicked(x, y, fw, 18)) {
            setNameFocus = true;
            searchFocus = false;
        } else if (!hv && ui.pressedAt(0, 0, 99999, 99999)) setNameFocus = false;
        if (pill(saveLbl, x + fw + 6, y + 2, sbw, 14, !setName.isBlank())) saveSet();
        smallText(g, Tr.t("Bekleyen değişiklikler kayda girmez; önce uygula."), x, y + 24, 0x77FFFFFF);
        y += 38;
        String imp = api.importing ? Tr.t("Kuruluyor…") : Tr.t("Panodaki set kodunu ekle");
        int iw = g.textWidth(imp) + 16;
        if (api.importing) spinner(g, x + 8, y + 7, 0xCCFFFFFF);
        else if (pill(imp, x, y, iw, 14, false)) importFromClipboard();
        smallText(g, Tr.t("Arkadaşının \"WEST-SET:…\" kodunu kopyala, sonra buna bas. Eksik modlar Modrinth'ten kurulur."), x, y + 18, 0x77FFFFFF);
        return y + 32;
    }

    private void importFromClipboard() {
        String code = game.clipboard().trim();
        if (!code.startsWith("WEST-SET:")) {
            api.say(Tr.t("Panoda set kodu yok. Önce \"WEST-SET:…\" kodunu kopyala."));
            return;
        }
        api.importSet(code, o -> {
            String name = ModBridge.str(o, "name");
            int installed = o.has("installed") ? o.get("installed").getAsInt() : 0;
            int missing = o.has("missing") ? o.getAsJsonArray("missing").size() : 0;
            String msg = Tr.t("\"{0}\" seti eklendi · {1} içerik kuruldu", name, installed);
            if (missing > 0) msg += " · " + Tr.t("{0} tanesi bu sürüm için yok", missing);
            api.say(msg);
        });
    }

    private void saveSet() {
        String n = setName.trim();
        if (n.isEmpty()) {
            setNameFocus = true;
            return;
        }
        setNameFocus = false;
        setName = "";
        api.saveSet(n, null);
    }

    private void switchSet(String id, String name) {
        if (api.handoffRunning()) {
            api.say(Tr.t("Yeni mod düzeni zaten yükleniyor"));
            return;
        }
        api.switchSet(id, (on, off, mods) -> WestHud.later(() -> {
            List<String> packsOn = new ArrayList<>(), packsOff = new ArrayList<>();
            for (String i : on) if (i.startsWith("resourcepacks/")) packsOn.add(i);
            for (String i : off) if (i.startsWith("resourcepacks/")) packsOff.add(i);
            // Kapatılacak paketler önce oyundan çıkarılır (dosya kilidi), sonra diskte kapatılır
            if (!packsOn.isEmpty() || !packsOff.isEmpty()) game.applyResourcePacks(packsOn, packsOff, () -> { if (!off.isEmpty()) api.toggle(off, false, l -> {}); });
            else if (!off.isEmpty()) api.toggle(off, false, l -> {});
            if (mods > 0) askRestart();
            else api.say(Tr.t("\"{0}\" setine geçildi", name));
        }));
    }

    // ───────── Keşfet ─────────

    private void newSearch() {
        api.resetSearch();
        scrollTarget = scroll = 0;
    }

    private int browse(int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String k = KINDS[kind];
        if (k.equals("datapack") && game.worldFolder() == null) {
            return note(x, y, w, Icon.WORLD, Tr.t("Veri paketleri dünyaya kurulur. Tek oyunculu bir dünyaya girip Mod Merkezi'ni orada aç."));
        }
        if (k.equals("shader") && !game.shadersSupported()) y = note(x, y, w, Icon.SUN, Tr.t("Shader'lar Iris ile çalışır. Önce Mod sekmesinden Iris'i kur."));
        // Yazmayı bitirince ara (her harfte istek atma)
        if (System.currentTimeMillis() - typedAt > 350) api.search(search.trim(), k, SORTS[sort], cats().length > 0 ? cats()[cat][0] : "", 0);
        List<JsonObject> hits = api.hits;
        if (hits.isEmpty()) {
            if (api.searching) return loadingText(x, y, Tr.t("Modrinth'te aranıyor…"));
            g.text(api.error != null ? api.error : Tr.t("Sonuç yok. Başka bir şey dene."), x, y + 4, 0x99FFFFFF, false);
            return y + 20;
        }
        int gap = 6, cols = w >= 420 ? 2 : 1;
        int cw = (w - gap * (cols - 1)) / cols, ch = 52;
        for (int i = 0; i < hits.size(); i++) {
            JsonObject h = hits.get(i);
            int ex = x + (i % cols) * (cw + gap), ey = y + (i / cols) * (ch + gap);
            hitCard(h, ex, ey, cw, ch);
        }
        int rows = (hits.size() + cols - 1) / cols;
        y += rows * (ch + gap);
        if (hits.size() < api.total) {
            if (api.searching) loadingText(x + w / 2 - 30, y + 2, Tr.t("Yükleniyor…"));
            else if (ui.button(Tr.t("Daha fazla göster"), x + w / 2 - 60, y, 120, 18, false)) {
                api.search(search.trim(), k, SORTS[sort], cats().length > 0 ? cats()[cat][0] : "", hits.size());
            }
            y += 24;
        }
        smallText(g, Tr.t("Yalnızca {0} {1} ile uyumlu içerik gösterilir. Kaynak: Modrinth", game.loaderName(), game.minecraftVersion()), x, y + 2, 0x66FFFFFF);
        return y + 14;
    }

    private void hitCard(JsonObject h, int x, int y, int w, int hh) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String id = ModBridge.str(h, "id");
        boolean hv = ui.hover(x, y, w, hh);
        float a = hov("hit" + id, hv);
        Ui.round(g, x, y, w, hh, 8, Theme.mix(0xFF15161E, 0xFF1C1E28, a));
        Ui.outline(g, x, y, w, hh, 8, Theme.alpha(0xFFFFFFFF, (int) (0x12 + 0x20 * a)));
        remoteIcon(g, ModBridge.str(h, "icon"), x + 7, y + 7, 30);
        boolean installed = ModBridge.bool(h, "installed");
        boolean inst = api.installing.containsKey(id);
        String lbl = installed ? Tr.t("Kurulu") : Tr.t("Kur");
        int bw = Math.max(36, g.textWidth(lbl) + 14);
        int bx = x + w - bw - 8, by = y + 8;
        int tx = x + 44, maxT = bx - tx - 6;
        g.textBold(ui.fit(ModBridge.str(h, "title"), maxT), tx, y + 8, 0xFFFFFFFF, false);
        smallText(g, ui.fit(Tr.t("{0} · {1} indirme", ModBridge.str(h, "author"), fmt(h.get("downloads"))), (int) (maxT / 0.8f)), tx, y + 19, 0x88FFFFFF);
        smallText(g, ui.fit(ModBridge.str(h, "description"), (int) ((w - 52) / 0.8f)), tx, y + 32, 0xFFB0B3BC);
        boolean clickedBtn = false;
        if (inst) spinner(g, bx + bw / 2, by + 7, 0xCCFFFFFF);
        else if (installed) badge(g, lbl, bx, by + 1, 0x3049C27A, 0xFF8BE3B0);
        else clickedBtn = pill(lbl, bx, by, bw, 14, true);
        if (clickedBtn) install(id, ModBridge.str(h, "title"));
        else if (ui.clicked(x, y, w, hh)) {
            game.click();
            detailId = id;
            detailScroll = detailScrollTarget = 0;
            api.open(id, KINDS[kind]);
        }
    }

    private void install(String projectId, String title) {
        game.click();
        String k = KINDS[kind];
        String world = game.worldFolder();
        api.install(projectId, k, world, o -> WestHud.later(() -> afterInstall(k, title, o)));
    }

    private void afterInstall(String k, String title, JsonObject o) {
        switch (k) {
            case "datapack" -> {
                String file = ModBridge.str(o, "file");
                game.enableDatapack(file);
                api.say(Tr.t("{0} dünyada etkinleştirildi", title));
            }
            case "resourcepack" -> {
                List<String> ids = new ArrayList<>();
                for (String f : reportFiles(o)) ids.add("resourcepacks/" + f);
                if (!ids.isEmpty()) game.applyResourcePacks(ids, List.of(), () -> api.say(Tr.t("{0} kuruldu ve etkinleştirildi", title)));
                else api.say(Tr.t("{0} kuruldu", title));
            }
            case "shader" -> {
                List<String> files = reportFiles(o);
                if (!files.isEmpty() && game.shadersSupported()) {
                    String f = files.get(0);
                    dialog = new Dialog(Tr.t("Shader kuruldu"), Tr.t("{0} şimdi uygulansın mı?", title), List.of(), Tr.t("Uygula"), false, () -> applyShader(f));
                } else api.say(Tr.t("{0} kuruldu", title));
            }
            default -> {
                List<String> files = reportFiles(o);
                api.say(files.size() > 1 ? Tr.t("{0} ve {1} gerekli mod kuruldu · yeniden başlatınca yüklenir", title, files.size() - 1) : Tr.t("{0} kuruldu · yeniden başlatınca yüklenir", title));
            }
        }
    }

    private static List<String> reportFiles(JsonObject o) {
        List<String> out = new ArrayList<>();
        JsonElement r = o.get("report");
        if (r != null && r.isJsonObject() && r.getAsJsonObject().get("installed") instanceof JsonArray a)
            for (JsonElement e : a) if (e.isJsonObject()) out.add(ModBridge.str(e.getAsJsonObject(), "file"));
        return out;
    }

    /** Proje ayrıntısı penceresi */
    private void detail(int px, int py, int pw, int ph) {
        Gfx g = ui.g;
        Theme t = ui.t;
        g.fill(px, py, px + pw, py + ph, 0x99000000);
        int w = Math.min(460, pw - 40), h = ph - 30;
        int x = px + (pw - w) / 2, y = py + 15;
        Ui.round(g, x, y + 2, w, h, 11, 0x60000000);
        Ui.round(g, x, y, w, h, 10, 0xFA101118);
        Ui.outline(g, x, y, w, h, 10, 0x26FFFFFF);
        if (iconButton("dclose", Icon.CLOSE, x + w - 24, y + 6, 18, 0xFFE5566E)) {
            detailId = null;
            return;
        }
        JsonObject d = api.detail;
        JsonObject hit = null;
        for (JsonObject hh : api.hits) if (detailId.equals(ModBridge.str(hh, "id"))) hit = hh;
        String title = d != null ? ModBridge.str(d, "title") : hit != null ? ModBridge.str(hit, "title") : "";
        String iconUrl = d != null ? ModBridge.str(d, "icon_url") : hit != null ? ModBridge.str(hit, "icon") : "";
        remoteIcon(g, iconUrl, x + 12, y + 12, 40);
        bigText(g, ui.fit(title, (int) ((w - 100) / 1.2f)), x + 60, y + 14, 0xFFFFFFFF, 1.2f);
        String owner = d != null ? ModBridge.str(d, "ownerName") : hit != null ? ModBridge.str(hit, "author") : "";
        long dl = d != null && d.has("downloads") ? d.get("downloads").getAsLong() : hit != null && hit.has("downloads") ? hit.get("downloads").getAsLong() : 0;
        smallText(g, ui.fit(Tr.t("{0} · {1} indirme", owner, fmt(dl)), (int) ((w - 80) / 0.8f)), x + 60, y + 30, 0x99FFFFFF);
        if (d == null) {
            if (api.detailLoading) loadingText(x + 12, y + 64, Tr.t("Yükleniyor…"));
            else g.text(api.error != null ? api.error : Tr.t("Ayrıntılar alınamadı."), x + 12, y + 64, 0x99FFFFFF, false);
            return;
        }
        // Kur düğmesi + uyumluluk
        String pid = ModBridge.str(d, "id");
        boolean installed = ModBridge.bool(d, "installed");
        boolean inst = api.installing.containsKey(pid);
        JsonElement comp = d.get("compatible");
        boolean compatible = comp != null && comp.isJsonObject();
        int by = y + 60;
        String lbl = installed ? Tr.t("Kurulu") : compatible ? Tr.t("Kur") : Tr.t("Uyumlu sürüm yok");
        int bw = Math.max(70, g.textWidth(lbl) + 20);
        if (inst) spinner(g, x + 12 + bw / 2, by + 9, 0xCCFFFFFF);
        else if (installed) badge(g, lbl, x + 12, by + 3, 0x3049C27A, 0xFF8BE3B0);
        else if (!compatible) badge(g, lbl, x + 12, by + 3, 0x30E5566E, 0xFFF08A9A);
        else if (ui.button(lbl, x + 12, by, bw, 18, true)) install(pid, title);
        int ix = x + 12 + bw + 8;
        if (compatible) {
            JsonObject c = comp.getAsJsonObject();
            smallText(g, ui.fit(Tr.t("Sürüm {0} · {1} {2}", ModBridge.str(c, "number"), game.loaderName(), game.minecraftVersion()), (int) ((w - bw - 120) / 0.8f)), ix, by + 6, 0xFF8BE3B0);
        }
        String slug = ModBridge.str(d, "slug");
        if (ui.button(Tr.t("Modrinth'te aç"), x + w - 104, by, 92, 18, false)) {
            game.click();
            game.openUrl("https://modrinth.com/project/" + (slug.isEmpty() ? pid : slug));
        }
        // Çipler: kategoriler + istemci/sunucu
        int cy = by + 26, cx = x + 12;
        List<String> chips = new ArrayList<>();
        if (d.get("categories") instanceof JsonArray cats) for (JsonElement e : cats) chips.add(e.getAsString());
        String cs = ModBridge.str(d, "client_side"), ss = ModBridge.str(d, "server_side");
        if (cs.equals("required") && ss.equals("unsupported")) chips.add(Tr.t("yalnızca istemci"));
        else if (ss.equals("required") && cs.equals("unsupported")) chips.add(Tr.t("yalnızca sunucu"));
        else if (cs.equals("required") && ss.equals("required")) chips.add(Tr.t("istemci + sunucu"));
        for (String c : chips) {
            int cw = g.textWidth(c) + 12;
            if (cx + cw > x + w - 12) break;
            Ui.round(g, cx, cy, cw, 13, 6, 0x22FFFFFF);
            g.text(c, cx + 6, cy + 3, 0xFFD0D2D8, false);
            cx += cw + 4;
        }
        if (ss.equals("required") && game.serverAddress() != null && KINDS[kind].equals("mod")) {
            cy += 17;
            smallText(g, ui.fit(Tr.t("Bu mod sunucuda da gerekli; yalnızca sende kurulu olursa bağlanamayabilirsin."), (int) ((w - 24) / 0.8f)), x + 12, cy, 0xFFF2C27A);
        }
        // Açıklama (kaydırılabilir)
        int ty = cy + 20, th = y + h - 10 - ty;
        g.fill(x + 12, ty - 4, x + w - 12, ty - 3, 0x14FFFFFF);
        detailScroll += (detailScrollTarget - detailScroll) * Math.min(1, dt * 18);
        g.scissor(x + 8, ty, x + w - 8, ty + th);
        int ly = ty - Math.round(detailScroll);
        List<String> lines = wrap(g, cleanMarkdown(ModBridge.str(d, "description") + "\n\n" + ModBridge.str(d, "body")), w - 28);
        for (String line : lines) {
            if (ly > ty - 12 && ly < ty + th) {
                boolean head = line.startsWith("\u0001");
                String s = head ? line.substring(1) : line;
                if (head) g.textBold(s, x + 14, ly, 0xFFFFFFFF, false);
                else g.text(s, x + 14, ly, 0xFFC4C7CF, false);
            }
            ly += 11;
        }
        g.noScissor();
        float max = Math.max(0, lines.size() * 11 - th);
        detailScrollTarget = Math.max(0, Math.min(max, detailScrollTarget));
    }

    /** Markdown/HTML'i düz yazıya çevir; başlık satırları \u0001 ile işaretlenir */
    private static String cleanMarkdown(String s) {
        StringBuilder out = new StringBuilder();
        for (String raw : s.replace("\r", "").split("\n")) {
            String l = raw.strip();
            l = l.replaceAll("<[^>]*>", "").replaceAll("!\\[[^]]*]\\([^)]*\\)", "").replaceAll("\\[([^]]*)]\\([^)]*\\)", "$1")
                    .replace("**", "").replace("__", "").replace("`", "").replace("&nbsp;", " ").replace("&amp;", "&");
            if (l.matches("^-{3,}$|^\\*{3,}$|^\\|?[- :|]+\\|?$")) continue;
            if (l.startsWith("#")) l = "\u0001" + l.replaceAll("^#+\\s*", "");
            else if (l.startsWith("- ") || l.startsWith("* ")) l = "• " + l.substring(2);
            out.append(l).append('\n');
        }
        return out.toString().replaceAll("\n{3,}", "\n\n").strip();
    }

    private static List<String> wrap(Gfx g, String text, int max) {
        List<String> out = new ArrayList<>();
        for (String para : text.split("\n")) {
            boolean head = para.startsWith("\u0001");
            String p = head ? para.substring(1) : para;
            if (p.isBlank()) {
                if (!out.isEmpty() && !out.get(out.size() - 1).isEmpty()) out.add("");
                continue;
            }
            StringBuilder line = new StringBuilder();
            for (String word : p.split(" ")) {
                String tryLine = line.isEmpty() ? word : line + " " + word;
                if (g.textWidth(tryLine) > max && !line.isEmpty()) {
                    out.add((head ? "\u0001" : "") + line);
                    line = new StringBuilder(word);
                } else line = new StringBuilder(tryLine);
            }
            if (!line.isEmpty()) out.add((head ? "\u0001" : "") + line);
            if (out.size() > 400) break;
        }
        return out;
    }

    // ───────── Pencereler ─────────

    private void dialog(int sw, int sh) {
        Gfx g = ui.g;
        Theme t = ui.t;
        Dialog d = dialog;
        g.fill(0, 0, sw, sh, 0x88000000);
        int w = Math.min(320, sw - 40);
        List<String> body = wrap(g, d.body(), w - 28);
        int listN = Math.min(d.list().size(), 6);
        int h = 40 + body.size() * 11 + (listN > 0 ? listN * 12 + 8 : 0) + (d.list().size() > 6 ? 12 : 0) + 26;
        int x = (sw - w) / 2, y = (sh - h) / 2;
        Ui.round(g, x, y + 3, w, h, 11, 0x70000000);
        Ui.round(g, x, y, w, h, 10, 0xFC12131A);
        Ui.outline(g, x, y, w, h, 10, d.danger() ? 0x66E5566E : Theme.alpha(t.accent, 0x66));
        g.textBold(ui.fit(d.title(), w - 28), x + 14, y + 14, 0xFFFFFFFF, false);
        int ly = y + 32;
        for (String l : body) {
            g.text(l, x + 14, ly, 0xFFC4C7CF, false);
            ly += 11;
        }
        if (listN > 0) {
            ly += 4;
            for (int i = 0; i < listN; i++) {
                Ui.round(g, x + 16, ly + 3, 3, 3, 1, d.danger() ? 0xFFE5566E : t.accent | 0xFF000000);
                g.text(ui.fit(d.list().get(i), w - 40), x + 24, ly, 0xFFE6E7EA, false);
                ly += 12;
            }
            if (d.list().size() > 6) {
                smallText(g, Tr.t("ve {0} tane daha", d.list().size() - 6), x + 24, ly, 0x88FFFFFF);
                ly += 12;
            }
        }
        int byy = y + h - 26;
        int bw = (w - 34) / 2;
        if (ui.button(Tr.t("Vazgeç"), x + 14, byy, bw, 18, false)) {
            game.click();
            dialog = null;
            return;
        }
        boolean hv = ui.hover(x + 20 + bw, byy, bw, 18);
        if (d.danger()) {
            Ui.round(g, x + 20 + bw, byy, bw, 18, 6, hv ? 0xFFF06A80 : 0xFFE5566E);
            String s = d.yes();
            g.textBold(s, x + 20 + bw + (bw - g.textBoldWidth(s)) / 2, byy + 5, 0xFFFFFFFF, false);
            if (ui.clicked(x + 20 + bw, byy, bw, 18)) confirm(d);
        } else if (ui.button(d.yes(), x + 20 + bw, byy, bw, 18, true)) confirm(d);
    }

    private void confirm(Dialog d) {
        game.click();
        dialog = null;
        d.onYes().run();
    }

    private void toast(Gfx g, int sw, int bottom) {
        String msg = api.toast;
        if (msg == null) return;
        long age = System.currentTimeMillis() - api.toastAt;
        if (age > 3500) return;
        float a = age < 150 ? age / 150f : age > 3000 ? 1 - (age - 3000) / 500f : 1;
        g.nextLayer();
        int w = Math.min(g.textWidth(msg) + 28, sw - 40);
        int x = (sw - w) / 2, y = bottom - 34 + Math.round((1 - a) * 8);
        Ui.round(g, x, y, w, 20, 10, Theme.alpha(0xFF1C1E28, (int) (0xF5 * a)));
        Ui.outline(g, x, y, w, 20, 10, Theme.alpha(ui.t.accent, (int) (0x90 * a)));
        g.text(ui.fit(msg, w - 24), x + 14, y + 6, Theme.alpha(0xFFFFFFFF, Math.max(8, (int) (255 * a))), false);
    }

    // ───────── Yardımcı çizimler ─────────

    /** Kurulu öğenin simgesi: data: URL'si, Modrinth simgesi ya da baş harf */
    private void icon(Gfx g, JsonObject it, int x, int y, int s) {
        String id = ModBridge.str(it, "id");
        String url = ModBridge.str(it, "icon");
        if (url.startsWith("data:")) {
            byte[] png = dataIcons.computeIfAbsent(id, k -> {
                try {
                    return Base64.getDecoder().decode(url.substring(url.indexOf(',') + 1));
                } catch (Exception e) {
                    return new byte[0];
                }
            });
            Ui.round(g, x, y, s, s, 5, 0xFF1A1C24);
            if (png.length > 0 && g.png("ic_" + id, png, x, y, s, s)) return;
        } else if (url.startsWith("https://")) {
            remoteIcon(g, url, x, y, s);
            return;
        }
        letter(g, ModBridge.str(it, "title"), ModBridge.str(it, "kind"), x, y, s);
    }

    private void remoteIcon(Gfx g, String url, int x, int y, int s) {
        Ui.round(g, x, y, s, s, 6, 0xFF1A1C24);
        byte[] png = url.isEmpty() ? null : api.icon(url);
        if (png != null && g.png("rc_" + Integer.toHexString(url.hashCode()), png, x, y, s, s)) return;
        Icons.draw(g, Icon.BOX, x + s / 4, y + s / 4, s / 2, 0x55FFFFFF);
    }

    private void letter(Gfx g, String title, String kind, int x, int y, int s) {
        Theme t = ui.t;
        int c = kind.equals("shader") ? 0xFF7F9CF5 : kind.equals("resourcepack") ? 0xFF70C48E : t.accent | 0xFF000000;
        Ui.round(g, x, y, s, s, 6, Theme.alpha(c, 0x50));
        String ch = title.isEmpty() ? "?" : title.substring(0, 1).toUpperCase(Locale.ROOT);
        g.textBold(ch, x + (s - g.textBoldWidth(ch)) / 2, y + (s - 8) / 2, 0xFFFFFFFF, false);
    }

    private int badge(Gfx g, String s, int x, int y, int bg, int fg) {
        int w = Math.round(g.textWidth(s) * 0.8f) + 8;
        Ui.round(g, x, y, w, 11, 5, bg);
        smallText(g, s, x + 4, y + 2, fg);
        return x + w;
    }

    private boolean pill(String label, int x, int y, int w, int h, boolean primary) {
        Gfx g = ui.g;
        Theme t = ui.t;
        boolean hv = ui.hover(x, y, w, h);
        int bg = primary ? (hv ? Theme.mix(t.accent | 0xFF000000, 0xFFFFFFFF, 0.15f) : t.accent | 0xFF000000) : hv ? 0x40FFFFFF : 0x22FFFFFF;
        Ui.round(g, x, y, w, h, h / 2, bg);
        g.text(label, x + (w - g.textWidth(label)) / 2, y + (h - 8) / 2, primary ? t.onAccent : 0xFFFFFFFF, false);
        if (ui.clicked(x, y, w, h)) {
            game.click();
            return true;
        }
        return false;
    }

    private boolean smallIcon(String id, Icon icon, int x, int y, int s, int hoverColor, String tip) {
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, s, s);
        float h = hov(id, on);
        if (h > 0.01f) Ui.round(g, x, y, s, s, 5, Theme.alpha(hoverColor, (int) (0x40 * h)));
        Icons.draw(g, icon, x + 4, y + 4, s - 8, Theme.mix(0x88FFFFFF, hoverColor, h));
        return ui.clicked(x, y, s, s);
    }

    private int note(int x, int y, int w, Icon icon, String text) {
        Gfx g = ui.g;
        List<String> lines = wrap(g, text, w - 34);
        int h = 10 + lines.size() * 11;
        Ui.round(g, x, y, w, h, 7, 0x14FFFFFF);
        Icons.draw(g, icon, x + 8, y + 6, 10, Theme.alpha(ui.t.accent, 0xDD));
        int ly = y + 6;
        for (String l : lines) {
            g.text(l, x + 24, ly, 0xFFC4C7CF, false);
            ly += 11;
        }
        return y + h + 6;
    }

    private int loadingText(int x, int y, String s) {
        Gfx g = ui.g;
        spinner(g, x + 5, y + 8, 0xAAFFFFFF);
        g.text(s, x + 14, y + 4, 0x99FFFFFF, false);
        return y + 20;
    }

    /** Dönen nokta göstergesi */
    private void spinner(Gfx g, int cx, int cy, int color) {
        float t = ui.time * 6;
        for (int i = 0; i < 6; i++) {
            double a = t + i * Math.PI / 3;
            int px = cx + (int) Math.round(Math.cos(a) * 4), py = cy + (int) Math.round(Math.sin(a) * 4);
            Ui.round(g, px - 1, py - 1, 2, 2, 1, Theme.alpha(color, 40 + i * 35));
        }
    }

    private void searchBox(int x, int y, int w, int h) {
        Theme t = ui.t;
        Gfx g = ui.g;
        boolean on = ui.hover(x, y, w, h);
        Ui.round(g, x, y, w, h, 6, searchFocus ? 0x99000000 : on ? 0x80000000 : 0x66000000);
        Ui.outline(g, x, y, w, h, 6, searchFocus ? Theme.alpha(t.accent, 0xCC) : 0x26FFFFFF);
        Icons.draw(g, Icon.SEARCH, x + 5, y + (h - 9) / 2, 9, 0x99FFFFFF);
        boolean blink = ((int) (ui.time * 2)) % 2 == 0;
        String hint = tab == Tab.BROWSE ? Tr.t("Modrinth'te ara") : Tr.t("Ara");
        String shown = search.isEmpty() && !searchFocus ? hint : search + (searchFocus && blink ? "|" : "");
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
            game.click();
            return true;
        }
        return false;
    }

    private String pendingKind(String id) {
        String kind = null;
        for (JsonObject op : api.pending) {
            if (op.get("ids") instanceof JsonArray a) for (JsonElement e : a) if (id.equals(e.getAsString())) kind = op.has("failed") && !op.get("failed").isJsonNull() ? "failed" : ModBridge.str(op, "kind");
        }
        return kind;
    }

    private void setTab(Tab p) {
        if (p == Tab.SETS) api.loadSets();
        if (p == Tab.PENDING) api.loadPoints();
        if (tab == p) return;
        tab = p;
        lastTab = p.ordinal();
        scroll = scrollTarget = 0;
        search = "";
        searchFocus = false;
        game.click();
    }

    private void refresh() {
        switch (tab) {
            case BROWSE -> newSearch();
            case UPDATES -> api.checkUpdates();
            default -> api.reload();
        }
    }

    private void close() {
        game.click();
        if (back != null) goBack = true;
        else game.closeModHub();
    }

    @Override
    public WestScreen next() {
        if (!goBack) return null;
        goBack = false;
        return back;
    }

    private float hov(String id, boolean on) {
        float v = anim.getOrDefault(id, on ? 1f : 0f);
        v += ((on ? 1 : 0) - v) * Math.min(1, dt * 14);
        anim.put(id, v);
        return v;
    }

    private static String fmt(JsonElement e) {
        return fmt(e == null || !e.isJsonPrimitive() ? 0 : e.getAsLong());
    }

    private static String fmt(long n) {
        if (n >= 1_000_000) return String.format(Locale.ROOT, "%.1fM", n / 1e6);
        if (n >= 1_000) return String.format(Locale.ROOT, "%.1fK", n / 1e3);
        return String.valueOf(n);
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
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

    // ───────── Olaylar ─────────

    @Override
    public void mouseClicked(double x, double y, int button) {
        ui.click((int) x, (int) y, button);
    }

    @Override
    public void mouseScrolled(double x, double y, double amount) {
        if (dialog != null) return;
        if (detailId != null) detailScrollTarget -= (float) amount * 28;
        else scrollTarget -= (float) amount * 28;
    }

    @Override
    public boolean keyPressed(int key) {
        if (key == 256 && (dialog != null || detailId != null)) {
            if (dialog != null) dialog = null;
            else detailId = null;
            return true;
        }
        if (setNameFocus) {
            if (key == 259 && !setName.isEmpty()) setName = setName.substring(0, setName.length() - 1);
            else if (key == 257) saveSet();
            else if (key == 256) setNameFocus = false;
            return true;
        }
        if (!searchFocus) return false;
        if (key == 259 && !search.isEmpty()) {
            search = search.substring(0, search.length() - 1);
            typed();
        } else if (key == 256 || key == 257) searchFocus = false;
        return true;
    }

    @Override
    public void charTyped(char c) {
        if (setNameFocus && c >= 32 && setName.length() < 32) {
            setName += c;
            return;
        }
        if (searchFocus && c >= 32 && search.length() < 48) {
            search += c;
            typed();
        }
    }

    private void typed() {
        typedAt = System.currentTimeMillis();
        if (tab == Tab.BROWSE) scrollTarget = 0;
    }

    @Override
    public void filesDropped(List<String> paths) {
        List<String> ok = new ArrayList<>();
        for (String p : paths) {
            String l = p.toLowerCase(Locale.ROOT);
            if (l.endsWith(".jar") || l.endsWith(".zip")) ok.add(p);
        }
        if (ok.isEmpty()) {
            api.say(Tr.t("Yalnızca .jar (mod) veya .zip (paket) eklenebilir"));
            return;
        }
        api.say(Tr.t("{0} dosya ekleniyor…", ok.size()));
        api.addFiles(ok, added -> WestHud.later(() -> {
            List<String> packs = new ArrayList<>();
            String shader = null;
            for (String a : added) {
                if (a.startsWith("resourcepacks/")) packs.add(a);
                else if (a.startsWith("shaderpacks/")) shader = a.substring("shaderpacks/".length());
            }
            if (!packs.isEmpty()) game.applyResourcePacks(packs, List.of(), null);
            if (shader != null && game.shadersSupported()) {
                String f = shader;
                dialog = new Dialog(Tr.t("Shader eklendi"), Tr.t("{0} şimdi uygulansın mı?", f), List.of(), Tr.t("Uygula"), false, () -> applyShader(f));
            }
            setTab(Tab.INSTALLED);
        }));
    }

    /** Tek oyunculuda Mod Merkezi açıkken oyun duraklar (yaratıklar saldırmaz) */
    @Override
    public boolean pausesGame() {
        return true;
    }

    @Override
    public WestScreen escape() {
        if (dialog != null) {
            dialog = null;
            return this;
        }
        if (detailId != null) {
            detailId = null;
            return this;
        }
        if (back == null) {
            game.closeModHub();
            return this;
        }
        return back;
    }
}
