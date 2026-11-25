package dev.west.companion.v121;

import dev.west.hud.WestHud;
import net.minecraft.client.Minecraft;
import net.minecraft.client.resources.sounds.SimpleSoundInstance;
import net.minecraft.client.resources.sounds.SoundInstance;
import net.minecraft.resources.Identifier;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;

/** West arka plan müziği: menüde (ve istenirse oyunda) döngüyle çalar; ses düzeyi Minecraft'ın Müzik ayarıdır. */
public final class WestMusic {
    private static final Identifier TRACK = Identifier.fromNamespaceAndPath("west_companion", "music.lobby");
    private static SoundInstance playing;
    private static int wait;

    private WestMusic() {}

    public static boolean active() {
        if (WestHud.config == null || dev.west.hud.mods.Handoff.waiting()) return false;
        var d = WestHud.config.data;
        return d.music && (Minecraft.getInstance().level == null || d.musicInGame);
    }

    static void tick(Minecraft mc) {
        var sm = mc.getSoundManager();
        if (active()) {
            if (wait > 0) {
                wait--;
                return;
            }
            if (playing == null || !sm.isActive(playing)) {
                playing = new SimpleSoundInstance(TRACK, SoundSource.MUSIC, 1f, 1f, RandomSource.create(), true, 0, SoundInstance.Attenuation.NONE, 0, 0, 0, true);
                sm.play(playing);
                wait = 60; // çalmaya başlaması için zaman tanı; ses aygıtı yoksa sürekli denemesin
            }
        } else if (playing != null) {
            sm.stop(playing);
            playing = null;
            wait = 0;
        }
    }
}
