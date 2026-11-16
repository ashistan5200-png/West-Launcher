package dev.west.hud;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.west.hud.hud.Hud;
import dev.west.hud.hud.HudElement;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * `config/west-companion.json`. Hem oyun içinden hem launcher'dan düzenlenir; launcher
 * yalnızca bildiği alanları değiştirir, gerisine dokunmaz. Dosya değişince canlı okunur.
 */
public final class Config {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static final class Element {
        public boolean enabled;
        public float x = -1, y = -1, scale = 1f;
        public boolean background = true, shadow = true;
        public int color = 0xFFFFFF;
        public Map<String, Boolean> flags = new LinkedHashMap<>();
    }

    public static final class Data {
        public int version = 2;
        public boolean fullbright = false;
        /** Launcher'daki "FPS göstergesi" anahtarı = FPS öğesi */
        public boolean fpsOverlay = true;
        public String theme = "night";
        public int accent = 0xE8A25C;
        public boolean animations = true;
        public boolean snapping = true;
        /** Menü ve HUD yazıları pürüzsüz (TrueType) yazı tipiyle; kapalıysa Minecraft yazı tipi */
        public boolean smoothFont = true;
        /** Minecraft'ın başlık ekranı yerine West ana menüsü */
        public boolean customTitle = true;
        /** Ana menüdeki "vanilla'yı mı tercih edersin?" kartı kapatıldı mı */
        public boolean titleTipSeen = false;
        /** Ana menü oyna kartında son seçilen sekme: 0 tek oyunculu, 1 çok oyunculu */
        public int homeTab = 0;
        public Map<String, Element> elements = new LinkedHashMap<>();
    }

    private final Path path;
    public Data data = new Data();
    private long stamp;

    public Config(Path path) {
        this.path = path;
    }

    public void load(Hud hud) {
        try {
            if (Files.exists(path)) {
                JsonObject o = JsonParser.parseString(Files.readString(path, StandardCharsets.UTF_8)).getAsJsonObject();
                Data d = GSON.fromJson(o, Data.class);
                if (d != null) {
                    // Eski (sürüm 1) dosyada fpsOverlay varsayılan kapalıydı; yoksa açık say
                    if (!o.has("fpsOverlay")) d.fpsOverlay = true;
                    if (d.elements == null) d.elements = new LinkedHashMap<>();
                    data = d;
                }
            }
        } catch (Exception e) {
            WestHud.LOG.warn("west-companion.json okunamadı, varsayılanlar kullanılıyor: {}", e.toString());
            data = new Data();
        }
        apply(hud);
        stamp = stampOf();
        if (!Files.exists(path)) save(hud);
    }

    private void apply(Hud hud) {
        for (HudElement e : hud.elements) {
            Element s = data.elements.get(e.id);
            if (s == null) continue;
            e.enabled = s.enabled;
            e.x = s.x;
            e.y = s.y;
            e.scale = Math.max(0.5f, Math.min(3f, s.scale));
            e.background = s.background;
            e.shadow = s.shadow;
            e.color = s.color & 0xFFFFFF;
        }
        HudElement fps = hud.byId("fps");
        if (fps != null) fps.enabled = data.fpsOverlay;
        Boolean b;
        if ((b = flag("keystrokes", "mouse")) != null) hud.keystrokes.showMouse = b;
        if ((b = flag("keystrokes", "space")) != null) hud.keystrokes.showSpace = b;
        if ((b = flag("armor", "hand")) != null) hud.armor.showHand = b;
    }

    private Boolean flag(String id, String key) {
        Element s = data.elements.get(id);
        return s == null ? null : s.flags.get(key);
    }

    public void save(Hud hud) {
        for (HudElement e : hud.elements) {
            Element s = data.elements.computeIfAbsent(e.id, k -> new Element());
            s.enabled = e.enabled;
            s.x = e.x;
            s.y = e.y;
            s.scale = e.scale;
            s.background = e.background;
            s.shadow = e.shadow;
            s.color = e.color;
        }
        HudElement fps = hud.byId("fps");
        if (fps != null) data.fpsOverlay = fps.enabled;
        data.elements.get("keystrokes").flags.put("mouse", hud.keystrokes.showMouse);
        data.elements.get("keystrokes").flags.put("space", hud.keystrokes.showSpace);
        data.elements.get("armor").flags.put("hand", hud.armor.showHand);
        try {
            Files.createDirectories(path.getParent());
            Path tmp = path.resolveSibling(path.getFileName() + ".tmp");
            Files.writeString(tmp, GSON.toJson(data), StandardCharsets.UTF_8);
            Files.move(tmp, path, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            stamp = stampOf();
        } catch (Exception e) {
            WestHud.LOG.warn("west-companion.json yazılamadı: {}", e.toString());
        }
    }

    private long stampOf() {
        try {
            return Files.getLastModifiedTime(path).toMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    /** Launcher dosyayı değiştirdiyse yeniden oku. */
    public boolean reloadIfChanged(Hud hud) {
        long s = stampOf();
        if (s == 0 || s == stamp) return false;
        load(hud);
        return true;
    }
}
