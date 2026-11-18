package dev.west.hud.lobby;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Bir karede sürüm adaptörünün çizmesi gereken her şey: biyom sahnesi, kamera ve karakterler. */
public final class LobbyFrame {
    public LobbyScene scene;
    public final LobbyCamera camera = new LobbyCamera();
    /** Saniye: yaprak sallanması ve bekleme animasyonu için */
    public float time;
    /** Hafif lobi: 3B dünya çizilmez, yalnızca karakterler */
    public boolean light;
    public final List<Avatar> avatars = new ArrayList<>();

    /** Lobideki bir karakter. Konum dünya koordinatında (ayak hizası). */
    public static final class Avatar {
        public final String key;
        public String name;
        /** Skin için Minecraft UUID'si (bilinmiyorsa null: isimden bulunur) */
        public UUID uuid;
        public boolean self;
        public float x, y, z, yaw;
        /** Görünürlük 0–1 (ışınlanma efekti sırasında) */
        public float alpha = 1;
        /** Kişiye özel animasyon kayması */
        public float phase;
        /** Başın baktığı yön (radyan, gövdeye göre); NaN ise kendiliğinden etrafa bakar */
        public float lookYaw = Float.NaN, lookPitch;

        public Avatar(String key) {
            this.key = key;
            this.phase = (key.hashCode() & 0xFFFF) / 6553.6f;
        }
    }
}
