package dev.west.hud.social;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.WestHud;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;

/**
 * West sosyal ağına launcher'ın yerel köprüsü üzerinden erişim (-Dwest.bridge, -Dwest.bridgeKey).
 * Tüm istekler arka planda yapılır; sonuçlar alanlara yazılır ve ekran her karede bunları çizer.
 */
public final class SocialClient {
    public record Person(String id, String username, String name, boolean online, String status, String activity) {
        public String display() { return name == null || name.isBlank() ? username : name; }
    }

    public record Conversation(String id, String title, String last, String lastAt, boolean unread, boolean group, List<Person> members) {}

    public record Message(String sender, String body, String at) {}

    public record Invite(Person from, String world, String address, String at) {}

    public static final SocialClient INSTANCE = new SocialClient();
    private static final Gson GSON = new Gson();

    private final String base = System.getProperty("west.bridge");
    private final String key = System.getProperty("west.bridgeKey");
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(4)).build();

    public volatile List<Person> friends = List.of();
    public volatile List<Conversation> conversations = List.of();
    public volatile List<Person> requests = List.of();
    public volatile List<Invite> invites = List.of();
    public volatile List<Message> messages = List.of();
    public volatile String me = "";
    public volatile String error;
    public volatile boolean loaded;
    public volatile String status = "online";
    private long lastLists, lastMessages, lastPresence;
    private String openConversation;

    private SocialClient() {}

    /** Launcher köprüsü var mı (oyun West Client'tan, West hesabıyla başlatıldıysa) */
    public boolean available() {
        return base != null && key != null && base.startsWith("http://127.0.0.1:");
    }

    /** Ekran açıkken her karede çağrılır: listeleri ve açık sohbeti belirli aralıklarla tazeler. */
    public void poll(String conversation) {
        if (!available()) return;
        long now = System.currentTimeMillis();
        if (now - lastLists > 12_000) {
            lastLists = now;
            refreshLists();
        }
        if (conversation != null && (!conversation.equals(openConversation) || now - lastMessages > 3_000)) {
            if (!conversation.equals(openConversation)) messages = List.of();
            openConversation = conversation;
            lastMessages = now;
            get("/messages?c=" + enc(conversation), v -> {
                JsonObject o = v.getAsJsonObject();
                me = str(o, "me");
                List<Message> out = new ArrayList<>();
                for (JsonElement e : o.getAsJsonArray("messages")) {
                    JsonObject m = e.getAsJsonObject();
                    out.add(new Message(str(m, "sender_id"), str(m, "body"), str(m, "created_at")));
                }
                if (conversation.equals(openConversation)) messages = out;
            });
        }
    }

    /** Oyun içindeyken dakikada bir "çevrimiçi" durumu ve ne oynandığı */
    public void heartbeat(String activity) {
        if (!available()) return;
        long now = System.currentTimeMillis();
        if (now - lastPresence < 60_000) return;
        lastPresence = now;
        JsonObject b = new JsonObject();
        b.addProperty("status", status);
        if (activity != null) b.addProperty("activity", activity);
        post("/presence", b, v -> {});
    }

    public void setStatus(String s) {
        status = s;
        lastPresence = 0;
    }

    public void refreshLists() {
        get("/friends", v -> {
            List<Person> out = new ArrayList<>();
            for (JsonElement e : v.getAsJsonArray()) out.add(person(e.getAsJsonObject()));
            out.sort((a, b) -> Boolean.compare(b.online(), a.online()));
            friends = out;
            loaded = true;
        });
        get("/conversations", v -> {
            List<Conversation> out = new ArrayList<>();
            for (JsonElement e : v.getAsJsonArray()) {
                JsonObject c = e.getAsJsonObject();
                List<Person> mem = new ArrayList<>();
                for (JsonElement m : c.getAsJsonArray("members")) mem.add(person(m.getAsJsonObject()));
                String title = str(c, "title");
                if (title.isEmpty()) title = String.join(", ", mem.stream().map(Person::display).toList());
                String last = str(c, "last");
                if (last.startsWith("[west-davet]")) last = "Seni bir dünyaya davet etti";
                out.add(new Conversation(str(c, "id"), title.isEmpty() ? "Sohbet" : title, last, str(c, "lastAt"), c.has("unread") && c.get("unread").getAsBoolean(),
                        c.has("isGroup") && !c.get("isGroup").isJsonNull() && c.get("isGroup").getAsBoolean(), mem));
            }
            conversations = out;
        });
        get("/requests", v -> {
            JsonObject o = v.getAsJsonObject();
            List<Person> f = new ArrayList<>();
            for (JsonElement e : o.getAsJsonArray("follows")) f.add(person(e.getAsJsonObject()));
            List<Invite> inv = new ArrayList<>();
            for (JsonElement e : o.getAsJsonArray("invites")) {
                JsonObject i = e.getAsJsonObject();
                Person from = i.has("from") && i.get("from").isJsonObject() ? person(i.getAsJsonObject("from")) : new Person("", "?", "?", false, "", "");
                inv.add(new Invite(from, str(i, "world"), str(i, "address"), str(i, "at")));
            }
            requests = f;
            invites = inv;
        });
    }

    public void send(String conversation, String text) {
        JsonObject b = new JsonObject();
        b.addProperty("c", conversation);
        b.addProperty("body", text);
        post("/send", b, v -> lastMessages = 0);
    }

    public void openDm(String user, Consumer<String> then) {
        JsonObject b = new JsonObject();
        b.addProperty("user", user);
        post("/dm", b, v -> then.accept(str(v.getAsJsonObject(), "id")));
    }

    public void accept(String user, boolean yes) {
        JsonObject b = new JsonObject();
        b.addProperty("user", user);
        post(yes ? "/accept" : "/decline", b, v -> {
            lastLists = 0;
        });
    }

    public void add(String username, Consumer<String> result) {
        JsonObject b = new JsonObject();
        b.addProperty("username", username);
        post("/add", b, v -> {
            lastLists = 0;
            result.accept(null);
        }, result);
    }

    public void invite(List<String> users, String world, String address, Consumer<Integer> sent) {
        JsonObject b = new JsonObject();
        JsonArray a = new JsonArray();
        users.forEach(a::add);
        b.add("users", a);
        b.addProperty("world", world);
        b.addProperty("address", address);
        post("/invite", b, v -> sent.accept(v.getAsJsonObject().get("sent").getAsInt()));
    }

    // ───── HTTP ─────

    private void get(String path, Consumer<JsonElement> ok) {
        call(HttpRequest.newBuilder(URI.create(base + path)).GET(), ok, null);
    }

    private void post(String path, JsonObject body, Consumer<JsonElement> ok) {
        post(path, body, ok, null);
    }

    private void post(String path, JsonObject body, Consumer<JsonElement> ok, Consumer<String> fail) {
        call(HttpRequest.newBuilder(URI.create(base + path)).POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(body))).header("Content-Type", "application/json"), ok, fail);
    }

    private void call(HttpRequest.Builder b, Consumer<JsonElement> ok, Consumer<String> fail) {
        if (!available()) return;
        CompletableFuture<HttpResponse<String>> f = http.sendAsync(b.header("X-West-Key", key).timeout(Duration.ofSeconds(20)).build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        f.whenComplete((r, e) -> {
            try {
                if (e != null) {
                    error = "Launcher'a ulaşılamadı (West Client açık mı?)";
                    if (fail != null) fail.accept(error);
                    return;
                }
                JsonElement v = JsonParser.parseString(r.body());
                if (r.statusCode() != 200) {
                    String msg = v.isJsonObject() && v.getAsJsonObject().has("error") ? v.getAsJsonObject().get("error").getAsString() : "Hata " + r.statusCode();
                    if (fail != null) fail.accept(msg);
                    else error = msg;
                    return;
                }
                error = null;
                ok.accept(v);
            } catch (Exception ex) {
                if (fail != null) fail.accept("Beklenmeyen yanıt");
                WestHud.LOG.debug("sosyal yanıt okunamadı", ex);
            }
        });
    }

    private static Person person(JsonObject o) {
        return new Person(str(o, "id"), str(o, "username"), str(o, "display_name"), o.has("online") && o.get("online").getAsBoolean(), str(o, "status"), str(o, "activity"));
    }

    static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }
}
