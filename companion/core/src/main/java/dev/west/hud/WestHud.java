package dev.west.hud;

import dev.west.hud.api.Game;
import dev.west.hud.api.Gfx;
import dev.west.hud.hud.Hud;
import dev.west.hud.screen.EditorScreen;
import dev.west.hud.screen.MenuScreen;
import dev.west.hud.screen.WestScreen;
import dev.west.hud.ui.Theme;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * West Companion çekirdeği. Sürüm adaptörü başlangıçta {@link #init} çağırır, ardından
 * her istemci tick'inde {@link #tick}, her HUD karesinde {@link #renderHud}.
 * Buradaki hiçbir şey Minecraft sınıflarına dokunmaz.
 */
public final class WestHud {
    public static final String VERSION = "2.0.0";
    public static final Logger LOG = LoggerFactory.getLogger("WestCompanion");

    public static Game game;
    public static final Hud HUD = new Hud();
    public static Config config;
    public static Stats stats;
    private static int ticks;
    private static Theme theme;
    /** Düzenleyici açıkken oyun HUD'u ayrıca çizilmez */
    public static boolean editorOpen;

    private WestHud() {}

    public static void init(Game g) {
        game = g;
        config = new Config(g.configDir().resolve("west-companion.json"));
        config.load(HUD);
        stats = new Stats(g.configDir().resolve("west-stats.json"));
        LOG.info("West Companion {} hazır ({} {})", VERSION, g.loaderName(), g.minecraftVersion());
    }

    private static String themeKey;
    private static int themeAccent;

    public static Theme theme() {
        Config.Data d = config.data;
        String key = d.theme;
        if (theme == null || !key.equals(themeKey) || (themeAccent & 0xFFFFFF) != (d.accent & 0xFFFFFF)) {
            theme = Theme.of(d.theme, d.accent);
            themeKey = key;
            themeAccent = d.accent;
        }
        return theme;
    }

    public static void save() {
        config.save(HUD);
    }

    public static void tick() {
        // Launcher'ın yaptığı ayar değişikliklerini ~2 sn'de bir yakala
        if (++ticks % 40 == 0) safe("config", () -> config.reloadIfChanged(HUD));
        safe("stats", () -> stats.tick(game));
        if (ticks % 20 == 0) safe("presence", () -> dev.west.hud.social.SocialClient.INSTANCE.heartbeat(game.inWorld() ? "Oynuyor · " + game.session().title() : "Menüde"));
    }

    public static void renderHud(Gfx g) {
        if (config != null && !config.data.hudEnabled && !editorOpen) return;
        safe("hud", () -> HUD.render(g, game, theme(), editorOpen));
    }

    public static WestScreen menu() {
        return new MenuScreen();
    }

    /** West başlık ekranı (Minecraft'ın ana menüsünün yerine) */
    public static WestScreen home() {
        return new dev.west.hud.screen.TitleHome();
    }

    public static boolean customTitle() {
        return config != null && config.data.customTitle;
    }

    public static WestScreen editor(WestScreen back) {
        return new EditorScreen(back);
    }

    public static boolean fullbright() {
        return config != null && config.data.fullbright;
    }

    /** Bir HUD/menü hatası oyunu asla çökertmesin; hatayı bir kez günlüğe yaz. */
    private static final java.util.Set<String> reported = new java.util.HashSet<>();

    public static void safe(String where, Runnable r) {
        try {
            r.run();
        } catch (Throwable e) {
            if (reported.add(where)) LOG.error("West Companion ({}) hatası; bu özellik atlanıyor", where, e);
        }
    }
}
