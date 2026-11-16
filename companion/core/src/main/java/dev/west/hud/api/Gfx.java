package dev.west.hud.api;

/**
 * Bir karelik çizim yüzeyi. Her Minecraft sürümü bunu kendi çizim sınıfıyla uygular
 * (GuiGraphics, GuiGraphicsExtractor …); çekirdek kod yalnızca bu arayüzü görür.
 * Koordinatlar Minecraft'ın GUI ölçeğindeki piksellerdir. Renkler ARGB.
 */
public interface Gfx {
    int width();

    int height();

    void fill(int x1, int y1, int x2, int y2, int argb);

    void gradient(int x1, int y1, int x2, int y2, int topArgb, int bottomArgb);

    void text(String s, int x, int y, int argb, boolean shadow);

    int textWidth(String s);

    /** Bir satırın yüksekliği (Minecraft yazı tipinde 9). */
    int lineHeight();

    void push();

    void pop();

    void translate(float x, float y);

    void scale(float s);

    /** Bu dikdörtgenin dışına çizimi kes (iç içe kullanılabilir). */
    void scissor(int x1, int y1, int x2, int y2);

    void noScissor();

    /** Arkasındaki oyunu bulanıklaştır (destekleyen sürümlerde; yoksa hiçbir şey yapmaz). */
    default void blurBehind() {}

    /** Zırh yuvası (0 = kask … 3 = bot) ya da eldeki eşya (4 = ana el, 5 = ikinci el). Boşsa false. */
    default boolean item(int slot, int x, int y) { return false; }

    /** Bir GUI pikselinin kaç ekran pikseli olduğu (GUI ölçeği). Pürüzsüz köşeler için. */
    default int guiScale() { return 1; }

    /** Yazılar pürüzsüz (TrueType) yazı tipiyle mi çizilsin; text/textWidth bunu kullanır. */
    default void smoothText(boolean on) {}

    /** Ana menü için Minecraft'ın dönen panorama arka planı (yoksa hiçbir şey yapmaz). */
    default void panorama(float delta) {}

    /** Oyuncunun skin yüzü (kafa + şapka katmanı) */
    default void playerFace(int x, int y, int size) {}

    /** Kalın pürüzsüz yazı (başlıklar için); desteklenmiyorsa normal yazı */
    default void textBold(String s, int x, int y, int argb, boolean shadow) { text(s, x, y, argb, shadow); }

    default int textBoldWidth(String s) { return textWidth(s); }

    /** Oyuncunun 3B modeli (fareyle sürükleyerek döndürülebilir) */
    default void playerModel(int x, int y, int w, int h) {}

    /**
     * Modun içindeki bir görseli (assets/west_companion/background/{id}.png) çizer.
     * (x,y,w,h) hedef GUI alanı; (sx,sy,sw,sh) görseldeki kaynak piksel alanı; color ARGB (saydamlık için).
     */
    default void image(String id, float x, float y, float w, float h, float sx, float sy, float sw, float sh, int color) {}

    /** Görselin piksel boyutu {genişlik, yükseklik}; yüklenemediyse null */
    default int[] imageSize(String id) { return null; }

    /** Oyuncunun tam boy 3B modeli; ayakları (cx, feetY) noktasında, boyu height. yaw derece. */
    default void playerStanding(int cx, int feetY, int height, float yaw) {}

    /** Oyuncunun kafa + gövdesinin üst yarısı; yaw derece cinsinden döndürme */
    default void playerBust(int x, int y, int w, int h, float yaw) {}

    /** Bir sonraki çizimler öncekilerin (3B model dahil) üstünde kalsın */
    default void nextLayer() {}

    /** Dünyanın küçük resmi; yoksa false */
    default boolean worldIcon(String id, String iconPath, int x, int y, int size) { return false; }
}
