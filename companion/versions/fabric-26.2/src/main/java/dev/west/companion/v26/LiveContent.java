package dev.west.companion.v26;

import dev.west.hud.WestHud;
import net.minecraft.client.Minecraft;
import net.minecraft.world.level.storage.LevelResource;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Oyun içi mod merkezi: kaynak paketi / shader / veri paketi değişikliklerini oyun kapanmadan uygular. */
final class LiveContent {
    private LiveContent() {}

    private static Minecraft mc() {
        return Minecraft.getInstance();
    }

    static String worldFolder() {
        var srv = mc().getSingleplayerServer();
        if (srv == null) return null;
        var p = srv.getWorldPath(LevelResource.ROOT).toAbsolutePath().normalize();
        return p.getFileName() == null ? null : p.getFileName().toString();
    }

    static String serverAddress() {
        var d = mc().getCurrentServer();
        return d == null || mc().hasSingleplayerServer() ? null : d.ip;
    }

    private static String packId(String contentId) {
        String name = contentId.substring(contentId.indexOf('/') + 1);
        return "file/" + name;
    }

    static Set<String> activeResourcePacks() {
        Set<String> out = new HashSet<>();
        for (String id : mc().getResourcePackRepository().getSelectedIds())
            if (id.startsWith("file/")) out.add("resourcepacks/" + id.substring(5));
        return out;
    }

    static void applyResourcePacks(List<String> enable, List<String> disable, Runnable then) {
        Minecraft m = mc();
        var repo = m.getResourcePackRepository();
        repo.reload();
        boolean changed = false;
        for (String id : disable) changed |= repo.removePack(packId(id));
        for (String id : enable) changed |= repo.addPack(packId(id));
        if (!changed) {
            if (then != null) then.run();
            return;
        }
        m.options.updateResourcePacks(repo);
        m.options.save();
        m.reloadResourcePacks().whenComplete((v, e) -> {
            if (then != null) m.execute(then);
        });
    }

    private static Object irisConfig() throws Exception {
        return Class.forName("net.irisshaders.iris.Iris").getMethod("getIrisConfig").invoke(null);
    }

    static boolean shadersSupported() {
        try {
            irisConfig();
            return true;
        } catch (Throwable e) {
            return false;
        }
    }

    static String activeShader() {
        try {
            Object cfg = irisConfig();
            boolean on = (boolean) cfg.getClass().getMethod("areShadersEnabled").invoke(cfg);
            Object name = cfg.getClass().getMethod("getShaderPackName").invoke(cfg);
            if (!on) return null;
            if (name instanceof java.util.Optional<?> o) return o.map(Object::toString).orElse(null);
            return name == null ? null : name.toString();
        } catch (Throwable e) {
            return null;
        }
    }

    static boolean applyShader(String file) {
        try {
            Class<?> iris = Class.forName("net.irisshaders.iris.Iris");
            Object cfg = irisConfig();
            if (file != null) cfg.getClass().getMethod("setShaderPackName", String.class).invoke(cfg, file);
            cfg.getClass().getMethod("setShadersEnabled", boolean.class).invoke(cfg, file != null);
            cfg.getClass().getMethod("save").invoke(cfg);
            iris.getMethod("reload").invoke(null);
            return true;
        } catch (Throwable e) {
            WestHud.LOG.warn("Shader değiştirilemedi: {}", e.toString());
            return false;
        }
    }

    static void enableDatapack(String file) {
        var srv = mc().getSingleplayerServer();
        if (srv == null || file == null || file.contains("\"")) return;
        srv.execute(() -> srv.getCommands().performPrefixedCommand(srv.createCommandSourceStack(), "datapack enable \"file/" + file + "\""));
    }

    static Set<String> loadedMods() {
        Set<String> out = new HashSet<>();
        for (var c : net.fabricmc.loader.api.FabricLoader.getInstance().getAllMods()) out.add(c.getMetadata().getId());
        return out;
    }

    static void openUrl(String url) {
        if (url != null && url.startsWith("https://")) net.minecraft.util.Util.getPlatform().openUri(url);
    }

    static void stop() {
        mc().execute(() -> mc().stop());
    }
}
