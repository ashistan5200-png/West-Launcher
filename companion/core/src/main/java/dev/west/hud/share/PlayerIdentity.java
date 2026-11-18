package dev.west.hud.share;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.WestHud;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Paylaşılan dünyada arkadaşın kimliği değişse de eşyaları, başarımları ve istatistikleri korunur.
 *
 * Minecraft oyuncu verisini UUID'ye göre saklar. Dünya bir kez "çevrimdışı" (UUID isimden türetilir),
 * bir kez normal (Microsoft UUID'si) paylaşılınca aynı arkadaş iki farklı kişi sayılır ve ikinci
 * girişte sıfırdan başlar. Burada her girişte "bu isim → şu UUID'ler" kaydı tutulur; yeni UUID'nin
 * verisi yoksa aynı isimle daha önce oynanmış UUID'nin verisi kopyalanır (eskisi silinmez).
 */
public final class PlayerIdentity {
    private static final Gson GSON = new Gson();
    private static final String INDEX = "west-players.json";

    private PlayerIdentity() {}

    public static UUID offlineUuid(String name) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Oyuncu yüklenmeden hemen önce çağrılır.
     *
     * @param worldDir  dünyanın kök klasörü (indeks burada tutulur)
     * @param dataDir   oyuncu verisi klasörü (.dat)
     * @param advDir    başarımlar klasörü (.json)
     * @param statsDir  istatistikler klasörü (.json)
     * @param userCache oyunun usercache.json dosyası (eski oturumlar için isim → UUID); yoksa null
     */
    public static synchronized void beforeLoad(Path worldDir, Path dataDir, Path advDir, Path statsDir, Path userCache, String name, UUID uuid) {
        if (name == null || uuid == null) return;
        Path indexFile = worldDir.resolve(INDEX);
        JsonObject index = readIndex(indexFile);
        String key = name.toLowerCase(Locale.ROOT);
        Set<String> known = new LinkedHashSet<>();
        if (index.has(key) && index.get(key).isJsonArray()) for (JsonElement e : index.getAsJsonArray(key)) known.add(e.getAsString());

        Path target = dataDir.resolve(uuid + ".dat");
        if (!Files.exists(target)) {
            // Aynı isimle oynanmış başka bir kimlik var mı: kayıttan, isimden türetilen çevrimdışı UUID'den, usercache'ten
            List<String> candidates = new ArrayList<>(known);
            candidates.add(offlineUuid(name).toString());
            candidates.addAll(fromUserCache(userCache, name));
            Path best = null;
            String bestId = null;
            for (String c : candidates) {
                if (c.equalsIgnoreCase(uuid.toString())) continue;
                Path p = dataDir.resolve(c + ".dat");
                try {
                    if (Files.isRegularFile(p) && (best == null || Files.getLastModifiedTime(p).compareTo(Files.getLastModifiedTime(best)) > 0)) {
                        best = p;
                        bestId = c;
                    }
                } catch (Exception ignored) {
                }
            }
            if (best != null) {
                copy(best, target);
                copy(advDir.resolve(bestId + ".json"), advDir.resolve(uuid + ".json"));
                copy(statsDir.resolve(bestId + ".json"), statsDir.resolve(uuid + ".json"));
                WestHud.LOG.info("Paylaşılan dünya: {} farklı bir kimlikle girdi; eşyalar ve başarımlar {} → {} taşındı", name, bestId, uuid);
            }
        }
        if (known.add(uuid.toString())) {
            JsonArray a = new JsonArray();
            for (String k : known) a.add(k);
            index.add(key, a);
            try {
                Files.writeString(indexFile, GSON.toJson(index), StandardCharsets.UTF_8);
            } catch (Exception e) {
                WestHud.LOG.warn("west-players.json yazılamadı: {}", e.toString());
            }
        }
    }

    // ───── Bu dünyada OP verilenler (isme göre; kimlik değişse de geçerli) ─────
    private static final String OPS = "west-ops.json";

    public static synchronized void setSavedOp(Path worldDir, String name, boolean op) {
        Path f = worldDir.resolve(OPS);
        JsonObject o = readIndex(f);
        String key = name.toLowerCase(Locale.ROOT);
        if (op) o.addProperty(key, true);
        else o.remove(key);
        try {
            Files.writeString(f, GSON.toJson(o), StandardCharsets.UTF_8);
        } catch (Exception e) {
            WestHud.LOG.warn("west-ops.json yazılamadı: {}", e.toString());
        }
    }

    private static Path opsCacheFile;
    private static long opsCacheStamp;
    private static JsonObject opsCache = new JsonObject();

    public static synchronized boolean isSavedOp(Path worldDir, String name) {
        Path f = worldDir.resolve(OPS);
        long stamp = 0;
        try {
            stamp = Files.isRegularFile(f) ? Files.getLastModifiedTime(f).toMillis() : 0;
        } catch (Exception ignored) {
        }
        if (!f.equals(opsCacheFile) || stamp != opsCacheStamp) {
            opsCacheFile = f;
            opsCacheStamp = stamp;
            opsCache = readIndex(f);
        }
        return opsCache.has(name.toLowerCase(Locale.ROOT));
    }

    private static void copy(Path from, Path to) {
        try {
            if (!Files.isRegularFile(from) || Files.exists(to)) return;
            Files.createDirectories(to.getParent());
            Files.copy(from, to, StandardCopyOption.COPY_ATTRIBUTES);
        } catch (Exception e) {
            WestHud.LOG.warn("Oyuncu verisi kopyalanamadı ({} → {}): {}", from.getFileName(), to.getFileName(), e.toString());
        }
    }

    private static JsonObject readIndex(Path f) {
        try {
            if (Files.isRegularFile(f)) return JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8)).getAsJsonObject();
        } catch (Exception ignored) {
        }
        return new JsonObject();
    }

    private static List<String> fromUserCache(Path userCache, String name) {
        List<String> out = new ArrayList<>();
        try {
            if (userCache == null || !Files.isRegularFile(userCache)) return out;
            for (JsonElement e : JsonParser.parseString(Files.readString(userCache, StandardCharsets.UTF_8)).getAsJsonArray()) {
                JsonObject o = e.getAsJsonObject();
                if (o.has("name") && o.has("uuid") && o.get("name").getAsString().equalsIgnoreCase(name)) out.add(o.get("uuid").getAsString());
            }
        } catch (Exception ignored) {
        }
        return out;
    }
}
