package dev.west.companion.v26;

import dev.west.hud.WestHud;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.GenericMessageScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.worldselection.WorldOpenFlows;
import net.minecraft.network.chat.Component;
import net.minecraft.world.level.storage.LevelStorageSource;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Ana menünün arkasındaki canlı dünya: modla gelen küçük köy sahnesi arka planda açılır,
 * kamera sabit bir noktadan bloğun üstünde duran gerçek oyuncu karakterine bakar.
 * Oyuncu bir dünyaya/sunucuya girerken sahne önce sessizce kapatılır.
 */
public final class MenuWorld {
    private static final String NAME = "scene";
    /** Bloğun konumu (sahne dünyasında) */
    private static final int PX = 110, PZ = 48;

    static volatile boolean active, opening, placed;
    static WestHost host;
    static double camX, camY, camZ;
    static float camYaw, camPitch;
    private static int ticks, placeTicks;
    private static Integer savedRender;
    private static boolean savedHideGui;
    private static float look, pitch;
    private static float baseYaw;

    private MenuWorld() {}

    public static boolean enabled() {
        var d = WestHud.config == null ? null : WestHud.config.data;
        return d != null && d.liveMenu && !d.performanceMode && d.homeStyle == 0 && d.customTitle;
    }

    /** Gerçek bir oyun mu (sahne dünyası değil) */
    public static boolean realWorld() {
        return Minecraft.getInstance().level != null && !active;
    }

    static void start(Minecraft mc, WestHost h) {
        if (active || !enabled()) return;
        host = h;
        try {
            Path dir = mc.gameDirectory.toPath().resolve("west-menu");
            Path world = dir.resolve(NAME);
            deleteTree(world);
            Files.createDirectories(world);
            try (InputStream in = MenuWorld.class.getResourceAsStream("/assets/west_companion/menuworld/scene.zip")) {
                if (in == null) return;
                try (ZipInputStream z = new ZipInputStream(in)) {
                    ZipEntry e;
                    while ((e = z.getNextEntry()) != null) {
                        Path out = world.resolve(e.getName()).normalize();
                        if (!out.startsWith(world)) continue; // zip içinden dışarı yazma yok
                        if (e.isDirectory()) Files.createDirectories(out);
                        else {
                            Files.createDirectories(out.getParent());
                            Files.copy(z, out);
                        }
                    }
                }
            }
            active = true;
            opening = true;
            placed = false;
            ticks = placeTicks = 0;
            savedHideGui = mc.gui.hud.isHidden();
            if (!savedHideGui) mc.gui.hud.toggle();
            int rd = mc.options.renderDistance().get();
            if (rd > 8) {
                savedRender = rd;
                mc.options.renderDistance().set(8);
            }
            new WorldOpenFlows(mc, LevelStorageSource.createDefault(dir)).openWorld(NAME, () -> stop(mc));
        } catch (Throwable t) {
            WestHud.LOG.warn("Ana menü dünyası açılamadı: {}", t.toString());
            restore(mc);
            active = false;
        } finally {
            opening = false;
        }
    }

    /** Sahne dünyasını kapat (oyuncu bir dünyaya girmeden ya da oyun kapanmadan önce). */
    public static void stop(Minecraft mc) {
        if (!active) return;
        active = false;
        placed = false;
        restore(mc);
        if (mc.level != null) {
            try {
                mc.disconnect(new GenericMessageScreen(Component.literal("")), false);
            } catch (Throwable t) {
                WestHud.LOG.warn("Ana menü dünyası kapatılamadı: {}", t.toString());
            }
        }
    }

    private static void restore(Minecraft mc) {
        if (mc.gui.hud.isHidden() != savedHideGui) mc.gui.hud.toggle();
        if (savedRender != null) {
            mc.options.renderDistance().set(savedRender);
            savedRender = null;
        }
    }

    static void tick(Minecraft mc) {
        if (!active) return;
        ticks++;
        var player = mc.player;
        if (player == null || mc.level == null || mc.getSingleplayerServer() == null) return;
        if (!placed) {
            if (placeTicks++ == 0) {
                var srv = mc.getSingleplayerServer();
                srv.execute(() -> {
                    var src = srv.createCommandSourceStack().withSuppressedOutput();
                    String[] cmds = {
                            "gamerule advance_time false", "gamerule doDaylightCycle false",
                            "gamerule advance_weather false", "gamerule doWeatherCycle false",
                            "gamerule spawn_mobs false", "gamerule doMobSpawning false",
                            "time set 11400", "weather clear", "gamemode creative @a",
                            "kill @e[type=!player]",
                            "execute positioned " + PX + ".5 0 " + PZ + ".5 positioned over motion_blocking_no_leaves run tp @a " + PX + ".5 ~ " + PZ + ".5 0 0",
                    };
                    for (String c : cmds) {
                        try {
                            srv.getCommands().performPrefixedCommand(src, c);
                        } catch (Throwable ignored) {
                        }
                    }
                });
                return;
            }
            // Işınlanma istemciye ulaşınca kamerayı yerleştir; chunk henüz yüklenmediyse tekrar dene
            if (placeTicks < 6) return;
            double px = player.getX(), py = player.getY(), pz = player.getZ();
            if (placeTicks % 30 == 0 && (Math.abs(px - (PX + 0.5)) > 0.3 || Math.abs(pz - (PZ + 0.5)) > 0.3)) {
                var srv = mc.getSingleplayerServer();
                srv.execute(() -> {
                    var src = srv.createCommandSourceStack().withSuppressedOutput();
                    try {
                        srv.getCommands().performPrefixedCommand(src, "execute positioned " + PX + ".5 0 " + PZ + ".5 positioned over motion_blocking_no_leaves run tp @a " + PX + ".5 ~ " + PZ + ".5 0 0");
                    } catch (Throwable ignored) {
                    }
                });
            }
            if (Math.abs(px - (PX + 0.5)) > 0.3 || Math.abs(pz - (PZ + 0.5)) > 0.3) {
                if (placeTicks > 200) placed = true; // vazgeç: nerede olursa
                return;
            }
            // Kamera: biraz sağ-önden, göğüs hizasının hafif üstünden (3B görünüm)
            // Karakter büyük ama sığsın: orta plan, hafif soldan ve yukarıdan (3B görünüm)
            camX = px - 1.15;
            camY = py + 2.0;
            camZ = pz + 3.75;
            double dx = px - camX, dz = pz - camZ, dy = (py + 1.0) - camY;
            camYaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
            camPitch = (float) -Math.toDegrees(Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)));
            // Oyuncu kameraya dönük dursun
            baseYaw = camYaw + 180f;
            look = 0;
            pitch = 0;
            placed = true;
            WestHud.LOG.info("menü dünyası hazır: kamera {} {} {} yaw {} pitch {}", camX, camY, camZ, camYaw, camPitch);
        }
        // Kafa fare imlecini takip etsin: imlecin kamera düzlemindeki karşılığına bak
        var win = mc.getWindow();
        double nx = win.getScreenWidth() > 0 ? mc.mouseHandler.xpos() / win.getScreenWidth() * 2 - 1 : 0;
        double ny = win.getScreenHeight() > 0 ? mc.mouseHandler.ypos() / win.getScreenHeight() * 2 - 1 : 0;
        double yawR = Math.toRadians(camYaw);
        double rx = -Math.cos(yawR), rz = -Math.sin(yawR); // ekranın sağı
        double tx = camX + rx * nx * 3.2, tz = camZ + rz * nx * 3.2, ty = camY - ny * 2.0;
        double eye = player.getY() + 1.62;
        double hx = tx - player.getX(), hz = tz - player.getZ();
        float headYaw = (float) Math.toDegrees(Math.atan2(-hx, hz));
        float headPitch = (float) -Math.toDegrees(Math.atan2(ty - eye, Math.sqrt(hx * hx + hz * hz)));
        float off = wrap(headYaw - baseYaw);
        off = Math.max(-70, Math.min(70, off));
        headPitch = Math.max(-40, Math.min(40, headPitch));
        look += (off - look) * 0.35f;
        pitch += (headPitch - pitch) * 0.35f;
        player.setYRot(baseYaw + look * 0.3f);
        player.setYHeadRot(baseYaw + look);
        player.setYBodyRot(baseYaw + look * 0.3f);
        player.setXRot(pitch);
    }

    private static float wrap(float d) {
        d %= 360f;
        if (d >= 180f) d -= 360f;
        if (d < -180f) d += 360f;
        return d;
    }

    public static boolean cameraReady() {
        return active && placed;
    }

    public static boolean isOpening() {
        return opening;
    }

    public static double camX() { return camX; }
    public static double camY() { return camY; }
    public static double camZ() { return camZ; }
    public static float camYaw() { return camYaw; }
    public static float camPitch() { return camPitch; }

    public static void showHost() {
        Minecraft mc = Minecraft.getInstance();
        if (host != null && mc.gui.screen() != host) mc.gui.setScreen(host);
    }

    /** Sahne dünyası açıkken yükleme / duraklatma ekranları yerine ana menü kalsın */
    public static boolean swallow(Screen next) {
        if (!active || host == null) return false;
        if (next == null) return true;
        if (next instanceof WestHost) return false;
        String n = next.getClass().getSimpleName();
        return next instanceof net.minecraft.client.gui.screens.PauseScreen || n.contains("Loading") || n.contains("Progress")
                || n.contains("GenericMessage") || n.contains("Receiving") || n.contains("DeathScreen");
    }

    private static void deleteTree(Path p) {
        if (!Files.exists(p)) return;
        try (Stream<Path> s = Files.walk(p)) {
            s.sorted(Comparator.reverseOrder()).forEach(f -> {
                try {
                    Files.deleteIfExists(f);
                } catch (Exception ignored) {
                }
            });
        } catch (Exception ignored) {
        }
    }
}
