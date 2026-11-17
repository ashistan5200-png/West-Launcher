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
    /** Karakterin başladığı yer: bloğun kaç blok önü (+z) */
    private static final int WALK = 7;
    static double finX, finY, finZ, startX, startY2, startZ;
    private static int pedTop, walkTicks;
    private static boolean walking;
    private static long introStart;
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
            // Menüde görüş mesafesi 16 chunk: uzaktaki dağlar ve köy görünsün
            int rd = mc.options.renderDistance().get();
            if (rd != 16) {
                savedRender = rd;
                mc.options.renderDistance().set(16);
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
        mc.options.keyUp.setDown(false);
        mc.options.keyJump.setDown(false);
        walking = false;
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
                            "time set 11400", "weather clear", "gamemode creative @a", "kill @e[type=!player]",
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
            // Bloğun ve başlangıç noktasının chunk'ları istemciye gelene kadar bekle
            var level = mc.level;
            if (!level.hasChunk(PX >> 4, PZ >> 4) || !level.hasChunk(PX >> 4, (PZ + WALK) >> 4)) {
                if (placeTicks > 400) placed = true;
                return;
            }
            pedTop = level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, PX, PZ);
            int startY = level.getHeight(net.minecraft.world.level.levelgen.Heightmap.Types.MOTION_BLOCKING_NO_LEAVES, PX, PZ + WALK);
            if (pedTop <= level.getMinY() + 1) return;
            var srv = mc.getSingleplayerServer();
            String tp = "tp @a " + PX + ".5 " + startY + " " + (PZ + WALK) + ".5 180 0";
            srv.execute(() -> {
                try {
                    srv.getCommands().performPrefixedCommand(srv.createCommandSourceStack().withSuppressedOutput(), tp);
                } catch (Throwable ignored) {
                }
            });
            // Son kamera: hafif soldan, yukarıdan, orta plan
            double cx = PX + 0.5, cz = PZ + 0.5;
            finX = cx - 1.15;
            finY = pedTop + 2.0;
            finZ = cz + 3.75;
            // Başlangıç kamerası: uzaktan, köyün üstünden
            startX = cx - 18;
            startY2 = pedTop + 16;
            startZ = cz + 30;
            baseYaw = (float) Math.toDegrees(Math.atan2(-(finX - cx), finZ - cz));
            introStart = System.nanoTime();
            walking = true;
            walkTicks = 0;
            look = 0;
            pitch = 0;
            placed = true;
            WestHud.LOG.info("menü dünyası hazır (blok y={})", pedTop);
            return;
        }
        if (walking) {
            walk(mc, player);
            return;
        }
        // Kafa fare imlecini takip etsin: imlecin kamera düzlemindeki karşılığına bak
        var win = mc.getWindow();
        double nx = win.getScreenWidth() > 0 ? mc.mouseHandler.xpos() / win.getScreenWidth() * 2 - 1 : 0;
        double ny = win.getScreenHeight() > 0 ? mc.mouseHandler.ypos() / win.getScreenHeight() * 2 - 1 : 0;
        float cy = camYaw();
        double yawR = Math.toRadians(cy);
        double rx = -Math.cos(yawR), rz = -Math.sin(yawR); // ekranın sağı
        double tx = finX + rx * nx * 3.2, tz = finZ + rz * nx * 3.2, ty = finY - ny * 2.0;
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

    /** Karakter başlangıç noktasından bloğa yürür ve üstüne zıplar */
    private static void walk(Minecraft mc, net.minecraft.client.player.LocalPlayer player) {
        walkTicks++;
        double tx = PX + 0.5, tz = PZ + 0.5;
        double dx = tx - player.getX(), dz = tz - player.getZ();
        double dist = Math.sqrt(dx * dx + dz * dz);
        // Kamera yaklaşırken yürümeye başla
        if (walkTicks < 45) {
            mc.options.keyUp.setDown(false);
            return;
        }
        boolean onTop = player.getY() >= pedTop - 0.01 && dist < 0.35;
        if (onTop || walkTicks > 240) {
            mc.options.keyUp.setDown(false);
            mc.options.keyJump.setDown(false);
            player.setDeltaMovement(0, player.getDeltaMovement().y, 0);
            walking = false;
            return;
        }
        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        player.setYRot(yaw);
        player.setYHeadRot(yaw);
        player.setYBodyRot(yaw);
        player.setXRot(0);
        mc.options.keyUp.setDown(dist > 0.2);
        boolean needJump = player.getY() < pedTop - 0.5 && dist < 1.6;
        mc.options.keyJump.setDown(needJump && player.onGround());
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

    /** Açılış: kamera 6 sn'de uzaktan son noktasına süzülür */
    private static float intro() {
        float t = Math.min(1, (System.nanoTime() - introStart) / 1e9f / 6f);
        return t < 0.5f ? 4 * t * t * t : 1 - (float) Math.pow(-2 * t + 2, 3) / 2;
    }

    public static double camX() { return startX + (finX - startX) * intro(); }
    public static double camY() { return startY2 + (finY - startY2) * intro(); }
    public static double camZ() { return startZ + (finZ - startZ) * intro(); }

    /** Bakılan nokta: önce bloğun çevresi, sonra karakterin göğsü */
    private static double[] focus() {
        Minecraft mc = Minecraft.getInstance();
        double fx = PX + 0.5, fy = pedTop + 1.0, fz = PZ + 0.5;
        if (mc.player != null) {
            float k = intro();
            fx = fx + (mc.player.getX() - fx) * k;
            fz = fz + (mc.player.getZ() - fz) * k;
            fy = fy + ((mc.player.getY() + 1.0) - fy) * k;
        }
        return new double[] { fx, fy, fz };
    }

    public static float camYaw() {
        double[] f = focus();
        return (float) Math.toDegrees(Math.atan2(-(f[0] - camX()), f[2] - camZ()));
    }

    public static float camPitch() {
        double[] f = focus();
        double dx = f[0] - camX(), dz = f[2] - camZ();
        return (float) -Math.toDegrees(Math.atan2(f[1] - camY(), Math.sqrt(dx * dx + dz * dz)));
    }

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
