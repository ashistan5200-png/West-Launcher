package dev.west.hud;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Oyun içi West arayüzünün çevirileri. Kaynak metin Türkçedir ve anahtar olarak kullanılır:
 * Tr.t("Ayarlar") → "Settings" / "Einstellungen". Değişkenli: Tr.t("{0} arkadaş", n).
 * Dil, launcher'ın yazdığı yapılandırmadan (Config.Data.language) okunur; çevirisi olmayan metin Türkçe kalır.
 */
public final class Tr {
    private Tr() {}

    private static String lang;
    private static Map<String, String> dict = Map.of();

    private static void ensure() {
        String want = WestHud.config == null || WestHud.config.data.language == null ? "tr" : WestHud.config.data.language;
        if (want.equals(lang)) return;
        lang = want;
        dict = want.equals("tr") ? Map.of() : load(want);
    }

    private static Map<String, String> load(String l) {
        Map<String, String> m = new HashMap<>();
        try (InputStream in = Tr.class.getResourceAsStream("/west_i18n/" + l + ".json")) {
            if (in == null) return m;
            JsonObject o = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            for (var e : o.entrySet()) m.put(e.getKey(), e.getValue().getAsString());
        } catch (Exception e) {
            WestHud.LOG.warn("West çevirileri okunamadı ({}): {}", l, e.toString());
        }
        return m;
    }

    public static String t(String s, Object... args) {
        ensure();
        String out = dict.getOrDefault(s, s);
        for (int i = 0; i < args.length; i++) out = out.replace("{" + i + "}", String.valueOf(args[i]));
        return out;
    }

    /** Tarih/sayı biçimleri için Java yerel ayarı */
    public static java.util.Locale locale() {
        return switch (lang()) {
            case "en" -> java.util.Locale.ENGLISH;
            case "de" -> java.util.Locale.GERMAN;
            default -> java.util.Locale.forLanguageTag("tr-TR");
        };
    }

    /** Geçerli dil: "tr" | "en" | "de" */
    public static String lang() {
        ensure();
        return lang;
    }
}
