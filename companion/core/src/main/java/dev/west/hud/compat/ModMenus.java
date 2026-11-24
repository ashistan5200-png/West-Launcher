package dev.west.hud.compat;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;
import dev.west.hud.ui.Icons.Icon;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * Essential ve Flashback, kendi düğmelerini Minecraft'ın başlık ekranına ekler; West başlık ekranı onun yerini
 * aldığı için bu düğmeler burada yeniden sunulur. Modların açık bir API'si olmadığından ekranlar yansıma
 * (reflection) ile açılır; bir sınıf bulunamazsa o eylem listelenmez, oyun asla çökmez.
 */
public final class ModMenus {
    private ModMenus() {}

    /** Bir mod eylemi: ad, simge ve çalıştırma (geçerli ekran nesnesini alır) */
    public record Action(String label, Icon icon, Consumer<Object> run) {}

    public record Mod(String id, String name, int color, List<Action> actions) {}

    private static List<Mod> cache;

    /** Yüklü ve desteklenen modlar (Essential, Flashback) */
    public static List<Mod> mods() {
        if (cache != null) return cache;
        List<Mod> out = new ArrayList<>();
        if (has("gg.essential.util.GuiUtil")) {
            List<Action> a = new ArrayList<>();
            add(a, "gg.essential.gui.wardrobe.Wardrobe", Tr.t("Gardırop"), Icon.GEM, () -> make("gg.essential.gui.wardrobe.Wardrobe"));
            add(a, "gg.essential.gui.friends.SocialMenu", Tr.t("Arkadaşlar ve mesajlar"), Icon.USERS, () -> make("gg.essential.gui.friends.SocialMenu"));
            add(a, "gg.essential.gui.screenshot.components.ScreenshotBrowser", Tr.t("Ekran görüntüleri"), Icon.FOLDER, () -> make("gg.essential.gui.screenshot.components.ScreenshotBrowser"));
            if (has("gg.essential.gui.sps.InviteOrHostModalFlowKt"))
                a.add(new Action(Tr.t("Dünya barındır / davet et"), Icon.SHARE, s -> call("gg.essential.gui.sps.InviteOrHostModalFlowKt", "launchInviteOrHostModalFlow")));
            if (has("gg.essential.config.McEssentialConfig"))
                a.add(new Action(Tr.t("Essential ayarları"), Icon.GEAR, s -> open(settings())));
            if (!a.isEmpty()) out.add(new Mod("essential", "Essential", 0x4A9BFF, a));
        }
        if (has("com.moulberry.flashback.screen.select_replay.SelectReplayScreen")) {
            List<Action> a = new ArrayList<>();
            a.add(new Action(Tr.t("Kayıtlar"), Icon.PLAY, parent -> {
                try {
                    Class<?> screen = Class.forName("net.minecraft.client.gui.screens.Screen");
                    Object r = Class.forName("com.moulberry.flashback.screen.select_replay.SelectReplayScreen").getConstructor(screen).newInstance(parent);
                    WestHud.game.setScreenObject(r);
                } catch (Throwable e) {
                    fail("flashback", e);
                }
            }));
            out.add(new Mod("flashback", "Flashback", 0xF06A5A, a));
        }
        return cache = out;
    }

    private static boolean has(String cls) {
        try {
            Class.forName(cls, false, ModMenus.class.getClassLoader());
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    private static void add(List<Action> list, String cls, String label, Icon icon, Supplier<Object> make) {
        if (has(cls)) list.add(new Action(label, icon, s -> open(make.get())));
    }

    private static Object make(String cls) {
        try {
            return Class.forName(cls).getConstructor().newInstance();
        } catch (Throwable e) {
            fail(cls, e);
            return null;
        }
    }

    private static Object settings() {
        try {
            Class<?> c = Class.forName("gg.essential.config.McEssentialConfig");
            Object inst = c.getField("INSTANCE").get(null);
            return c.getMethod("gui").invoke(inst);
        } catch (Throwable e) {
            fail("essential-settings", e);
            return null;
        }
    }

    private static void call(String cls, String method) {
        try {
            Class.forName(cls).getMethod(method).invoke(null);
        } catch (Throwable e) {
            fail(cls, e);
        }
    }

    /** Essential ekranlarını kendi GuiUtil'i ile aç (ekran geçişlerini o yönetir); olmazsa doğrudan */
    private static void open(Object screen) {
        if (screen == null) return;
        try {
            Class<?> gu = Class.forName("gg.essential.util.GuiUtil");
            Object inst = gu.getField("INSTANCE").get(null);
            gu.getMethod("openScreen", Class.forName("net.minecraft.client.gui.screens.Screen")).invoke(inst, screen);
        } catch (Throwable e) {
            WestHud.game.setScreenObject(screen);
        }
    }

    private static void fail(String what, Throwable e) {
        WestHud.LOG.warn("Mod menüsü açılamadı ({}): {}", what, e.toString());
    }
}
