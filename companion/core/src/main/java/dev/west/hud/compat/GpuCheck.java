package dev.west.hud.compat;

import dev.west.hud.Tr;
import dev.west.hud.WestHud;

import java.util.Locale;
import java.util.regex.Pattern;

/** Oyun güçlü ekran kartı yerine entegre/yazılımsal grafikte çalışıyorsa oyuncuyu uyarır (düşük FPS'in en sık sebebi). */
public final class GpuCheck {
    private GpuCheck() {}

    private static final Pattern WEAK = Pattern.compile(
            "llvmpipe|basic render|swiftshader|softpipe|intel\\(r\\) (uhd|hd|iris)|intel (uhd|hd|iris)|radeon(\\(tm\\))? (\\d{3,4}m )?graphics|radeon vega \\d+ graphics");

    /** @param type 26.x'te Minecraft'ın bildirdiği aygıt türü (INTEGRATED, CPU…); bilinmiyorsa null */
    public static String hint(String name, String type) {
        if (name == null) return null;
        WestHud.LOG.info("Ekran kartı: {} ({})", name, type == null ? "?" : type);
        String n = name.toLowerCase(Locale.ROOT);
        boolean weak = "INTEGRATED".equals(type) || "CPU".equals(type) || "VIRTUAL".equals(type) || WEAK.matcher(n).find();
        if (!weak) return null;
        return Tr.t("Oyun güçlü ekran kartın yerine \"{0}\" üzerinde çalışıyor; düşük FPS'in sebebi bu. West Client bu Java için yüksek performans tercihini ayarladı: oyunu kapatıp yeniden aç. Düzelmezse Windows Ayarlar → Sistem → Ekran → Grafik → javaw.exe → Yüksek performans yap ve monitör kablosunun ekran kartına takılı olduğundan emin ol.", name);
    }
}
