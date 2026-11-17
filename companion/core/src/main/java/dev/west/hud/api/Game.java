package dev.west.hud.api;

import java.nio.file.Path;
import java.util.List;

/** Oyundan canlı bilgi ve birkaç eylem. Her sürüm adaptörü bunu uygular. */
public interface Game {
    enum Key { FORWARD, BACK, LEFT, RIGHT, JUMP, SNEAK, ATTACK, USE }

    /** Bir dünyada mıyız (ana menüde değil) */
    boolean inWorld();

    /** F1 ile HUD gizli mi */
    boolean hudHidden();

    /** F3 hata ayıklama ekranı açık mı */
    boolean debugOpen();

    int fps();

    /** Sunucuya gecikme (ms); tek oyunculuda -1 */
    int ping();

    double x();

    double y();

    double z();

    /** Bakış yönü (derece, Minecraft biçiminde: 0 = güney) */
    float yaw();

    boolean keyDown(Key k);

    /** Bağlı sunucunun adresi; tek oyunculuda null */
    String server();

    /** Zırh yuvasının dayanıklılığı 0–1 (boşsa -1) */
    float durability(int slot);

    String minecraftVersion();

    String loaderName();

    Path configDir();

    List<ModInfo> mods();

    /** Arayüz tıklama sesi */
    void click();

    /** Ekranı kapat (West menüsünden oyuna dön) */
    void closeScreen();

    /** West menüsünü aç; editor=true ise doğrudan HUD düzenleyiciyle */
    void openWestScreen(boolean editor);

    /** Panoya kopyala */
    default void copy(String text) {}

    // ───────── Ana menü ─────────

    enum Target { SINGLEPLAYER, MULTIPLAYER, OPTIONS, LANGUAGE, QUIT, CREATE_WORLD, ADD_SERVER, ADVANCEMENTS, STATS, SHARE_LAN, DISCONNECT, WARDROBE }

    /** Minecraft'ın kendi ekranını aç; geri dönülünce West ana menüsüne gelinir. */
    default void open(Target t) {}

    /** Kayıtlı sunucular (çok oyunculu listesi), en fazla `max` tane */
    default List<ServerInfo> servers(int max) { return List.of(); }

    /** Listedeki sunucuya doğrudan bağlan */
    default void joinServer(int index) {}

    default String playerName() { return "Oyuncu"; }

    record ModInfo(String id, String name, String version, String description) {}

    record ServerInfo(String name, String address) {}

    /** Tek oyunculu dünya özeti. mode: 0 hayatta kalma, 1 yaratıcı, 2 macera, 3 izleyici */
    record WorldInfo(String id, String name, long lastPlayed, int mode, boolean hardcore, String iconPath) {}

    /** Son oynanana göre sıralı dünyalar (arka planda yüklenir; ilk çağrıda boş olabilir) */
    default List<WorldInfo> worlds(int max) { return List.of(); }

    default void joinWorld(String id) {}

    default boolean fullscreen() { return false; }

    default void toggleFullscreen() {}

    /** West ana menüsünü kapatıp Minecraft'ın kendi başlık ekranına geç */
    default void openVanillaTitle() {}

    /** West menüsünü belirli sayfasıyla aç (0 HUD, 1 Görünüm, 2 Genel, 3 Modlar) */
    default void openWestScreenPage(int page) { openWestScreen(false); }

    /** Oynanan oturum: tek oyunculu mu, dünya/sunucu adı, "Yaratıcı · Normal" gibi ayrıntı, LAN'a açılabilir mi */
    record Session(boolean singleplayer, String title, String detail, boolean canShare) {}

    default Session session() { return new Session(true, "Dünya", "", false); }

    /** Tek oyunculu dünyayı ağa aç; açılan port ya da -1. mode: 0-3 oyun modu */
    default int publishWorld(int mode, boolean cheats) { return -1; }

    /** Her ağda çalışan tünel (e4mc) kurulu mu */
    default boolean hasTunnel() { return false; }

    /** Tünelin verdiği herkese açık adres (ör. abc.na.e4mc.link); henüz yoksa null */
    default String tunnelAddress() { return null; }

    /** Tünel kurulamadı mı (ağ UDP'yi engelliyor vb.) */
    default boolean tunnelFailed() { return false; }

    /** Dünya açıksa portu, değilse -1 */
    default int publishedPort() { return -1; }

    /** Ana menünün arkasındaki canlı dünya hazır mı (true ise menü fotoğraf/sahne çizmez) */
    default boolean liveBackground() { return false; }

    /** Ana menü stili değişti: canlı dünyayı başlat / kapat */
    default void homeStyleChanged() {}

    /** Canlı dünya yükleniyor mu */
    default boolean liveLoading() { return false; }

    /** Bir sunucu adresine doğrudan bağlan (davetle katılma) */
    default void connect(String name, String address) {}
}
