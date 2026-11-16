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

    record ModInfo(String id, String name, String version, String description) {}
}
