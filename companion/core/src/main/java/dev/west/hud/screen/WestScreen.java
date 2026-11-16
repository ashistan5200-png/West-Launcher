package dev.west.hud.screen;

import dev.west.hud.api.Gfx;

/**
 * Sürümden bağımsız ekran. Adaptörün Minecraft Screen alt sınıfı olayları buraya iletir.
 * Fare koordinatları GUI pikselidir.
 */
public interface WestScreen {
    void render(Gfx g, int mouseX, int mouseY, float delta);

    default void mouseClicked(double x, double y, int button) {}

    default void mouseReleased(double x, double y, int button) {}

    default void mouseDragged(double x, double y, int button) {}

    default void mouseScrolled(double x, double y, double amount) {}

    /** @return true ise tuş tüketildi. Esc için false dönülürse adaptör ekranı kapatır. */
    default boolean keyPressed(int glfwKey) { return false; }

    default void charTyped(char c) {}

    /** Ekran kapanırken (Esc ya da başka ekran) */
    default void removed() {}

    /** Esc'ye basıldığında: geri dönülecek ekran ya da null (oyuna dön) */
    default WestScreen escape() { return null; }

    /** Oyun bu ekran açıkken duraklasın mı (tek oyunculuda) */
    default boolean pausesGame() { return false; }

    /** Her kareden sonra sorulur: başka bir West ekranına geçilecekse o ekran, yoksa null */
    default WestScreen next() { return null; }
}
