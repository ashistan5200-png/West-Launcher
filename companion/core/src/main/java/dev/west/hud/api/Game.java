package dev.west.hud.api;

import dev.west.hud.Tr;
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

    default String playerName() { return Tr.t("Oyuncu"); }

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

    default Session session() { return new Session(true, Tr.t("Dünya"), "", false); }

    /** Tek oyunculu dünyayı ağa aç; açılan port ya da -1. mode: 0-3 oyun modu */
    /** offline: Microsoft hesabı olmayan (offline) oyuncular da girebilsin */
    default int publishWorld(int mode, boolean cheats, boolean offline) { return -1; }

    /** Her ağda çalışan tünel (e4mc) kurulu mu */
    default boolean hasTunnel() { return false; }

    /** Tünelin verdiği herkese açık adres (ör. abc.na.e4mc.link); henüz yoksa null */
    default String tunnelAddress() { return null; }

    /** Tünel kurulamadı mı (ağ UDP'yi engelliyor vb.) */
    default boolean tunnelFailed() { return false; }

    /** Dünya açıksa portu, değilse -1 */
    default int publishedPort() { return -1; }




    /** Bir sunucu adresine doğrudan bağlan (davetle katılma) */
    default void connect(String name, String address) {}

    // ───────── Lobi ─────────

    /** Sunucu listesindeki bir sunucunun durumu. state: 0 sorgulanıyor, 1 çevrimiçi, 2 ulaşılamıyor, 3 uyumsuz sürüm */
    record ServerStatus(int state, int online, int max, long ping) {}

    /** Sunucuya ping atar (ilk istekte başlar, ~30 sn önbellek); bilinmiyorsa null */
    default ServerStatus serverStatus(String address) { return null; }

    /** Oyunun kendi sesini çal (ör. "entity.player.teleport") */
    default void playSound(String id, float volume, float pitch) {}

    /** Oyuncunun Minecraft UUID'si (çevrimdışı hesapta isimden türetilir) */
    default java.util.UUID playerUuid() { return null; }

    /** Microsoft ile doğrulanmış (çevrimiçi) bir hesap mı */
    default boolean onlineAccount() { return false; }

    /**
     * Mojang oturum sunucusuna "katılma" kaydı bırakır: lobi sunucusu bu kaydı hasJoined ile kontrol
     * ederek hesabın gerçekten bu oyuncuya ait olduğunu doğrular. Başarılıysa true.
     */
    default boolean mojangJoin(String serverId) { return false; }

    /** Paylaşılan dünyaya bağlı arkadaş (dünya sahibi hariç) */
    record SharedPlayer(String name, String uuid, boolean op) {}

    /** Paylaşılan dünyadaki diğer oyuncular */
    default List<SharedPlayer> sharedPlayers() { return List.of(); }

    /** Bir oyuncuya OP ver / al (yalnızca dünya sahibi) */
    default void setOp(String uuid, boolean op) {}

    /** Oyun içindeki yerleşik ses seviyesi (0–1, ana ses) */
    default float masterVolume() { return 1f; }

    /** Geçerli Minecraft ekran nesnesi (yansıma ile açılan mod ekranlarına "üst ekran" olarak verilir) */
    default Object screenObject() { return null; }

    /** Bir Minecraft Screen nesnesini aç */
    default void setScreenObject(Object screen) {}

    // ───────── Oyun içi mod merkezi ─────────

    /** Tek oyunculu dünyadaysa dünyanın klasör adı, değilse null */
    default String worldFolder() { return null; }

    /** Bir sunucudaysa adresi, değilse null */
    default String serverAddress() { return null; }

    /** Oyunu düzgünce kapat (dünya kaydedilir) */
    default void stopGame() {}

    /**
     * Kaynak paketlerini canlı uygula. Dosya kimlikleri "resourcepacks/x.zip" biçiminde.
     * then: yeniden yükleme bitince (dosyalar serbest kalınca) çağrılır.
     */
    default void applyResourcePacks(java.util.List<String> enable, java.util.List<String> disable, Runnable then) { if (then != null) then.run(); }

    /** Seçili kaynak paketleri ("resourcepacks/x.zip" biçiminde) */
    default java.util.Set<String> activeResourcePacks() { return java.util.Set.of(); }

    /** Iris yüklü mü (shader canlı değiştirilebilir mi) */
    default boolean shadersSupported() { return false; }

    /** Görüş mesafesi (parça); bilinmiyorsa 0 */
    default int renderDistance() { return 0; }

    /** Etkin shader paketinin dosya adı (kapalıysa null) */
    default String activeShader() { return null; }

    /** Shader'ı canlı değiştir (null: kapat); başarılıysa true */
    default boolean applyShader(String file) { return false; }

    /** Tek oyunculu dünyada veri paketini etkinleştir (dünyanın datapacks klasöründeki dosya) */
    default void enableDatapack(String file) {}

    /** Bu oturumda yüklü mod kimlikleri */
    default java.util.Set<String> loadedMods() { return java.util.Set.of(); }

    /** Mod merkezini aç */
    default void openModHub() {}

    /** Mod merkezini kapat: açılmadan önceki Minecraft ekranına (ör. duraklatma) ya da oyuna dön */
    default void closeModHub() { closeScreen(); }

    /** Oyun penceresini simge durumuna küçült (true) ya da geri getirip öne al (false). Pencere henüz yoksa false. */
    default boolean minimizeWindow(boolean minimize) { return false; }

    /** Panodaki metin (yoksa "") */
    default String clipboard() { return ""; }

    default void setClipboard(String text) {}

    /** Çalan menü/oyun müziğini durdur (arka planda bekleyen oturum ses çıkarmasın) */
    default void silenceMusic() {}

    /** Bir web sayfasını tarayıcıda aç */
    default void openUrl(String url) {}

    /** Bir mod yüklü mü (ör. "voicechat") */
    default boolean modLoaded(String id) { return false; }
}
