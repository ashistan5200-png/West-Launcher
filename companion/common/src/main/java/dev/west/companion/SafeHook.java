package dev.west.companion;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Hata toleranslı kanca: bir özellik hata verirse oyun çökmez; o özellik
 * oturum boyunca kapatılır ve vanilla davranışa dönülür.
 */
public final class SafeHook {
    private static final Set<String> DISABLED = ConcurrentHashMap.newKeySet();

    private SafeHook() {}

    public static boolean enabled(String feature) {
        return !DISABLED.contains(feature);
    }

    public static void disable(String feature, Throwable t) {
        if (DISABLED.add(feature)) {
            West.LOG.error("West Companion: '{}' özelliği hata verdi ve bu oturum için kapatıldı; oyun vanilla davranışla devam ediyor.", feature, t);
        }
    }

    public static void run(String feature, Runnable r) {
        if (!enabled(feature)) return;
        try {
            r.run();
        } catch (Throwable t) {
            disable(feature, t);
        }
    }
}
