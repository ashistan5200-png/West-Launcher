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
import dev.west.hud.ui.Rota;
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
    private final Rota.Anim ra = new Rota.Anim();
    /** Bu karenin ipucu: { yazı, orta x, üst y } */
    private Object[] tipAt;
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

    /** Arayüz ölçeği büyükse ekran küçültülerek çizilir (en az 640×360 birim) */
    private float k = 1f;

    @Override
    public void render(Gfx real, int mx, int my, float delta) {
        if (!WestHud.game.inWorld()) real.panorama(delta);
        real.blurBehind();
        dev.west.hud.api.ScaledGfx sg = new dev.west.hud.api.ScaledGfx(real, 640, 360);
        k = sg.k;
        sg.begin();
        try {
            renderScaled(sg, sg.toLogical(mx), sg.toLogical(my), delta);
        } finally {
            sg.end();
        }
    }

    private void renderScaled(Gfx g, int mx, int my, float delta) {
        Theme t = WestHud.theme();
        ra.frame();
        tipAt = null;
        float time = (System.nanoTime() - opened) / 1e9f;
        long now = System.nanoTime();
        dt = Math.min(0.1f, (now - last) / 1e9f);
        last = now;
        ui.begin(g, t, mx, my, time);
        ui.animate = WestHud.config.data.animations;
        ui.suspended = dialog != null || detailId != null;
        int sw = g.width(), sh = g.height();
        float appear = ui.animate ? 1 - (float) Math.pow(1 - Math.min(1, time * 4f), 3) : 1;

        // Tam ekran: arkadaki oyun/manzara hafifçe görünür
        g.fill(0, 0, sw, sh, (int) (0xE6 * appear) << 24 | 0x0B0C0F);

        int pw = sw, ph = sh, px = 0, py = Math.round((1 - appear) * 8);

        if (!api.available()) {
            unavailable(px, py, pw, ph);
            ui.end();
            return;
        }

        int side = clamp(pw * 22 / 100, 150, 210);
        sidebar(px, py, side, ph);
        int cx = px + side + 22, cy = py + 18, cw = pw - side - 50;

        // Başlık: sayfa adı + özet, arama, yenile, kapat
        if (iconButton("close", Icon.CLOSE, px + pw - 26, py + 8, 18, Rota.DANGER)) {
            close();
            ui.end();
            return;
        }
        int rx = px + pw - 48;
        boolean spinning = api.refreshing || api.loading || api.searching;
        if (spinning) Rota.spinner(ui, rx + 9, py + 17, Rota.MUTED);
        else if (iconButton("refresh", Icon.REFRESH, rx, py + 8, 18, 0)) refresh();
        boolean searchable = tab == Tab.INSTALLED || tab == Tab.BROWSE;
        int sbw = searchable ? clamp(cw * 36 / 100, 90, 180) : 0;
        if (searchable) searchBox(rx - 6 - sbw, cy - 2, sbw, 18);
        int titleW = rx - 10 - sbw - cx;
        Rota.title(g, ui.fit(TAB_NAMES[tab.ordinal()], Math.round(titleW / 1.3f)), cx, cy);
        Rota.smallFit(ui, subtitle(), cx, cy + 14, titleW, Rota.MUTED);
        int top = cy + 30;
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
        Rota.scrollbar(g, cx + cw + 6, top, viewH, contentH, scroll);
        if (scroll > 1) Rota.rule(g, cx - 4, top - 1, cw + 8);
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
        if (tipAt != null && dialog == null && detailId == null) {
            g.nextLayer();
            String tip = (String) tipAt[0];
            int w = g.textWidth(tip) + 10, x = clamp((int) tipAt[1] - w / 2, 2, sw - w - 2), y = (int) tipAt[2];
            Ui.round(g, x, y, w, 14, 5, 0xF0000000);
            g.text(tip, x + 5, y + 3, Rota.TEXT, false);
        }
        ui.end();
    }

    /** Başlığın altındaki tek satırlık özet */
    private String subtitle() {
        return switch (tab) {
            case INSTALLED -> {
                int mods = 0, packs = 0, shaders = 0;
                for (JsonObject it : api.items) {
                    switch (ModBridge.str(it, "kind")) {
                        case "mod" -> mods++;
                        case "resourcepack" -> packs++;
                        case "shader" -> shaders++;
                        default -> {}
                    }
                }
                yield Tr.t("{0} mod · {1} paket · {2} shader", mods, packs, shaders);
            }
            case BROWSE -> Tr.t("Modrinth · {0} {1} ile uyumlu olanlar", game.loaderName(), game.minecraftVersion());
            case SETS -> Tr.t("Mod düzenlerini kaydet, aralarında geçiş yap, paylaş");
            case UPDATES -> {
                int n = updatable().size();
                yield n == 0 ? Tr.t("Her şey güncel") : Tr.t("{0} güncelleme var", n);
            }
            case PENDING -> api.pending.isEmpty() ? Tr.t("Oyun kapanmadan uygulanır") : Tr.t("{0} bekleyen değişiklik", api.pending.size());
        };
    }

    private void unavailable(int px, int py, int pw, int ph) {
        int w = Math.min(320, pw - 40), x = px + (pw - w) / 2;
        int h = Rota.empty(ui, Icon.BOX, Tr.t("Mod Merkezi kullanılamıyor"),
                Tr.t("Mod Merkezi, oyun West Client launcher'ından açıldığında çalışır.") + " " + Tr.t("Launcher'ı açık tutup oyunu oradan başlat."), x, py + ph / 2 - 60, w);
        String b = Tr.t("Geri");
        int bw = Rota.buttonWidth(ui.g, b, null);
        if (Rota.button(ui, ra, "uback", b, null, Rota.Kind.GHOST, px + (pw - bw) / 2, py + ph / 2 - 60 + h + 4, bw, 20, true)) close();
        if (iconButton("close", Icon.CLOSE, px + pw - 26, py + 8, 18, Rota.DANGER)) close();
    }

    private void sidebar(int x, int y, int w, int h) {
        Gfx g = ui.g;
        Rota.dock(g, x, 0, w, g.height());
        if (!g.texture("west_companion:textures/gui/west_mark.png", x + 12, y + 12, 18, 18, 0, 0, 256, 256, 256, 256, 0xFFFFFFFF))
            Icons.draw(g, Icon.BOX, x + 12, y + 12, 16, ui.t.accent | 0xFF000000);
        g.textBold(ui.fit(Tr.t("Mod Merkezi"), w - 44), x + 36, y + 13, Rota.TEXT, false);
        Rota.small(g, ui.fit(game.loaderName() + " " + game.minecraftVersion(), Math.round((w - 44) / 0.8f)), x + 36, y + 23, Rota.FAINT);

        int nx = x + 12, nw = w - 24, ny = y + 48;
        Rota.section(g, Tr.t("Bu oyun"), nx + 2, ny);
        ny = navItem(Tab.INSTALLED, nx, ny + 10, nw);
        ny = navItem(Tab.SETS, nx, ny, nw);
        ny = navItem(Tab.PENDING, nx, ny, nw) + 8;
        Rota.section(g, Tr.t("Yeni içerik"), nx + 2, ny);
        ny = navItem(Tab.BROWSE, nx, ny + 10, nw);
        navItem(Tab.UPDATES, nx, ny, nw);

        // Alt: dosya bırakma alanı
        int dh = 34, dy = y + h - 10 - dh;
        float a = hov("drop", dropHover || ui.hover(nx, dy, nw, dh));
        Ui.round(g, nx, dy, nw, dh, Rota.RADIUS, Theme.alpha(0xFFFFFFFF, (int) (0x06 + 0x08 * a)));
        Ui.outline(g, nx, dy, nw, dh, Rota.RADIUS, dropHover ? Theme.alpha(ui.t.accent, 0xC0) : Theme.mix(Rota.LINE, Rota.LINE_STRONG, a));
        Icons.draw(g, Icon.PLUS, nx + 8, dy + 7, 9, dropHover ? ui.t.accent | 0xFF000000 : Rota.MUTED);
        g.text(ui.fit(Tr.t("Dosya sürükle"), nw - 30), nx + 22, dy + 8, Rota.TEXT, false);
        Rota.smallFit(ui, ".jar · .zip", nx + 22, dy + 20, nw - 30, Rota.FAINT);
    }

    private int navItem(Tab p, int x, int y, int w) {
        int count = switch (p) {
            case UPDATES -> updatable().size();
            case PENDING -> api.pending.size();
            default -> 0;
        };
        float hv = hov("nav" + p, ui.hover(x, y, w, 18));
        if (Rota.nav(ui, TAB_ICONS[p.ordinal()], TAB_NAMES[p.ordinal()], x, y, w, tab == p, hv, count, p == Tab.PENDING)) setTab(p);
        return y + 20;
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
                if (Rota.button(ui, ra, "sort", sl, null, Rota.Kind.QUIET, x + w - sw, y, sw, 16, true)) {
                    game.click();
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
                String chk = api.refreshing ? Tr.t("Denetleniyor…") : Tr.t("Yeniden denetle");
                int cw = Rota.buttonWidth(g, chk, Icon.REFRESH);
                if (Rota.button(ui, ra, "chk", chk, Icon.REFRESH, Rota.Kind.GHOST, x, y, cw, 18, !api.refreshing)) {
                    game.click();
                    api.checkUpdates();
                }
                if (!up.isEmpty()) {
                    String all = Tr.t("Tümünü güncelle");
                    int aw = Rota.buttonWidth(g, all, null);
                    if (Rota.button(ui, ra, "upall", all, null, Rota.Kind.PRIMARY, x + cw + 6, y, aw, 18, true)) updateItems(up);
                }
                return y + 26;
            }
            default -> {
                return y + 2;
            }
        }
    }

    /** Yazı genişliğine göre boyutlanan sekmeler; seçileni döner */
    private int tabs(String[] labels, int sel, int x, int y, int maxW) {
        return Rota.tabs(ui, labels, sel, x, y, maxW);
    }

    private int chips(int x, int y, int w) {
        Gfx g = ui.g;
        String[][] cats = cats();
        if (cats.length == 0) return y;
        int cx = x;
        for (int i = 0; i < cats.length; i++) {
            String label = cats[i][1];
            int cw = Rota.chipWidth(g, label);
            if (cx + cw > x + w) break;
            if (Rota.chip(ui, label, cx, y, i == cat) && i != cat) {
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
            y += Rota.empty(ui, q.isEmpty() ? Icon.BOX : Icon.SEARCH, q.isEmpty() ? Tr.t("Burada henüz bir şey yok") : Tr.t("Eşleşen içerik yok"),
                    q.isEmpty() ? Tr.t("Keşfet'ten kurabilir ya da dosya sürükleyebilirsin.") : Tr.t("Modrinth'te aramak ister misin?"), x, y + 6, w);
            String b = Tr.t("Keşfet'te ara");
            int bw = Rota.buttonWidth(ui.g, b, Icon.SEARCH);
            if (!q.isEmpty() && Rota.button(ui, ra, "gobrowse", b, Icon.SEARCH, Rota.Kind.PRIMARY, x + (w - bw) / 2, y, bw, 20, true)) {
                String keep = search;
                setTab(Tab.BROWSE);
                search = keep;
                newSearch();
            }
            return y + 28;
        }
        y = handoffCard(x, y, w);
        if (filter == 3 && !game.shadersSupported()) {
            y = note(x, y, w, Icon.SUN, Tr.t("Shader'ları canlı açmak için Iris gerekli. Keşfet → Mod'dan Iris'i kurabilirsin."));
        }
        // Geniş ekranda iki sütun
        int cols = w >= 620 ? 2 : 1, gap = 6, rw = (w - gap * (cols - 1)) / cols;
        for (int k = 0; k < list.size(); k++) {
            int ry = installedRow(list.get(k), x + (k % cols) * (rw + gap), y, rw);
            if (k % cols == cols - 1 || k == list.size() - 1) y = ry + gap;
        }
        return y;
    }

    private int installedRow(JsonObject it, int x, int y, int w) {
        Gfx g = ui.g;
        Theme t = ui.t;
        String id = ModBridge.str(it, "id");
        String k = ModBridge.str(it, "kind");
        boolean managed = ModBridge.bool(it, "managed");
        int h = 40;
        boolean hv = ui.hover(x, y, w, h);
        float a = hov("row" + id, hv);
        Rota.card(g, x, y, w, h, a);
        icon(g, it, x + 8, y + 7, 26);

        // Durum
        String op = pendingKind(id);
        boolean on = state(it, op);
        int right = x + w - 8;
        // Eylemler: sil, güncelle, aç/kapa
        if (!managed) {
            if (smallIcon("del" + id, Icon.CLOSE, right - 16, y + 12, 16, Rota.DANGER, Tr.t("Sil"))) askDelete(it);
            right -= 20;
        }
        JsonElement up = it.get("update");
        boolean hasUpdate = up != null && up.isJsonObject() && !"update".equals(op);
        if (hasUpdate && !managed) {
            String lbl = Tr.t("Güncelle");
            int bw = g.textWidth(lbl) + 12;
            if (pill(lbl, right - bw, y + 12, bw, 16, true)) updateItems(List.of(it));
            right -= bw + 6;
        }
        if (!managed) {
            if (busy.contains(id)) spinner(g, right - 12, y + 20, 0xCCFFFFFF);
            else {
                boolean nv = Rota.toggle(ui, on, right - 24, y + 14);
                if (nv != on) toggle(it, nv);
            }
            right -= 30;
        } else {
            badge(g, Tr.t("West"), right - g.textWidth("West") - 10, y + 14, Theme.alpha(t.accent, 0x50), 0xFFFFFFFF);
            right -= g.textWidth("West") + 16;
        }

        int tx = x + 42, maxT = right - tx - 6;
        String title = ModBridge.str(it, "title");
        if (title.isEmpty()) title = ModBridge.str(it, "file");
        int tw = Math.min(g.textBoldWidth(title), maxT);
        g.text(ui.fit(title, maxT), tx, y + 9, on ? Rota.TEXT : Rota.FAINT, false);
        // Rozetler: tür + bekleyen işlem + yeni
        int bx = tx + tw + 6;
        String kindLabel = switch (k) {
            case "resourcepack" -> Tr.t("Paket");
            case "shader" -> Tr.t("Shader");
            default -> null;
        };
        if (kindLabel != null && filter == 0 && bx + 40 < right) bx = badge(g, kindLabel, bx, y + 8, 0x26FFFFFF, 0xFFD0D2D8) + 4;
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
            bx = badge(g, s, bx, y + 8, bad ? 0x40E5566E : 0x40E8A33D, bad ? 0xFFF08A9A : 0xFFF2C27A) + 4;
        } else if (k.equals("mod") && ModBridge.bool(it, "enabled") && !loadedNow(it) && bx + 60 < right) {
            bx = badge(g, Tr.t("yeniden başlatınca"), bx, y + 8, 0x40E8A33D, 0xFFF2C27A) + 4;
        } else if (hasUpdate && bx + 40 < right) {
            bx = badge(g, Tr.t("güncelleme"), bx, y + 8, 0x4049C27A, 0xFF8BE3B0) + 4;
        }
        String ver = ModBridge.str(it, "version");
        String author = ModBridge.str(it, "author");
        String sub = (ver.isEmpty() ? ModBridge.str(it, "file") : ver) + (author.isEmpty() ? "" : " · " + author);
        String dep = ModBridge.str(it, "dependencyOf");
        if (!dep.isEmpty()) sub += " · " + Tr.t("{0} için", dep);
        smallText(g, ui.fit(sub, (int) (maxT / 0.8f)), tx, y + 23, Rota.FAINT);
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
            if (api.refreshing) return loadingText(x, y, Tr.t("Modrinth'te yeni sürümler aranıyor…"));
            return y + Rota.empty(ui, Icon.CHECK, Tr.t("Her şey güncel"), Tr.t("Kurulu her şey en son sürümde."), x, y + 6, w);
        }
        for (JsonObject it : up) {
            int h = 34;
            String id = ModBridge.str(it, "id");
            Rota.card(g, x, y, w, h, 0);
            icon(g, it, x + 6, y + 6, 22);
            JsonObject u = it.getAsJsonObject("update");
            String lbl = Tr.t("Güncelle");
            int bw = g.textWidth(lbl) + 14;
            int maxT = w - 34 - bw - 20;
            g.text(ui.fit(ModBridge.str(it, "title"), maxT), x + 34, y + 7, Rota.TEXT, false);
            smallText(g, ui.fit(ModBridge.str(it, "version") + "  →  " + ModBridge.str(u, "versionNumber"), (int) (maxT / 0.8f)), x + 34, y + 20, 0xFF8BE3B0);
            if (busy.contains(id)) spinner(g, x + w - 20, y + 17, 0xCCFFFFFF);
            else if (pill(lbl, x + w - bw - 8, y + 10, bw, 14, true)) updateItems(List.of(it));
            y += h + 4;
        }
        return smallWrap(g, Tr.t("Mod güncellemeleri yeniden başlatınca, paket ve shader güncellemeleri hemen uygulanır."), x, y + 2, w, Rota.FAINT) + 4;
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
            y += Rota.empty(ui, Icon.CHECK, Tr.t("Bekleyen değişiklik yok"), Tr.t("Mod açma, kapama, silme ve kurma işlemleri burada toplanır; tek tıkla uygulanır."), x, y + 6, w);
            return points(x, y + 4, w);
        }
        String failed = api.failedReason();
        if (failed != null) {
            y = note(x, y, w, Icon.CLOSE, Tr.t("Yeni oyun bu değişikliklerle açılamadı, oyunun korundu: {0}.", failed) + " " + Tr.t("Sorunlu olanı geri al, sonra Tekrar dene. Bu değişiklikler sen karar verene dek uygulanmaz."));
        } else y = note(x, y, w, Icon.SHIELD, Tr.t("Uygula'ya basınca oyun kapanmaz: yeni mod düzeni arka planda yüklenir, hazır olunca aynı yere geçersin. Yeni düzen çökerse bu oyun açık kalır."));
        for (int i = 0; i < ops.size(); i++) {
            JsonObject op = ops.get(i);
            int h = 28;
            Rota.card(g, x, y, w, h, 0);
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
            int col = bad || k.equals("delete") ? Rota.DANGER : k.equals("disable") ? Rota.MUTED : t.accent | 0xFF000000;
            Ui.round(g, x + 6, y + 5, 18, 18, 5, Theme.alpha(col, 0x30));
            Icons.draw(g, ic, x + 10, y + 9, 10, col);
            String lbl = Tr.t("Geri al");
            int bw = g.textWidth(lbl) + 12;
            g.text(ui.fit(ModBridge.str(op, "label"), w - 40 - bw - 10), x + 30, y + 10, Rota.TEXT, false);
            if (pill(lbl, x + w - bw - 8, y + 7, bw, 14, false)) {
                game.click();
                api.undo(i);
            }
            y += h + 4;
        }
        y += 4;
        if (!api.handoffRunning() && failed != null) {
            if (Rota.button(ui, ra, "retry", Tr.t("Tekrar dene"), Icon.REFRESH, Rota.Kind.PRIMARY, x, y, 140, 20, true)) {
                game.click();
                api.retry(() -> WestHud.later(this::askRestart));
            }
        } else if (!api.handoffRunning() && Rota.button(ui, ra, "apply", Tr.t("Uygula"), Icon.CHECK, Rota.Kind.PRIMARY, x, y, 140, 20, true)) askRestart();
        if (failed == null) smallText(g, Tr.t("Ya da oyunu kapattığında otomatik uygulanır."), x, y + 26, Rota.FAINT);
        return points(x, y + 44, w);
    }

    /** Önceki düzenler: her uygulamadan önce kaydedilen geri dönüş noktaları */
    private int points(int x, int y, int w) {
        Gfx g = ui.g;
        List<JsonObject> pts = api.points;
        if (!api.pointsLoaded || pts.isEmpty()) return y;
        Rota.rule(g, x, y, w);
        y += 10;
        Rota.section(g, Tr.t("Önceki düzenler"), x + 2, y);
        y += 11;
        for (String l : wrap(g, Tr.t("Her uygulamadan önce kaydedilir. Geri dönünce sonradan eklenenler silinmez, kapatılır."), (int) (w / 0.8f))) {
            smallText(g, l, x, y, Rota.FAINT);
            y += 9;
        }
        y += 6;
        java.time.format.DateTimeFormatter fmt = java.time.format.DateTimeFormatter.ofPattern("dd.MM HH:mm");
        for (JsonObject p : pts) {
            int h = 28;
            Rota.card(g, x, y, w, h, 0);
            long at = p.has("at") ? p.get("at").getAsLong() : 0;
            String when = java.time.Instant.ofEpochSecond(at).atZone(java.time.ZoneId.systemDefault()).format(fmt);
            Icons.draw(g, Icon.CLOCK, x + 9, y + 9, 10, Rota.MUTED);
            String lbl = Tr.t("Bu düzene dön");
            int bw = g.textWidth(lbl) + 14;
            g.text(when, x + 26, y + 6, Rota.TEXT, false);
            int counts = p.has("mods") ? p.get("mods").getAsInt() : 0;
            smallText(g, ui.fit(Tr.t("{0} mod · sonra: {1}", counts, ModBridge.str(p, "label")), (int) ((w - 40 - bw) / 0.8f)), x + 26, y + 17, Rota.FAINT);
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
        boolean failed = api.failedReason() != null;
        int tone = failed ? Rota.DANGER : ui.t.accent | 0xFF000000;
        Rota.card(g, x, y, w, h, 0);
        g.fill(x, y + 6, x + 2, y + h - 6, tone);
        Icons.draw(g, failed ? Icon.CLOSE : Icon.CLOCK, x + 10, y + (h - 10) / 2, 10, tone);
        String lbl = api.handoffRunning() ? Tr.t("Yükleniyor… {0} sn", api.handoffSecs) : failed ? Tr.t("İncele") : Tr.t("Uygula");
        int bw = Rota.buttonWidth(g, lbl, null);
        String see = Tr.t("Gör");
        int sw = Rota.buttonWidth(g, see, null);
        String s = failed ? Tr.t("Bazı değişikliklerle oyun açılamadı") : Tr.t("{0} bekleyen değişiklik", api.pending.size());
        g.text(ui.fit(s, w - 34 - bw - sw - 16), x + 26, y + (h - 8) / 2, Rota.TEXT, false);
        int by = y + (h - 18) / 2;
        if (Rota.button(ui, ra, "pbsee", see, null, Rota.Kind.QUIET, x + w - bw - sw - 10, by, sw, 18, true)) {
            game.click();
            setTab(Tab.PENDING);
        }
        if (Rota.button(ui, ra, "pbgo", lbl, null, failed ? Rota.Kind.GHOST : Rota.Kind.PRIMARY, x + w - bw - 5, by, bw, 18, !api.handoffRunning())) {
            if (failed) setTab(Tab.PENDING);
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
        int tone = failed ? Rota.DANGER : t.accent | 0xFF000000;
        Ui.round(g, x, y, w, h, Rota.RADIUS, Theme.alpha(tone, 0x18));
        Ui.outline(g, x, y, w, h, Rota.RADIUS, Theme.alpha(tone, 0x50));
        if (failed) Icons.draw(g, Icon.CLOSE, x + 8, y + 7, 9, Rota.DANGER);
        else spinner(g, x + 12, y + 11, t.accent | 0xFF000000);
        int ly = y + 7;
        for (int i = 0; i < lines.size(); i++) {
            g.text(lines.get(i), x + 24, ly, i == 0 ? Rota.TEXT : 0xFFF5A3B1, false);
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
            y = smallWrap(g, Tr.t("Henüz set yok. Modlarını istediğin gibi aç-kapat, sonra aşağıdan kaydet."), x, y + 2, w, Rota.MUTED) + 6;
        }
        for (JsonObject m : sets) {
            String id = ModBridge.str(m, "id"), name = ModBridge.str(m, "name");
            boolean active = id.equals(api.activeSet);
            int h = 30;
            Rota.card(g, x, y, w, h, hov("set" + id, ui.hover(x, y, w, h)));
            if (active) Ui.outline(g, x, y, w, h, Rota.RADIUS, t.accent | 0xFF000000);
            letter(g, name, "mod", x + 6, y + 5, 20);
            int on = m.get("enabled") instanceof JsonArray a ? a.size() : 0, off = m.get("disabled") instanceof JsonArray b ? b.size() : 0;
            String lbl = active ? Tr.t("Etkin") : Tr.t("Geç");
            int bw = g.textWidth(lbl) + 16;
            g.text(ui.fit(name, w - 40 - bw - 16), x + 32, y + 6, Rota.TEXT, false);
            smallText(g, Tr.t("{0} açık · {1} kapalı", on, off), x + 32, y + 18, Rota.FAINT);
            if (active) {
                Icons.draw(g, Icon.CHECK, x + w - bw - 2, y + 11, 8, t.accent | 0xFF000000);
                g.text(lbl, x + w - bw + 9, y + 11, Rota.TEXT, false);
            }
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
        if (Rota.field(ui, setName, Tr.t("Yeni set adı (ör. PvP)"), null, setNameFocus, x, y, fw, 18)) {
            setNameFocus = true;
            searchFocus = false;
        } else if (!hv && ui.pressedAt(0, 0, 99999, 99999)) setNameFocus = false;
        if (Rota.button(ui, ra, "saveset", saveLbl, null, Rota.Kind.PRIMARY, x + fw + 6, y, sbw, 18, !setName.isBlank())) {
            game.click();
            saveSet();
        }
        y = smallWrap(g, Tr.t("Bekleyen değişiklikler kayda girmez; önce uygula."), x, y + 24, w, Rota.FAINT) + 8;
        String imp = api.importing ? Tr.t("Kuruluyor…") : Tr.t("Panodaki set kodunu ekle");
        int iw = g.textWidth(imp) + 16;
        if (api.importing) spinner(g, x + 8, y + 7, 0xCCFFFFFF);
        else if (pill(imp, x, y, iw, 14, false)) importFromClipboard();
        return smallWrap(g, Tr.t("Arkadaşının \"WEST-SET:…\" kodunu kopyala, sonra buna bas. Eksik modlar Modrinth'ten kurulur."), x, y + 18, w, Rota.FAINT) + 4;
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
            if (api.error != null) return y + Rota.note(ui, Icon.CLOSE, api.error, x, y, w, Rota.DANGER) + 6;
            return y + Rota.empty(ui, Icon.SEARCH, Tr.t("Sonuç yok"), Tr.t("Başka bir sözcük ya da kategori dene."), x, y + 6, w);
        }
        // Galeri görselli kart ızgarası: kart en az 170 birim genişlikte
        int gap = 8, cols = Math.max(1, (w + gap) / (136 + gap));
        int cw = (w - gap * (cols - 1)) / cols, ch = clamp(Math.round(cw * 0.36f), 40, 96) + 62;
        for (int i = 0; i < hits.size(); i++) {
            JsonObject h = hits.get(i);
            int ex = x + (i % cols) * (cw + gap), ey = y + (i / cols) * (ch + gap);
            hitCard(h, ex, ey, cw, ch);
        }
        int rows = (hits.size() + cols - 1) / cols;
        y += rows * (ch + gap);
        if (hits.size() < api.total) {
            if (api.searching) loadingText(x + w / 2 - 30, y + 2, Tr.t("Yükleniyor…"));
            else if (Rota.button(ui, ra, "more", Tr.t("Daha fazla göster"), null, Rota.Kind.GHOST, x + w / 2 - 60, y, 120, 18, true)) {
                api.search(search.trim(), k, SORTS[sort], cats().length > 0 ? cats()[cat][0] : "", hits.size());
            }
            y += 24;
        }
        return smallWrap(g, Tr.t("Yalnızca {0} {1} ile uyumlu içerik gösterilir. Kaynak: Modrinth", game.loaderName(), game.minecraftVersion()), x, y + 2, w, Rota.FAINT) + 4;
    }

    /** Keşfet kartı: üstte galeri görseli (yoksa simge renginden zemin), simge, ad, yazar, açıklama, Kur */
    private void hitCard(JsonObject h, int x, int y, int w, int hh) {
        Gfx g = ui.g;
        String id = ModBridge.str(h, "id");
        boolean hv = ui.hover(x, y, w, hh);
        float a = hov("hit" + id, hv);
        Rota.card(g, x, y, w, hh, a);
        int bh = hh - 62;
        // Galeri görseli
        String shot = "";
        if (h.get("gallery") instanceof JsonArray gal && !gal.isEmpty()) shot = gal.get(0).getAsString();
        byte[] img = shot.isEmpty() ? null : api.image(shot, 320, Math.round(320f * bh / w));
        g.scissor(x + 1, y + 1, x + w - 1, y + bh);
        if (img != null && g.png("gal_" + Integer.toHexString(shot.hashCode()), img, x + 1, y + 1, w - 2, bh)) {
            g.gradient(x + 1, y + bh - 24, x + w - 1, y + bh, 0x00000000, 0x90000000);
        } else {
            g.gradient(x + 1, y + 1, x + w - 1, y + bh, 0xFF1E2029, 0xFF15161B);
            Icons.draw(g, Icon.BOX, x + w / 2 - 10, y + bh / 2 - 10, 20, 0x22FFFFFF);
        }
        g.noScissor();
        if (a > 0.01f) Ui.outline(g, x, y, w, hh, Rota.RADIUS, Theme.alpha(0xFFFFFFFF, (int) (0x30 * a)));
        // Simge banner'ın altına taşar
        int is = 30, ix = x + 10, iy = y + bh - is / 2;
        Ui.round(g, ix - 2, iy - 2, is + 4, is + 4, Rota.RADIUS_SM + 1, 0xFF15161B);
        remoteIcon(g, ModBridge.str(h, "icon"), ix, iy, is);
        boolean installed = ModBridge.bool(h, "installed");
        boolean inst = api.installing.containsKey(id);
        String lbl = installed ? Tr.t("Kurulu") : Tr.t("Kur");
        // Kur düğmesi görselin sağ üst köşesinde; ad ve yazar simgenin yanında
        int bw = Math.max(40, g.textWidth(lbl) + 22), bx = x + w - bw - 6, by = y + 6;
        int tx = x + 10, ty = iy + is + 6, maxT = w - 20, nx = ix + is + 8;
        g.text(ui.fit(ModBridge.str(h, "title"), x + w - 8 - nx), nx, y + bh + 4, Rota.TEXT, false);
        smallText(g, ui.fit(Tr.t("{0} · {1} indirme", ModBridge.str(h, "author"), fmt(h.get("downloads"))), Math.round((x + w - 8 - nx) / 0.8f)), nx, y + bh + 15, Rota.FAINT);
        List<String> desc = wrap(g, ModBridge.str(h, "description"), Math.round(maxT / 0.8f));
        for (int k = 0; k < Math.min(2, desc.size()); k++)
            smallText(g, k == 1 && desc.size() > 2 ? ui.fit(desc.get(k) + "…", Math.round(maxT / 0.8f)) : desc.get(k), tx, ty + k * 9, Rota.MUTED);
        if (!inst && !installed) Ui.round(g, bx - 1, by - 1, bw + 2, 20, Rota.RADIUS_SM + 1, 0xC0101115);
        boolean clickedBtn = false;
        if (inst) spinner(g, bx + bw / 2, by + 9, 0xCCFFFFFF);
        else if (installed) badge(g, lbl, bx + bw - Rota.smallWidth(g, lbl) - 8, by + 4, 0xD0101115, 0xFF8BE3B0);
        else clickedBtn = Rota.button(ui, ra, "inst" + id, lbl, Icon.PLUS, hv ? Rota.Kind.PRIMARY : Rota.Kind.GHOST, bx, by, bw, 18, true);
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
        int sh = g.height();
        g.fill(0, 0, g.width(), sh, 0x88000000);
        // Sağdan açılan panel: tam yükseklik, üstte galeri görseli
        int w = clamp(Math.round(pw * 0.48f), Math.min(300, pw - 20), 460);
        int x = px + pw - w, y = 0, h = sh;
        g.fill(x, 0, x + w, sh, 0xFC101115);
        g.fill(x, 0, x + 1, sh, Rota.LINE_STRONG);
        if (ui.mx >= 0 && ui.mx < x && ui.clicked(0, 0, x, sh)) {
            detailId = null;
            return;
        }
        JsonObject d = api.detail;
        JsonObject hit = null;
        for (JsonObject hh : api.hits) if (detailId.equals(ModBridge.str(hh, "id"))) hit = hh;
        String shot = "";
        if (hit != null && hit.get("gallery") instanceof JsonArray gal && !gal.isEmpty()) shot = gal.get(0).getAsString();
        int bh = Math.round(w * 0.36f);
        byte[] img = shot.isEmpty() ? null : api.image(shot, 480, Math.round(480f * bh / w));
        if (img == null || !g.png("galD_" + Integer.toHexString(shot.hashCode()), img, x + 1, 0, w - 1, bh)) g.gradient(x + 1, 0, x + w, bh, 0xFF1E2029, 0xFF101115);
        g.gradient(x + 1, bh / 2, x + w, bh, 0x00101115, 0xFF101115);
        Ui.round(g, x + w - 28, 6, 22, 22, 11, 0xB0101115);
        if (iconButton("dclose", Icon.CLOSE, x + w - 26, 8, 18, Rota.DANGER)) {
            detailId = null;
            return;
        }
        y = bh - 30;
        h = sh - y;
        String title = d != null ? ModBridge.str(d, "title") : hit != null ? ModBridge.str(hit, "title") : "";
        String iconUrl = d != null ? ModBridge.str(d, "icon_url") : hit != null ? ModBridge.str(hit, "icon") : "";
        remoteIcon(g, iconUrl, x + 12, y + 12, 40);
        Rota.title(g, ui.fit(title, (int) ((w - 100) / 1.3f)), x + 60, y + 14);
        String owner = d != null ? ModBridge.str(d, "ownerName") : hit != null ? ModBridge.str(hit, "author") : "";
        long dl = d != null && d.has("downloads") ? d.get("downloads").getAsLong() : hit != null && hit.has("downloads") ? hit.get("downloads").getAsLong() : 0;
        smallText(g, ui.fit(Tr.t("{0} · {1} indirme", owner, fmt(dl)), (int) ((w - 80) / 0.8f)), x + 60, y + 30, Rota.MUTED);
        if (d == null) {
            if (api.detailLoading) loadingText(x + 12, y + 64, Tr.t("Yükleniyor…"));
            else g.text(api.error != null ? api.error : Tr.t("Ayrıntılar alınamadı."), x + 12, y + 64, Rota.MUTED, false);
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
        else if (Rota.button(ui, ra, "dinst", lbl, null, Rota.Kind.PRIMARY, x + 12, by, bw, 20, true)) install(pid, title);
        int ix = x + 12 + bw + 8;
        if (compatible) {
            JsonObject c = comp.getAsJsonObject();
            smallText(g, ui.fit(Tr.t("Sürüm {0} · {1} {2}", ModBridge.str(c, "number"), game.loaderName(), game.minecraftVersion()), (int) ((w - bw - 120) / 0.8f)), ix, by + 6, 0xFF8BE3B0);
        }
        String slug = ModBridge.str(d, "slug");
        String mr = Tr.t("Modrinth'te aç");
        int mw = Rota.buttonWidth(g, mr, null);
        if (Rota.button(ui, ra, "dmr", mr, null, Rota.Kind.GHOST, x + w - mw - 12, by, mw, 20, true)) {
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
            Ui.round(g, cx, cy, cw, 13, 6, 0x12FFFFFF);
            Ui.outline(g, cx, cy, cw, 13, 6, Rota.LINE);
            g.text(c, cx + 6, cy + 3, Rota.MUTED, false);
            cx += cw + 4;
        }
        if (ss.equals("required") && game.serverAddress() != null && KINDS[kind].equals("mod")) {
            cy += 17;
            smallText(g, ui.fit(Tr.t("Bu mod sunucuda da gerekli; yalnızca sende kurulu olursa bağlanamayabilirsin."), (int) ((w - 24) / 0.8f)), x + 12, cy, 0xFFF2C27A);
        }
        // Açıklama (kaydırılabilir)
        int ty = cy + 20, th = y + h - 10 - ty;
        Rota.rule(g, x + 12, ty - 4, w - 24);
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
        g.fill(0, 0, sw, sh, 0x99000000);
        int w = Math.min(320, sw - 40);
        List<String> body = wrap(g, d.body(), w - 28);
        int listN = Math.min(d.list().size(), 6);
        int h = 38 + body.size() * 11 + (listN > 0 ? listN * 12 + 8 : 0) + (d.list().size() > 6 ? 12 : 0) + 36;
        int x = (sw - w) / 2, y = (sh - h) / 2;
        Rota.window(g, x, y, w, h);
        Ui.round(g, x, y, w, h, Rota.RADIUS, 0x0AFFFFFF);
        g.textBold(ui.fit(d.title(), w - 28), x + 14, y + 14, Rota.TEXT, false);
        int ly = y + 30;
        for (String l : body) {
            g.text(l, x + 14, ly, Rota.MUTED, false);
            ly += 11;
        }
        if (listN > 0) {
            ly += 4;
            Ui.round(g, x + 14, ly - 3, w - 28, listN * 12 + 4 + (d.list().size() > 6 ? 12 : 0), Rota.RADIUS_SM, 0x10FFFFFF);
            for (int i = 0; i < listN; i++) {
                Ui.round(g, x + 21, ly + 3, 3, 3, 1, d.danger() ? Rota.DANGER : t.accent | 0xFF000000);
                g.text(ui.fit(d.list().get(i), w - 46), x + 29, ly, Rota.TEXT, false);
                ly += 12;
            }
            if (d.list().size() > 6) smallText(g, Tr.t("ve {0} tane daha", d.list().size() - 6), x + 29, ly + 1, Rota.FAINT);
        }
        // Düğmeler sağa yaslı: Vazgeç, sonra asıl eylem
        Rota.rule(g, x + 1, y + h - 31, w - 2);
        int byy = y + h - 25;
        int yw = Math.max(64, Rota.buttonWidth(g, d.yes(), null)), nw = Math.max(64, Rota.buttonWidth(g, Tr.t("Vazgeç"), null));
        if (Rota.button(ui, ra, "dyes", d.yes(), null, d.danger() ? Rota.Kind.DANGER : Rota.Kind.PRIMARY, x + w - 12 - yw, byy, yw, 20, true)) {
            confirm(d);
            return;
        }
        if (Rota.button(ui, ra, "dno", Tr.t("Vazgeç"), null, Rota.Kind.GHOST, x + w - 18 - yw - nw, byy, nw, 20, true)) {
            game.click();
            dialog = null;
        }
    }

    private void confirm(Dialog d) {
        game.click();
        dialog = null;
        d.onYes().run();
    }

    private void toast(Gfx g, int sw, int bottom) {
        if (api.toast == null) return;
        Rota.toast(g, api.toast, System.currentTimeMillis() - api.toastAt, sw, bottom, ui.t.accent);
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
            Ui.round(g, x, y, s, s, Rota.RADIUS_SM, 0x12FFFFFF);
            if (png.length > 0 && g.png("ic_" + id, png, x, y, s, s)) return;
        } else if (url.startsWith("https://")) {
            remoteIcon(g, url, x, y, s);
            return;
        }
        letter(g, ModBridge.str(it, "title"), ModBridge.str(it, "kind"), x, y, s);
    }

    private void remoteIcon(Gfx g, String url, int x, int y, int s) {
        Ui.round(g, x, y, s, s, Rota.RADIUS_SM, 0x12FFFFFF);
        byte[] png = url.isEmpty() ? null : api.icon(url);
        if (png != null && g.png("rc_" + Integer.toHexString(url.hashCode()), png, x, y, s, s)) return;
        Icons.draw(g, Icon.BOX, x + s / 4, y + s / 4, s / 2, 0x55FFFFFF);
    }

    private void letter(Gfx g, String title, String kind, int x, int y, int s) {
        Theme t = ui.t;
        int c = kind.equals("shader") ? 0xFF8FA6E8 : kind.equals("resourcepack") ? 0xFF7CC79A : Rota.MUTED;
        Ui.round(g, x, y, s, s, Rota.RADIUS_SM, 0x12FFFFFF);
        String ch = title.isEmpty() ? "?" : title.substring(0, 1).toUpperCase(Locale.ROOT);
        g.textBold(ch, x + (s - g.textBoldWidth(ch)) / 2, y + (s - 8) / 2, c, false);
    }

    private int badge(Gfx g, String s, int x, int y, int bg, int fg) {
        return Rota.badge(g, s, x, y, bg, fg);
    }

    /** Küçük düğme (satır içi): birincil amber, değilse hayalet */
    private boolean pill(String label, int x, int y, int w, int h, boolean primary) {
        if (Rota.button(ui, ra, "pill" + label + x + "_" + y, label, null, Rota.Kind.GHOST, x, y, w, h, true)) {
            game.click();
            return true;
        }
        return false;
    }

    private boolean smallIcon(String id, Icon icon, int x, int y, int s, int hoverColor, String tip) {
        boolean hit = Rota.iconButton(ui, ra, id, icon, x, y, s, hoverColor == Rota.DANGER ? Rota.DANGER : 0);
        if (ui.hover(x, y, s, s) && tip != null) tipAt = new Object[] { tip, x + s / 2, y + s + 3 };
        return hit;
    }

    private int note(int x, int y, int w, Icon icon, String text) {
        boolean bad = icon == Icon.CLOSE;
        return y + Rota.note(ui, icon, text, x, y, w, bad ? Rota.DANGER : ui.t.accent) + 6;
    }

    private int loadingText(int x, int y, String s) {
        Gfx g = ui.g;
        Rota.spinner(ui, x + 5, y + 8, Rota.MUTED);
        g.text(s, x + 14, y + 4, Rota.MUTED, false);
        return y + 20;
    }

    private void spinner(Gfx g, int cx, int cy, int color) {
        Rota.spinner(ui, cx, cy, color);
    }

    private void searchBox(int x, int y, int w, int h) {
        String hint = tab == Tab.BROWSE ? Tr.t("Modrinth'te ara") : Tr.t("Ara");
        if (Rota.field(ui, search, hint, Icon.SEARCH, searchFocus, x, y, w, h)) {
            searchFocus = true;
            setNameFocus = false;
        } else if (!ui.hover(x, y, w, h) && ui.pressedAt(0, 0, 99999, 99999)) searchFocus = false;
    }

    private boolean iconButton(String id, Icon icon, int x, int y, int s, int hoverColor) {
        if (Rota.iconButton(ui, ra, id, icon, x, y, s, hoverColor)) {
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
        return ra.get(id, on);
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

    /** Sarılmış 0.8x yazı; bittiği y'yi döner */
    private static int smallWrap(Gfx g, String s, int x, int y, int w, int color) {
        for (String l : wrap(g, s, Math.round(w / 0.8f))) {
            Rota.small(g, l, x, y, color);
            y += 9;
        }
        return y;
    }

    private static void smallText(Gfx g, String s, int x, int y, int color) {
        Rota.small(g, s, x, y, color);
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
        ui.click((int) Math.floor(x / k), (int) Math.floor(y / k), button);
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
