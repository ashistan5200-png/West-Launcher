package dev.west.companion;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.multiplayer.PlayerInfo;

/** Hafif FPS / MS / bellek göstergesi (sol üst). Metinler saniyede bir güncellenir. */
public final class Hud {
    private static String line = "";
    private static long lastBuild;

    private Hud() {}

    public static void render(GuiGraphics g) {
        Minecraft mc = Minecraft.getInstance();
        if (!West.config.fpsOverlay || mc.options.hideGui || mc.getDebugOverlay().showDebugScreen()) return;
        SafeHook.run("hud", () -> {
            long now = System.currentTimeMillis();
            if (now - lastBuild > 1000) {
                lastBuild = now;
                StringBuilder sb = new StringBuilder().append(mc.getFps()).append(" FPS");
                if (mc.getConnection() != null && mc.player != null) {
                    PlayerInfo info = mc.getConnection().getPlayerInfo(mc.player.getUUID());
                    if (info != null && !mc.hasSingleplayerServer()) sb.append("  ·  ").append(info.getLatency()).append(" ms");
                }
                Runtime rt = Runtime.getRuntime();
                long used = (rt.totalMemory() - rt.freeMemory()) >> 20;
                sb.append("  ·  ").append(used).append("/").append(rt.maxMemory() >> 20).append(" MB");
                line = sb.toString();
            }
            int w = mc.font.width(line);
            g.fill(4, 4, 12 + w, 18, 0x88101113);
            g.drawString(mc.font, line, 8, 7, 0xFFE2E4E7, false);
        });
    }
}
