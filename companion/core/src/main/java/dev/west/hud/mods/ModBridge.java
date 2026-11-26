package dev.west.hud.mods;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Oyun içi mod merkezinin launcher ile konuştuğu istemci. Tüm istekler arka planda; sonuçlar alanlara yazılır,
 * ekran her karede bu alanları okur. Launcher köprüsü yoksa (oyun West Client dışından açıldıysa) {@link #available()} false.
 */
public final class ModBridge {
    public static final ModBridge INSTANCE = new ModBridge();
    private static final Gson GSON = new Gson();

    private final String base = System.getProperty("west.bridge");
    private final String key = System.getProperty("west.bridgeKey");
    private final String inst = System.getProperty("west.instance");
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();

    /** Kurulu içerik (mods, resourcepacks, shaderpacks) */
    public volatile List<JsonObject> items = List.of();
    public volatile List<JsonObject> pending = List.of();
    public volatile boolean loading, loaded, refreshing;
    public volatile String error;
    public volatile String toast;
    public volatile long toastAt;

    // Mağaza
    public volatile List<JsonObject> hits = List.of();
    public volatile long total;
    public volatile boolean searching;
    private volatile String lastSearchKey = "";
    public volatile JsonObject detail;
    public volatile boolean detailLoading;
    /** projectId → kurulum sürüyor */
    public final Map<String, Boolean> installing = new ConcurrentHashMap<>();

    /** Simgeler: url → PNG baytları (null: yükleniyor) */
    private final Map<String, byte[]> icons = new ConcurrentHashMap<>();
    private final Map<String, Boolean> iconBusy = new ConcurrentHashMap<>();

    private ModBridge() {}

    public boolean available() {
        return base != null && key != null && inst != null && base.startsWith("http://127.0.0.1:");
    }

    public void say(String msg) {
        toast = msg;
        toastAt = System.currentTimeMillis();
    }

    // ───── Kurulu içerik ─────

    public void reload() {
        reload(null);
    }

    /** Listeyi yeniden oku; then (varsa) liste güncellenince çağrılır */
    public void reload(Runnable then) {
        if (!available()) return;
        loading = true;
        get("/mods/list", v -> {
            JsonObject o = v.getAsJsonObject();
            items = list(o.getAsJsonArray("items"));
            pending = list(o.getAsJsonArray("pending"));
            loaded = true;
            loading = false;
            if (then != null) then.run();
        }, e -> loading = false);
    }

    private volatile long ensuredAt;

    /** Liste hiç okunmadıysa (en fazla 10 sn'de bir) okumayı dene */
    public void ensureLoaded() {
        if (loaded || loading || System.currentTimeMillis() - ensuredAt < 10_000) return;
        ensuredAt = System.currentTimeMillis();
        reload();
    }

    /** Arama önbelleğini unut (tür/sıralama değişince ya da yenile'de) */
    public void resetSearch() {
        lastSearchKey = "";
        hits = List.of();
        total = 0;
    }

    /** Modrinth'ten güncelleme bilgisini tazeler, sonra listeyi yeniden okur */
    public void checkUpdates() {
        if (refreshing) return;
        refreshing = true;
        post("/mods/refresh", new JsonObject(), v -> {
            refreshing = false;
            reload();
        }, e -> refreshing = false);
    }

    /** Açma/kapamanın birlikte etkileyeceği diğer modlar */
    public void plan(List<String> ids, boolean enabled, Consumer<List<JsonObject>> done) {
        JsonObject b = new JsonObject();
        b.add("ids", arr(ids));
        b.addProperty("enabled", enabled);
        post("/mods/plan", b, v -> done.accept(list(v.getAsJsonObject().getAsJsonArray("extra"))), e -> done.accept(List.of()));
    }

    public void toggle(List<String> ids, boolean enabled, Consumer<List<String>> live) {
        JsonObject b = new JsonObject();
        b.add("ids", arr(ids));
        b.addProperty("enabled", enabled);
        b.addProperty("withRelated", true);
        post("/mods/toggle", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            live.accept(strings(v.getAsJsonObject().getAsJsonArray("live")));
            reload();
        }, null);
    }

    public void delete(List<String> ids, Consumer<List<String>> live) {
        JsonObject b = new JsonObject();
        b.add("ids", arr(ids));
        post("/mods/delete", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            live.accept(strings(v.getAsJsonObject().getAsJsonArray("live")));
            reload();
        }, null);
    }

    public void update(List<String> ids, Consumer<List<String>> live) {
        JsonObject b = new JsonObject();
        b.add("ids", arr(ids));
        post("/mods/update", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            live.accept(strings(v.getAsJsonObject().getAsJsonArray("live")));
            reload();
        }, null);
    }

    public void undo(int index) {
        JsonObject b = new JsonObject();
        b.addProperty("index", index);
        post("/mods/undo", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            reload();
        }, null);
    }

    public void addFiles(List<String> paths, Consumer<List<String>> done) {
        JsonObject b = new JsonObject();
        b.add("paths", arr(paths));
        post("/mods/add", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            List<String> added = strings(v.getAsJsonObject().getAsJsonArray("added"));
            say(Tr.t("{0} dosya eklendi", added.size()));
            reload();
            if (done != null) done.accept(added);
        }, null);
    }

    // ───── Yeniden başlatma / devralma ─────

    /** Devralma durumu (eski oyunda): null | starting | ready | failed */
    public volatile String handoffState;
    public volatile String handoffError;
    public volatile long handoffSecs, handoffAt;
    private volatile boolean polling;
    private volatile long lastPoll;

    /**
     * Değişiklikleri uygula. Launcher yeni mod düzenini arka planda açabiliyorsa ("handoff") oyun açık kalır ve
     * yeni oyun hazır olunca kapanır; açamıyorsa ("restart") onRestart çağrılır (oyun hemen kapatılmalı).
     */
    public void restart(String join, Runnable onRestart) {
        JsonObject b = new JsonObject();
        if (join != null) b.addProperty("join", join);
        b.addProperty("handoff", true);
        post("/mods/restart", b, v -> {
            if ("handoff".equals(str(v.getAsJsonObject(), "mode"))) {
                handoffState = "starting";
                handoffError = null;
                handoffSecs = 0;
                handoffAt = System.currentTimeMillis();
                polling = true;
            } else onRestart.run();
        }, null);
    }

    public boolean handoffRunning() {
        return "starting".equals(handoffState) || "ready".equals(handoffState);
    }

    /** Açılamayan değişikliklerin işaretini kaldır (kapatılan jar'lar geri açılır) */
    public void retry(Runnable then) {
        post("/mods/retry", new JsonObject(), v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            reload();
            if (then != null) then.run();
        }, null);
    }

    /** Yeni oturumun açılamadığı değişikliklerin ilk sebebi (yoksa null) */
    public String failedReason() {
        for (JsonObject op : pending) {
            JsonElement f = op.get("failed");
            if (f != null && !f.isJsonNull()) return f.getAsString();
        }
        return null;
    }

    public void cancelHandoff() {
        post("/mods/handoff/cancel", new JsonObject(), v -> {}, null);
    }

    /** Eski oyun: her tick çağrılır; saniyede bir devralma durumunu sorar. Hazırsa oyunu kapatır. */
    public void pollRestart() {
        if (!polling || !available()) return;
        long now = System.currentTimeMillis();
        if (now - lastPoll < 1000) return;
        lastPoll = now;
        get("/mods/restart-status", v -> {
            JsonObject o = v.getAsJsonObject();
            String st = str(o, "state");
            if (o.has("secs")) handoffSecs = o.get("secs").getAsLong();
            if (!st.equals(handoffState)) handoffAt = System.currentTimeMillis();
            switch (st) {
                case "ready", "go" -> {
                    handoffState = "ready";
                    polling = false;
                    // Hazır: kısa bir uyarıdan sonra kaydedip kapan, yeni oyun buraya geçer
                    new Thread(() -> {
                        try {
                            Thread.sleep(900);
                        } catch (InterruptedException ignored) {
                        }
                        WestHud.later(WestHud.game::stopGame);
                    }, "west-handoff").start();
                }
                case "failed" -> {
                    handoffState = "failed";
                    handoffError = o.has("error") && !o.get("error").isJsonNull() ? o.get("error").getAsString() : null;
                    polling = false;
                    say(Tr.t("Yeni mod düzeni açılamadı; oyunun açık kaldı"));
                    reload();
                }
                case "none" -> {
                    handoffState = null;
                    polling = false;
                }
                default -> handoffState = st;
            }
        }, null);
    }

    /** Yeni oyun: ana menüye ulaştım */
    public void handoffReady() {
        post("/mods/handoff/ready", new JsonObject(), v -> {}, null);
    }

    /** Yeni oyun: eski oyun kapandı mı (state "go") ve nereye girilecek */
    public void handoffStatus(java.util.function.BiConsumer<String, String> done, Runnable fail) {
        get("/mods/handoff/status", v -> {
            JsonObject o = v.getAsJsonObject();
            done.accept(str(o, "state"), o.has("join") && !o.get("join").isJsonNull() ? o.get("join").getAsString() : null);
        }, e -> fail.run());
    }

    // ───── Mod setleri (launcher'daki "oyun modları") ─────

    public volatile List<JsonObject> sets = List.of();
    public volatile String activeSet;
    public volatile boolean setsLoaded;

    public void loadSets() {
        get("/mods/sets", v -> {
            JsonObject o = v.getAsJsonObject();
            sets = list(o.getAsJsonArray("modes"));
            activeSet = o.has("active") && !o.get("active").isJsonNull() ? o.get("active").getAsString() : null;
            setsLoaded = true;
        }, e -> setsLoaded = true);
    }

    /** Şu anki açık/kapalı düzeni yeni set olarak kaydet */
    public void saveSet(String name, Runnable done) {
        JsonObject b = new JsonObject();
        b.addProperty("name", name);
        b.addProperty("icon", "🎮");
        post("/mods/sets/save", b, v -> {
            say(Tr.t("\"{0}\" seti kaydedildi", name));
            loadSets();
            if (done != null) done.run();
        }, null);
    }

    /** Sete geç: paketler hemen, modlar bekleyen değişiklik olarak. done(liveOn, liveOff, modDeğişikliği) */
    public void switchSet(String id, SetSwitched done) {
        JsonObject b = new JsonObject();
        b.addProperty("modeId", id);
        post("/mods/sets/switch", b, v -> {
            JsonObject o = v.getAsJsonObject();
            pending = list(o.getAsJsonArray("pending"));
            activeSet = id;
            reload();
            done.accept(strings(o.getAsJsonArray("liveOn")), strings(o.getAsJsonArray("liveOff")), o.get("mods").getAsInt());
        }, null);
    }

    /** Setin paylaşım kodunu üret; done(kod, atlanan) */
    public void exportSet(String id, java.util.function.BiConsumer<String, Integer> done) {
        JsonObject b = new JsonObject();
        b.addProperty("modeId", id);
        post("/mods/sets/export", b, v -> done.accept(str(v.getAsJsonObject(), "code"), v.getAsJsonObject().get("skipped").getAsInt()), null);
    }

    public volatile boolean importing;

    /** Paylaşılan seti kur; done(sonuç) */
    public void importSet(String code, Consumer<JsonObject> done) {
        importing = true;
        JsonObject b = new JsonObject();
        b.addProperty("code", code);
        post("/mods/sets/import", b, v -> {
            importing = false;
            JsonObject o = v.getAsJsonObject();
            pending = list(o.getAsJsonArray("pending"));
            loadSets();
            reload();
            done.accept(o);
        }, e -> importing = false);
    }

    @FunctionalInterface
    public interface SetSwitched {
        void accept(List<String> liveOn, List<String> liveOff, int modChanges);
    }

    // ───── Geri dönüş noktaları ─────

    public volatile List<JsonObject> points = List.of();
    public volatile boolean pointsLoaded;

    public void loadPoints() {
        get("/mods/points", v -> {
            points = list(v.getAsJsonObject().getAsJsonArray("points"));
            pointsLoaded = true;
        }, e -> pointsLoaded = true);
    }

    /** Bu noktaya dönmeyi bekleyen değişiklik yap (Uygula ile oyun kapanmadan geçilir) */
    public void restorePoint(String id, Runnable then) {
        JsonObject b = new JsonObject();
        b.addProperty("id", id);
        post("/mods/points/restore", b, v -> {
            pending = list(v.getAsJsonObject().getAsJsonArray("pending"));
            if (then != null) then.run();
        }, null);
    }

    // ───── Mağaza ─────

    public void search(String q, String kind, String sort, String cat, int offset) {
        String k = q + "|" + kind + "|" + sort + "|" + cat + "|" + offset;
        if (k.equals(lastSearchKey)) return;
        lastSearchKey = k;
        searching = true;
        String path = "/mods/search?q=" + enc(q) + "&kind=" + enc(kind) + "&sort=" + enc(sort) + "&offset=" + offset + (cat == null || cat.isEmpty() ? "" : "&cat=" + enc(cat));
        get(path, v -> {
            if (!k.equals(lastSearchKey)) return;
            JsonObject o = v.getAsJsonObject();
            List<JsonObject> got = list(o.getAsJsonArray("hits"));
            if (offset > 0) {
                List<JsonObject> merged = new ArrayList<>(hits);
                merged.addAll(got);
                hits = merged;
            } else hits = got;
            total = o.has("total") ? o.get("total").getAsLong() : got.size();
            searching = false;
        }, e -> searching = false);
    }

    public void open(String projectId, String kind) {
        detail = null;
        detailLoading = true;
        get("/mods/project?id=" + enc(projectId) + "&kind=" + enc(kind), v -> {
            detail = v.getAsJsonObject();
            detailLoading = false;
        }, e -> detailLoading = false);
    }

    public void install(String projectId, String kind, String world, Consumer<JsonObject> done) {
        installing.put(projectId, true);
        JsonObject b = new JsonObject();
        b.addProperty("projectId", projectId);
        b.addProperty("kind", kind);
        if (world != null) b.addProperty("world", world);
        post("/mods/install", b, v -> {
            installing.remove(projectId);
            JsonObject o = v.getAsJsonObject();
            if (o.has("pending")) pending = list(o.getAsJsonArray("pending"));
            // Arama sonucunda "kurulu" işareti
            for (JsonObject h : hits) if (projectId.equals(str(h, "id"))) h.addProperty("installed", true);
            if (detail != null && projectId.equals(str(detail, "id"))) detail.addProperty("installed", true);
            reload();
            done.accept(o);
        }, e -> installing.remove(projectId));
    }

    /** Simge (64×64 PNG baytları) ya da henüz yoksa null; ilk istekte arka planda indirilir */
    public byte[] icon(String url) {
        return image(url, 64, 64);
    }

    /** Galeri görseli w×h'ye kırpılmış olarak (Keşfet kartı, ayrıntı başlığı) */
    public byte[] image(String url, int w, int h) {
        if (url == null || url.isEmpty() || !url.startsWith("https://")) return null;
        String key = w + "x" + h + "|" + url;
        byte[] b = icons.get(key);
        if (b != null) return b.length == 0 ? null : b;
        if (iconBusy.putIfAbsent(key, true) == null && iconBusy.size() < 64) {
            get("/mods/icon?url=" + enc(url) + "&w=" + w + "&h=" + h, v -> {
                icons.put(key, Base64.getDecoder().decode(v.getAsJsonObject().get("png").getAsString()));
                iconBusy.remove(key);
            }, e -> {
                icons.put(key, new byte[0]);
                iconBusy.remove(key);
            });
        }
        return null;
    }

    // ───── yardımcılar ─────

    public static String str(JsonObject o, String k) {
        JsonElement e = o == null ? null : o.get(k);
        return e == null || e.isJsonNull() ? "" : e.isJsonPrimitive() ? e.getAsString() : e.toString();
    }

    public static boolean bool(JsonObject o, String k) {
        JsonElement e = o == null ? null : o.get(k);
        return e != null && e.isJsonPrimitive() && e.getAsBoolean();
    }

    private static List<JsonObject> list(JsonArray a) {
        List<JsonObject> out = new ArrayList<>();
        if (a != null) for (JsonElement e : a) if (e.isJsonObject()) out.add(e.getAsJsonObject());
        return out;
    }

    private static List<String> strings(JsonArray a) {
        List<String> out = new ArrayList<>();
        if (a != null) for (JsonElement e : a) if (e.isJsonPrimitive()) out.add(e.getAsString());
        return out;
    }

    private static JsonArray arr(List<String> ids) {
        JsonArray a = new JsonArray();
        ids.forEach(a::add);
        return a;
    }

    private static String enc(String s) {
        return URLEncoder.encode(s == null ? "" : s, StandardCharsets.UTF_8);
    }

    private String withInst(String path) {
        return base + path + (path.contains("?") ? "&" : "?") + "inst=" + enc(inst);
    }

    private void get(String path, Consumer<JsonElement> ok, Consumer<String> fail) {
        call(HttpRequest.newBuilder(URI.create(withInst(path))).GET(), ok, fail);
    }

    private void post(String path, JsonObject body, Consumer<JsonElement> ok, Consumer<String> fail) {
        call(HttpRequest.newBuilder(URI.create(withInst(path))).POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body))).header("Content-Type", "application/json"), ok, fail);
    }

    private void call(HttpRequest.Builder b, Consumer<JsonElement> ok, Consumer<String> fail) {
        if (!available()) return;
        http.sendAsync(b.header("X-West-Key", key).timeout(Duration.ofSeconds(120)).build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).whenComplete((r, e) -> {
            try {
                if (e != null) {
                    error = Tr.t("Launcher'a ulaşılamadı (West Client açık mı?)");
                    say(error);
                    if (fail != null) fail.accept(error);
                    return;
                }
                JsonElement v = JsonParser.parseString(r.body());
                if (r.statusCode() != 200) {
                    String msg = v.isJsonObject() && v.getAsJsonObject().has("error") ? v.getAsJsonObject().get("error").getAsString() : ("HTTP " + r.statusCode());
                    error = msg;
                    say(msg);
                    if (fail != null) fail.accept(msg);
                    return;
                }
                error = null;
                ok.accept(v);
            } catch (Exception ex) {
                WestHud.LOG.warn("Mod merkezi isteği işlenemedi: {}", ex.toString());
                if (fail != null) fail.accept(ex.toString());
            }
        });
    }
}
