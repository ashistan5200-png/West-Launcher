package dev.west.companion;

import java.nio.file.Path;

/** Loader'a özgü küçük köprü (Fabric / NeoForge). */
public interface Platform {
    boolean isModLoaded(String id);

    Path configDir();

    Path gameDir();

    String loaderName();
}
