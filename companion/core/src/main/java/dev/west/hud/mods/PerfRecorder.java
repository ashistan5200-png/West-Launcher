package dev.west.hud.mods;

import com.google.gson.JsonObject;
import dev.west.hud.WestHud;
import dev.west.hud.api.Game;

/**
 * "Neden kasıyor?" için oturum ölçümü: dünyadayken her karenin süresini, saniyelik FPS'i, uzun donmaları
 * (100 ms+) ve bellek tepe noktasını toplar. Dünyadan çıkınca ya da oyun kapanırken launcher'a gönderir;
 * launcher bunları yorumlayıp instance sayfasında gösterir.
 */
public final class PerfRecorder {
    private static long last, secStart, worldStart;
    private static int framesThisSec, stutters, frames;
    private static final int[] fpsHist = new int[1200]; // en fazla 20 dk'lık saniyelik FPS (döngüsel)
    private static int secs;
    private static float minFps = Float.MAX_VALUE, memPeak;
    private static boolean active;

    private PerfRecorder() {}

    /** Her çizilen karede (yalnızca dünyadayken) çağrılır */
    public static void frame(Game game) {
        long now = System.nanoTime();
        if (!active) {
            active = true;
            last = secStart = worldStart = now;
            framesThisSec = stutters = frames = secs = 0;
            minFps = Float.MAX_VALUE;
            memPeak = 0;
            return;
        }
        long dt = now - last;
        last = now;
        frames++;
        framesThisSec++;
        if (dt > 100_000_000L && dt < 10_000_000_000L) stutters++;
        if (now - secStart >= 1_000_000_000L) {
            float fps = framesThisSec * 1e9f / (now - secStart);
            fpsHist[secs % fpsHist.length] = Math.round(fps);
            secs++;
            if (secs > 5) minFps = Math.min(minFps, fps); // ilk saniyeler (dünya yüklenirken) sayılmaz
            framesThisSec = 0;
            secStart = now;
            Runtime rt = Runtime.getRuntime();
            float used = (rt.totalMemory() - rt.freeMemory()) * 100f / rt.maxMemory();
            memPeak = Math.max(memPeak, used);
        }
    }

    /** Dünyadan çıkıldı / oyun kapanıyor: ölçümü gönder ve sıfırla */
    public static void finish(Game game) {
        if (!active) return;
        active = false;
        int n = Math.min(secs, fpsHist.length);
        if (n < 20 || !ModBridge.INSTANCE.available()) return;
        int[] v = new int[n];
        System.arraycopy(fpsHist, 0, v, 0, n);
        java.util.Arrays.sort(v);
        long sum = 0;
        for (int x : v) sum += x;
        int lowN = Math.max(1, n / 100);
        long lowSum = 0;
        for (int i = 0; i < lowN; i++) lowSum += v[i];
        JsonObject o = new JsonObject();
        o.addProperty("seconds", (System.nanoTime() - worldStart) / 1_000_000_000L);
        o.addProperty("inWorldSecs", secs);
        o.addProperty("fpsAvg", sum / (float) n);
        o.addProperty("fpsLow1", lowSum / (float) lowN);
        o.addProperty("fpsMin", minFps == Float.MAX_VALUE ? 0 : minFps);
        o.addProperty("stutters", stutters);
        o.addProperty("memPeakPct", memPeak);
        o.addProperty("memMaxMb", Runtime.getRuntime().maxMemory() / (1024 * 1024));
        o.addProperty("renderDistance", game.renderDistance());
        o.addProperty("shaders", shadersInUse());
        o.addProperty("mods", game.mods().size());
        ModBridge.INSTANCE.sendPerf(o);
    }

    /** Iris'in herkese açık API'siyle shader paketi açık mı (Iris yoksa false) */
    static boolean shadersInUse() {
        try {
            Class<?> api = Class.forName("net.irisshaders.iris.api.v0.IrisApi");
            Object inst = api.getMethod("getInstance").invoke(null);
            return (boolean) api.getMethod("isShaderPackInUse").invoke(inst);
        } catch (Throwable e) {
            return false;
        }
    }
}
