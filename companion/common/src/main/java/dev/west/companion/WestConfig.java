package dev.west.companion;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * `config/west-companion.json` — hem oyun içi West panelinden hem de
 * launcher'ın instance ayarlarından düzenlenir; değişiklikler canlı okunur.
 */
public final class WestConfig {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public boolean fullbright = false;
    public boolean fpsOverlay = false;
    /** "auto" = West ana menüsü (çakışma yoksa) · "button" = yalnızca West düğmesi · "off" */
    public String menuMode = "auto";
    /** Ana menüdeki karakter pozu: "idle" | "hero" | "wave" */
    public String pose = "hero";

    private transient Path path;
    private transient long stamp;

    public static WestConfig load(Path path) {
        WestConfig c = null;
        try {
            if (Files.exists(path)) c = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), WestConfig.class);
        } catch (Exception e) {
            West.LOG.warn("west-companion.json okunamadı, varsayılanlar kullanılıyor", e);
        }
        if (c == null) c = new WestConfig();
        c.path = path;
        c.stamp = stampOf(path);
        if (!Files.exists(path)) c.save();
        return c;
    }

    private static long stampOf(Path p) {
        try {
            return Files.getLastModifiedTime(p).toMillis();
        } catch (Exception e) {
            return 0;
        }
    }

    public void save() {
        try {
            Files.createDirectories(path.getParent());
            Files.writeString(path, GSON.toJson(this), StandardCharsets.UTF_8);
            stamp = stampOf(path);
        } catch (Exception e) {
            West.LOG.warn("west-companion.json yazılamadı", e);
        }
    }

    /** Launcher dosyayı değiştirdiyse yeni değerleri al. */
    public void reloadIfChanged() {
        long s = stampOf(path);
        if (s == stamp || s == 0) return;
        WestConfig fresh = load(path);
        this.fullbright = fresh.fullbright;
        this.fpsOverlay = fresh.fpsOverlay;
        this.menuMode = fresh.menuMode;
        this.pose = fresh.pose;
        this.stamp = s;
    }

    public boolean showWestButton() {
        return !"off".equals(menuMode);
    }
}
