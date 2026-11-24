package dev.west.hud;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.api.Game;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Oynama istatistikleri. Yalnızca bu bilgisayarda (config/west-stats.json) tutulur:
 * günlere, dünyalara ve sunuculara göre süre ve oturumlar. Yürüme, zıplama gibi toplamlar
 * Minecraft'ın her dünyada tuttuğu kendi istatistik dosyalarından toplanır.
 */
public final class Stats {
    public static final class Data {
        public Map<String, Long> days = new LinkedHashMap<>();
        public Map<String, Long> worlds = new LinkedHashMap<>();
        public Map<String, Long> servers = new LinkedHashMap<>();
        public long sessions;
        public long sessionSeconds;
        public long longestSession;
    }

    /** Bu oturumun süresi (sn) */
    public long current;

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path path;
    public Data data = new Data();
    private int ticks;
    private boolean wasInWorld;
    private String key;
    private boolean single;
    private long dirtySince;

    Stats(Path path) {
        this.path = path;
        try {
            if (Files.exists(path)) {
                Data d = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), Data.class);
                if (d != null) data = d;
            }
        } catch (Exception e) {
            WestHud.LOG.warn("west-stats.json okunamadı: {}", e.toString());
        }
        if (data.days == null) data.days = new LinkedHashMap<>();
        if (data.worlds == null) data.worlds = new LinkedHashMap<>();
        if (data.servers == null) data.servers = new LinkedHashMap<>();
    }

    void tick(Game game) {
        boolean in = game.inWorld();
        if (in && !wasInWorld) {
            Game.Session s = game.session();
            single = s.singleplayer();
            key = single ? s.title() : (s.detail().isEmpty() ? s.title() : s.detail());
            data.sessions++;
            current = 0;
            dirtySince = System.currentTimeMillis();
        }
        if (!in && wasInWorld) save();
        wasInWorld = in;
        if (!in || key == null) return;
        if (++ticks % 20 != 0) return;
        String today = LocalDate.now().toString();
        data.days.merge(today, 1L, Long::sum);
        (single ? data.worlds : data.servers).merge(key, 1L, Long::sum);
        data.sessionSeconds++;
        current++;
        if (current > data.longestSession) data.longestSession = current;
        if (System.currentTimeMillis() - dirtySince > 30_000) save();
    }

    private static final java.util.concurrent.ExecutorService WRITER = java.util.concurrent.Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "West stats writer");
        t.setDaemon(true);
        t.setPriority(Thread.MIN_PRIORITY);
        return t;
    });

    public void save() {
        dirtySince = System.currentTimeMillis();
        // Son 400 gün yeter
        while (data.days.size() > 400) data.days.remove(data.days.keySet().iterator().next());
        // JSON ana iş parçacığında üretilir (veri tutarlı kalsın), diske yazma arka planda: oyun takılmaz
        String json = GSON.toJson(data);
        WRITER.execute(() -> {
            try {
                Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
                Files.writeString(tmp, json, StandardCharsets.UTF_8);
                Files.move(tmp, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception e) {
                WestHud.LOG.warn("west-stats.json yazılamadı: {}", e.toString());
            }
        });
    }

    public long total() {
        long t = 0;
        for (long v : data.days.values()) t += v;
        return t;
    }

    /** Son n gün (en eskiden bugüne) saniye */
    public long[] days(int n) {
        long[] out = new long[n];
        LocalDate d = LocalDate.now();
        for (int i = 0; i < n; i++) out[n - 1 - i] = data.days.getOrDefault(d.minusDays(i).toString(), 0L);
        return out;
    }

    /** Art arda oynanan gün sayısı (bugün ya da dünden geriye) */
    public int streak() {
        LocalDate d = LocalDate.now();
        if (data.days.getOrDefault(d.toString(), 0L) == 0) d = d.minusDays(1);
        int n = 0;
        while (data.days.getOrDefault(d.toString(), 0L) > 0) {
            n++;
            d = d.minusDays(1);
        }
        return n;
    }

    /** Son 7 gün (en eskiden bugüne) saniye */
    public long[] week() {
        long[] out = new long[7];
        LocalDate d = LocalDate.now();
        for (int i = 0; i < 7; i++) out[6 - i] = data.days.getOrDefault(d.minusDays(i).toString(), 0L);
        return out;
    }

    // ───── Minecraft'ın kendi istatistikleri (tüm dünyalar) ─────

    private Map<String, Long> vanilla = new HashMap<>();
    private long vanillaAt;

    /** walk_one_cm, sprint_one_cm, jump, deaths, mob_kills, play_time … tüm dünyaların toplamı */
    public Map<String, Long> vanilla(Path gameDir) {
        if (System.currentTimeMillis() - vanillaAt < 15_000) return vanilla;
        vanillaAt = System.currentTimeMillis();
        Map<String, Long> sum = new HashMap<>();
        Path saves = gameDir.resolve("saves");
        try (Stream<Path> worlds = Files.list(saves)) {
            for (Path w : (Iterable<Path>) worlds::iterator) {
                Path dir = w.resolve("stats");
                if (!Files.isDirectory(dir)) continue;
                try (Stream<Path> files = Files.list(dir)) {
                    for (Path f : (Iterable<Path>) files::iterator) {
                        if (!f.toString().endsWith(".json")) continue;
                        JsonObject o = JsonParser.parseString(Files.readString(f, StandardCharsets.UTF_8)).getAsJsonObject();
                        JsonObject stats = o.getAsJsonObject("stats");
                        if (stats == null) continue;
                        JsonObject custom = stats.getAsJsonObject("minecraft:custom");
                        if (custom == null) continue;
                        for (Map.Entry<String, JsonElement> e : custom.entrySet()) {
                            String k = e.getKey().replace("minecraft:", "");
                            sum.merge(k, e.getValue().getAsLong(), Long::sum);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // saves klasörü yoksa ya da bir dosya bozuksa: elde olanla devam
        }
        vanilla = sum;
        return sum;
    }
}
