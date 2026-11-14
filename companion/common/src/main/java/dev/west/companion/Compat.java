package dev.west.companion;

import java.util.ArrayList;
import java.util.List;

/**
 * Uyumluluk katmanı. Ana menüyü değiştiren/süsleyen modlar varsa West kendi
 * menüsünü AÇMAZ; yalnızca köşeye küçük bir "West" düğmesi ekler.
 */
public final class Compat {
    /** Ana menüyü kendisi çizen veya yeniden düzenleyen bilinen modlar. */
    private static final String[] MENU_MODS = {
            "essential", "essential-container", "fancymenu", "custommainmenu", "drippyloadingscreen",
            "simplemenu", "mainmenucredits", "isxander-main-menu-credits", "titlescreenmods", "custom_main_menu",
    };
    /** Mod kimliği farklı olsa bile sınıfından tanınan modlar. */
    private static final String[] MENU_CLASSES = {"gg.essential.Essential", "de.keksuccino.fancymenu.FancyMenu"};

    private static final List<String> found = new ArrayList<>();

    private Compat() {}

    static void detect(Platform p) {
        found.clear();
        for (String id : MENU_MODS) if (p.isModLoaded(id)) found.add(id);
        for (String cls : MENU_CLASSES) {
            try {
                Class.forName(cls, false, Compat.class.getClassLoader());
                if (!found.contains(cls)) found.add(cls);
            } catch (Throwable ignored) {
            }
        }
    }

    public static boolean conflict() {
        return !found.isEmpty();
    }

    public static List<String> conflicts() {
        return List.copyOf(found);
    }

    public static boolean replaceTitleScreen() {
        return "auto".equals(West.config.menuMode) && !conflict();
    }

    static String summary() {
        return found.isEmpty() ? "çakışma yok" : "uyumluluk modu (" + String.join(", ", found) + ")";
    }
}
