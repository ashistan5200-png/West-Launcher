package dev.west.hud.lobby;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Consumer;

/**
 * Lobi sunucusuyla konuşan istemci. Değişiklikler launcher köprüsü üzerinden West hesabıyla
 * Supabase fonksiyonlarına gider (sunucu kuralları: arkadaşlık, 7 kişi sınırı, gizlilik, hız sınırı,
 * engelleme). Değişiklik bildirimleri Supabase Realtime (WebSocket) ile anında gelir; bağlantı
 * yoksa durum belirli aralıklarla yeniden okunur.
 */
public final class LobbyClient {
    public enum Status {
        /** Oyun West Client'tan açılmamış: köprü yok */
        NO_BRIDGE,
        /** Launcher'da West hesabına giriş yapılmamış */
        NO_ACCOUNT,
        /** Çevrimdışı (Microsoft'suz) Minecraft hesabı: doğrulanamaz */
        OFFLINE_ACCOUNT,
        /** Minecraft hesabı doğrulanıyor */
        VERIFYING,
        /** Doğrulama başarısız (ayrıntı error'da) */
        UNVERIFIED,
        CONNECTING,
        READY,
        ERROR
    }

    public record Person(String id, String name, UUID mcUuid, String mcName, boolean online, boolean singleplayer, String server, String serverName,
                         boolean joinable, boolean leader, boolean inMyLobby, boolean verified, String lobbyId, boolean lobbyJoinable, boolean lobbyRequested) {
        /** Kafa üstünde görünen ad: Minecraft adı (yoksa West adı) */
        public String display() {
            return mcName != null && !mcName.isBlank() ? mcName : name;
        }
    }

    public record Invite(String id, String fromId, String fromName, String lobbyId, String leaderName) {}

    /** Lidere gelen katılma isteği */
    public record JoinRequest(String id, String fromId, String fromName, String mcName) {
        public String display() {
            return mcName != null && !mcName.isBlank() ? mcName : fromName;
        }
    }

    /** Ekranın dinlediği olaylar (ışınlanma efekti, bildirimler) */
    public record Event(String kind, String personId, String text) {}

    public static final LobbyClient INSTANCE = new LobbyClient();
    private static final Gson GSON = new Gson();
    private static final String TOPIC = "realtime:west-lobby";

    private final String base = System.getProperty("west.bridge");
    private final String key = System.getProperty("west.bridgeKey");
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public volatile Status status = Status.CONNECTING;
    /** Son işlemin hatası (kullanıcıya kısa süre gösterilir) */
    public volatile String error;
    public volatile long errorAt;
    public volatile String myId;
    public volatile UUID myMcUuid;
    public volatile String lobbyId, leaderId, leaderName, privacy = "friends", biome;
    public volatile List<Person> members = List.of(), friends = List.of();
    public volatile List<Invite> invites = List.of();
    public volatile List<JoinRequest> requests = List.of();
    public volatile boolean showOnline = true, showServer = true, allowJoin = true;
    /** Lobi sunucusuna gecikme (Realtime nabız yanıtı, ms); ölçülemiyorsa -1 */
    public volatile long pingMs = -1;
    public volatile boolean realtime;
    public final ConcurrentLinkedQueue<Event> events = new ConcurrentLinkedQueue<>();

    private volatile boolean loading, verifyTried, busy;
    private long lastState, lastPresence, lastTokenRefresh, lastConnectTry, heartbeatAt;
    private String presenceKey = "";
    private volatile WebSocket socket;
    private final StringBuilder frame = new StringBuilder();
    private int ref = 1;
    private final Map<String, Long> pending = new HashMap<>();
    private volatile boolean refreshSoon;

    private LobbyClient() {
        if (base == null || key == null || !base.startsWith("http://127.0.0.1:")) status = Status.NO_BRIDGE;
    }

    public boolean available() {
        return status != Status.NO_BRIDGE;
    }

    public boolean ready() {
        return status == Status.READY;
    }

    public boolean amLeader() {
        return myId != null && myId.equals(leaderId);
    }

    // ───────── Yaşam döngüsü (her istemci tick'inde) ─────────

    public void tick(Game game) {
        if (status == Status.NO_BRIDGE) return;
        long now = System.currentTimeMillis();
        // Durum: Realtime açıkken yalnızca bildirim gelince (ve 2 dk'da bir güvence), kapalıyken 15 sn'de bir
        long every = realtime ? 120_000 : 15_000;
        if (!loading && (refreshSoon || now - lastState > every)) {
            refreshSoon = false;
            refresh(game);
        }
        // Oyun durumu: değişince hemen, değilse 30 sn'de bir (çevrimiçi sayılmak için)
        String server = game.inWorld() && !game.session().singleplayer() ? game.server() : null;
        String name = server == null ? null : game.session().title();
        boolean sp = game.inWorld() && game.session().singleplayer();
        String k = game.inWorld() + "|" + sp + "|" + server;
        if (myId != null && (!k.equals(presenceKey) || now - lastPresence > 30_000)) {
            presenceKey = k;
            lastPresence = now;
            JsonObject a = new JsonObject();
            a.addProperty("in_game", true);
            a.addProperty("singleplayer", sp);
            a.addProperty("server", server);
            a.addProperty("server_name", name);
            rpc("lobby_presence_set", a, v -> {}, e -> {});
        }
        // Gerçek zamanlı bağlantı
        if (myId != null && (status == Status.READY || status == Status.UNVERIFIED)) {
            if (socket == null && now - lastConnectTry > 15_000) {
                lastConnectTry = now;
                connectRealtime();
            } else if (socket != null) {
                if (now - heartbeatAt > 25_000) heartbeat();
                if (now - lastTokenRefresh > 5 * 60_000) refreshToken();
            }
        }
    }

    // ───────── Durum ─────────

    public void refreshNow() {
        refreshSoon = true;
    }

    private void refresh(Game game) {
        loading = true;
        lastState = System.currentTimeMillis();
        rpc("lobby_state", new JsonObject(), v -> {
            loading = false;
            apply(v.getAsJsonObject(), game);
        }, e -> {
            loading = false;
            if (e.contains("giriş yapılmamış") || e.contains("giriş yapmalısın")) status = Status.NO_ACCOUNT;
            else {
                status = Status.ERROR;
                fail(e);
            }
        });
    }

    private void apply(JsonObject o, Game game) {
        JsonObject me = o.getAsJsonObject("me");
        myId = str(me, "id");
        myMcUuid = uuid(str(me, "mc_uuid"));
        boolean verified = o.has("verified") && o.get("verified").getAsBoolean();
        // Doğrulanmamış ya da başka bir Minecraft hesabıyla oynanıyor: bu hesabı doğrula
        UUID playing = game.playerUuid();
        if (!verified || (playing != null && myMcUuid != null && !playing.equals(myMcUuid))) {
            if (!game.onlineAccount()) {
                status = verified ? Status.READY : Status.OFFLINE_ACCOUNT;
                if (!verified) return;
            } else if (!verifyTried) {
                verifyTried = true;
                verify(game);
                if (!verified) return;
            } else if (!verified) {
                if (status != Status.VERIFYING) status = Status.UNVERIFIED;
                return;
            }
        }
        JsonObject lob = o.getAsJsonObject("lobby");
        String oldLobby = lobbyId;
        List<Person> oldMembers = members;
        lobbyId = str(lob, "id");
        leaderId = str(lob, "leader_id");
        leaderName = str(lob, "leader_name");
        privacy = str(lob, "privacy");
        biome = str(lob, "biome");
        members = people(lob.getAsJsonArray("members"));
        friends = people(o.getAsJsonArray("friends"));
        List<Invite> inv = new ArrayList<>();
        for (JsonElement e : o.getAsJsonArray("invites")) {
            JsonObject i = e.getAsJsonObject();
            inv.add(new Invite(str(i, "id"), str(i, "from_id"), str(i, "from_name"), str(i, "lobby_id"), str(i, "leader_name")));
        }
        List<JoinRequest> req = new ArrayList<>();
        if (o.has("requests"))
            for (JsonElement e : o.getAsJsonArray("requests")) {
                JsonObject q = e.getAsJsonObject();
                req.add(new JoinRequest(str(q, "id"), str(q, "from_id"), str(q, "from_name"), str(q, "mc_name")));
            }
        List<JoinRequest> beforeReq = requests;
        requests = req;
        for (JoinRequest q : req) if (beforeReq.stream().noneMatch(b -> b.id().equals(q.id()))) events.add(new Event("request", q.fromId(), q.display()));
        List<Invite> before = invites;
        invites = inv;
        for (Invite i : inv) if (before.stream().noneMatch(b -> b.id().equals(i.id()))) events.add(new Event("invite", i.fromId(), i.fromName()));
        JsonObject st = o.getAsJsonObject("settings");
        showOnline = st.get("show_online").getAsBoolean();
        showServer = st.get("show_server").getAsBoolean();
        allowJoin = st.get("allow_join").getAsBoolean();
        // Işınlanma efekti: yeni gelenler ve başka lobiye geçiş
        if (oldLobby != null && !oldLobby.equals(lobbyId)) events.add(new Event("moved", myId, null));
        else if (oldLobby != null)
            for (Person p : members)
                if (oldMembers.stream().noneMatch(m -> m.id().equals(p.id()))) events.add(new Event("joined", p.id(), p.display()));
        status = Status.READY;
    }

    private static List<Person> people(JsonArray a) {
        List<Person> out = new ArrayList<>();
        if (a == null) return out;
        for (JsonElement e : a) {
            JsonObject p = e.getAsJsonObject();
            out.add(new Person(str(p, "id"), str(p, "name"), uuid(str(p, "mc_uuid")), str(p, "mc_name"), bool(p, "online"), bool(p, "singleplayer"),
                    str(p, "server"), str(p, "server_name"), bool(p, "joinable"), bool(p, "leader"), bool(p, "in_my_lobby"), !p.has("verified") || bool(p, "verified"),
                    str(p, "lobby_id"), bool(p, "lobby_joinable"), bool(p, "lobby_requested")));
        }
        return out;
    }

    // ───────── Minecraft hesabı doğrulaması ─────────

    /** Mojang oturum sunucusu üzerinden (sunuculara girerken yapılanın aynısı) hesabı West hesabına bağlar */
    public void verify(Game game) {
        if (!game.onlineAccount()) {
            status = Status.OFFLINE_ACCOUNT;
            return;
        }
        status = Status.VERIFYING;
        rpc("lobby_verify_start", new JsonObject(), v -> {
            String nonce = v.getAsString();
            CompletableFuture.runAsync(() -> {
                if (!game.mojangJoin(nonce)) {
                    status = Status.UNVERIFIED;
                    fail(Tr.t("Mojang oturumu doğrulanamadı; oyunu launcher'dan Microsoft hesabıyla yeniden başlat."));
                    return;
                }
                JsonObject b = new JsonObject();
                b.addProperty("name", game.playerName());
                post("/lobby/verify", b, ok -> {
                    status = Status.CONNECTING;
                    refreshNow();
                }, e -> {
                    status = Status.UNVERIFIED;
                    fail(e);
                });
            });
        }, e -> {
            status = Status.UNVERIFIED;
            fail(e);
        });
    }

    // ───────── Eylemler ─────────

    public void invite(String userId) {
        act("lobby_invite", "target", userId, Tr.t("Davet gönderildi"));
    }

    public void accept(String inviteId) {
        act("lobby_accept", "invite", inviteId, null);
    }

    public void decline(String inviteId) {
        invites = invites.stream().filter(i -> !i.id().equals(inviteId)).toList();
        act("lobby_decline", "invite", inviteId, null);
    }

    public void join(String lobby) {
        act("lobby_join", "lid", lobby, null);
    }

    /** Davetsiz katılamadığın bir lobinin liderine katılma isteği gönder */
    public void requestJoin(String lobby) {
        act("lobby_request_join", "lid", lobby, Tr.t("Katılma isteği gönderildi"));
    }

    /** Lider: katılma isteğini kabul et / reddet */
    public void answerRequest(String id, boolean accept) {
        requests = requests.stream().filter(q -> !q.id().equals(id)).toList();
        JsonObject a = new JsonObject();
        a.addProperty("req", id);
        a.addProperty("accept", accept);
        busy = true;
        rpc("lobby_request_answer", a, v -> {
            busy = false;
            refreshNow();
        }, e -> {
            busy = false;
            fail(e);
            refreshNow();
        });
    }

    public void leave() {
        act("lobby_leave", null, null, null);
    }

    public void kick(String userId) {
        act("lobby_kick", "target", userId, null);
    }

    public void block(String userId) {
        act("lobby_block", "target", userId, Tr.t("Engellendi"));
    }

    public void setPrivacy(String p) {
        privacy = p;
        act("lobby_set_privacy", "p", p, null);
    }

    public void setBiome(String b) {
        biome = b;
        act("lobby_set_biome", "b", b, null);
    }

    public void settings(boolean online, boolean server, boolean join) {
        showOnline = online;
        showServer = server;
        allowJoin = join;
        JsonObject a = new JsonObject();
        a.addProperty("show_online", online);
        a.addProperty("show_server", server);
        a.addProperty("allow_join", join);
        busy = true;
        rpc("lobby_settings_set", a, v -> {
            busy = false;
            refreshNow();
        }, e -> {
            busy = false;
            fail(e);
        });
    }

    /** Lobi verilerimin hepsini sunucudan siler (Minecraft bağlantısı dahil) */
    public void deleteMyData(Runnable done) {
        rpc("lobby_delete_my_data", new JsonObject(), v -> {
            members = List.of();
            friends = List.of();
            invites = List.of();
            lobbyId = null;
            myMcUuid = null;
            verifyTried = true;
            status = Status.UNVERIFIED;
            closeSocket();
            if (done != null) done.run();
        }, this::fail);
    }

    public boolean busy() {
        return busy;
    }

    private void act(String fn, String arg, String value, String okText) {
        JsonObject a = new JsonObject();
        if (arg != null) a.addProperty(arg, value);
        busy = true;
        rpc(fn, a, v -> {
            busy = false;
            if (okText != null) events.add(new Event("toast", null, okText));
            refreshNow();
        }, e -> {
            busy = false;
            fail(e);
            refreshNow();
        });
    }

    private void fail(String e) {
        error = e;
        errorAt = System.currentTimeMillis();
    }

    // ───────── Gerçek zamanlı (Supabase Realtime, WebSocket) ─────────

    private void connectRealtime() {
        get("/lobby/realtime", v -> {
            JsonObject o = v.getAsJsonObject();
            String url = str(o, "url"), token = str(o, "token"), user = str(o, "user");
            if (url == null || token == null) return;
            lastTokenRefresh = System.currentTimeMillis();
            http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(8)).buildAsync(URI.create(url), new Listener()).thenAccept(ws -> {
                socket = ws;
                JsonObject cfg = new JsonObject();
                JsonObject change = new JsonObject();
                change.addProperty("event", "INSERT");
                change.addProperty("schema", "public");
                change.addProperty("table", "lobby_events");
                change.addProperty("filter", "user_id=eq." + user);
                JsonArray changes = new JsonArray();
                changes.add(change);
                cfg.add("postgres_changes", changes);
                JsonObject bc = new JsonObject();
                bc.addProperty("self", false);
                cfg.add("broadcast", bc);
                JsonObject payload = new JsonObject();
                payload.add("config", cfg);
                payload.addProperty("access_token", token);
                send(TOPIC, "phx_join", payload, true);
                heartbeat();
            }).exceptionally(e -> {
                socket = null;
                realtime = false;
                pingMs = -1;
                return null;
            });
        }, e -> {});
    }

    private void refreshToken() {
        lastTokenRefresh = System.currentTimeMillis();
        get("/lobby/realtime", v -> {
            String token = str(v.getAsJsonObject(), "token");
            if (token == null) return;
            JsonObject p = new JsonObject();
            p.addProperty("access_token", token);
            send(TOPIC, "access_token", p, false);
        }, e -> {});
    }

    private void heartbeat() {
        heartbeatAt = System.currentTimeMillis();
        send("phoenix", "heartbeat", new JsonObject(), false);
    }

    private synchronized void send(String topic, String event, JsonObject payload, boolean join) {
        WebSocket ws = socket;
        if (ws == null) return;
        String r = String.valueOf(ref++);
        JsonObject m = new JsonObject();
        m.addProperty("topic", topic);
        m.addProperty("event", event);
        m.add("payload", payload);
        m.addProperty("ref", r);
        if (join) m.addProperty("join_ref", r);
        pending.put(r, System.currentTimeMillis());
        ws.sendText(GSON.toJson(m), true);
    }

    private void closeSocket() {
        WebSocket ws = socket;
        socket = null;
        realtime = false;
        pingMs = -1;
        if (ws != null) ws.abort();
    }

    private final class Listener implements WebSocket.Listener {
        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            frame.append(data);
            if (last) {
                String text = frame.toString();
                frame.setLength(0);
                onMessage(text);
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int code, String reason) {
            if (socket == ws) {
                socket = null;
                realtime = false;
                pingMs = -1;
            }
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            if (socket == ws) {
                socket = null;
                realtime = false;
                pingMs = -1;
            }
        }
    }

    private void onMessage(String text) {
        try {
            JsonObject m = JsonParser.parseString(text).getAsJsonObject();
            String event = str(m, "event");
            String r = str(m, "ref");
            if ("phx_reply".equals(event)) {
                Long sent;
                synchronized (this) {
                    sent = r == null ? null : pending.remove(r);
                }
                JsonObject p = m.getAsJsonObject("payload");
                String st = p == null ? null : str(p, "status");
                if ("phoenix".equals(str(m, "topic")) && sent != null) pingMs = System.currentTimeMillis() - sent;
                if (TOPIC.equals(str(m, "topic")) && "ok".equals(st)) {
                    realtime = true;
                    refreshNow();
                } else if (TOPIC.equals(str(m, "topic")) && "error".equals(st)) {
                    WestHud.LOG.warn("Lobi Realtime kanalına katılınamadı: {}", text);
                    realtime = false;
                }
            } else if ("postgres_changes".equals(event)) {
                refreshNow();
            } else if ("phx_error".equals(event) || "phx_close".equals(event)) {
                realtime = false;
            }
        } catch (Exception e) {
            WestHud.LOG.debug("Lobi Realtime iletisi okunamadı: {}", e.toString());
        }
    }

    // ───────── Köprü ─────────

    private void rpc(String fn, JsonObject args, Consumer<JsonElement> ok, Consumer<String> fail) {
        JsonObject b = new JsonObject();
        b.addProperty("fn", fn);
        b.add("args", args);
        post("/lobby/rpc", b, v -> ok.accept(v.getAsJsonObject().get("result")), fail);
    }

    private void get(String path, Consumer<JsonElement> ok, Consumer<String> fail) {
        call(HttpRequest.newBuilder(URI.create(base + path)).GET(), ok, fail);
    }

    private void post(String path, JsonObject body, Consumer<JsonElement> ok, Consumer<String> fail) {
        call(HttpRequest.newBuilder(URI.create(base + path)).POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body))).header("Content-Type", "application/json"), ok, fail);
    }

    private void call(HttpRequest.Builder b, Consumer<JsonElement> ok, Consumer<String> fail) {
        if (status == Status.NO_BRIDGE) return;
        http.sendAsync(b.header("X-West-Key", key).timeout(Duration.ofSeconds(25)).build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).whenComplete((r, ex) -> {
            try {
                if (ex != null) {
                    fail.accept(Tr.t("West Client'a ulaşılamadı (launcher kapalı olabilir)"));
                    return;
                }
                JsonElement v = r.body().isBlank() ? null : JsonParser.parseString(r.body());
                if (r.statusCode() != 200) {
                    String e = v != null && v.isJsonObject() && v.getAsJsonObject().has("error") ? v.getAsJsonObject().get("error").getAsString() : Tr.t("Bilinmeyen hata");
                    fail.accept(e);
                    return;
                }
                ok.accept(v);
            } catch (Exception e) {
                fail.accept(e.toString());
            }
        });
    }

    static String str(JsonObject o, String k) {
        if (o == null || !o.has(k) || o.get(k).isJsonNull()) return null;
        return o.get(k).getAsString();
    }

    static boolean bool(JsonObject o, String k) {
        return o != null && o.has(k) && !o.get(k).isJsonNull() && o.get(k).getAsBoolean();
    }

    static UUID uuid(String s) {
        try {
            return s == null ? null : UUID.fromString(s);
        } catch (Exception e) {
            return null;
        }
    }
}
