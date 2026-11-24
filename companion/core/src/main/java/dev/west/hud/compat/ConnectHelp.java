package dev.west.hud.compat;

import dev.west.hud.Tr;

import java.util.List;
import java.util.Locale;

/**
 * Sunucuya ya da Essential dünyasına bağlanılamadığında, Minecraft'ın bağlantı kesildi ekranındaki
 * sebebi (çeviri anahtarları + metin) okuyup anlaşılır bir açıklama ve çözüm üretir.
 */
public final class ConnectHelp {
    private ConnectHelp() {}

    /** keys: sebep bileşenlerindeki çeviri anahtarları; text: ekrandaki düz metin; offline: çevrimdışı hesapla mı oynanıyor */
    public static String hint(List<String> keys, String text, boolean offline) {
        String t = text == null ? "" : text.toLowerCase(Locale.ROOT);
        boolean session = has(keys, "invalidSession") || has(keys, "unverified_username") || has(keys, "disconnect.loginFailedInfo.invalidSession")
                || t.contains("invalid session") || t.contains("failed to verify username") || t.contains("geçersiz oturum") || t.contains("doğrulanamadı");
        if (offline && (session || has(keys, "disconnect.loginFailed") || t.contains("essential")))
            return Tr.t("Çevrimdışı (offline) hesapla oynuyorsun. Çevrimiçi sunucular ve Essential dünyaları Microsoft hesabı ister: West Client'ta Microsoft hesabını seçip oyunu yeniden başlat.");
        if (session)
            return Tr.t("Minecraft oturumun geçersiz ya da süresi dolmuş. Oyunu kapatıp West Client'tan yeniden başlat; oturum açılışta yenilenir. Düzelmezse West Client'ta hesabından çıkıp yeniden giriş yap.");
        if (has(keys, "insufficientPrivileges") || t.contains("multiplayer is disabled") || t.contains("çok oyunculu devre dışı"))
            return Tr.t("Xbox/Microsoft hesabında çok oyunculu oyun kapalı. account.xbox.com → Gizlilik ve çevrimiçi güvenlik → \"Xbox dışındaki çok oyunculu oyunlara katılabilirsin\" ayarını İzin ver yap (çocuk hesabıysa aile yöneticisi açmalı).");
        if (has(keys, "serversUnavailable") || t.contains("authentication servers are down"))
            return Tr.t("Mojang'ın oturum sunucularına ulaşılamıyor. İnternet bağlantını, varsa VPN/proxy'ni ve güvenlik duvarını kontrol et; biraz sonra tekrar dene.");
        if (has(keys, "userBanned") || t.contains("banned from playing online"))
            return Tr.t("Bu hesap çevrimiçi oyundan yasaklanmış; sunuculara giremez.");
        if (has(keys, "outdated") || t.contains("outdated") || t.contains("incompatible"))
            return Tr.t("Sunucu başka bir Minecraft sürümü kullanıyor. Sunucunun sürümünde bir instance oluşturup onunla bağlan.");
        if (t.contains("connection refused") || t.contains("timed out") || t.contains("unknown host") || t.contains("bağlantı reddedildi") || t.contains("zaman aşımı"))
            return Tr.t("Sunucuya ulaşılamadı. Adresi kontrol et; sunucu kapalı olabilir ya da güvenlik duvarı Java'yı engelliyor olabilir.");
        return null;
    }

    private static boolean has(List<String> keys, String part) {
        for (String k : keys) if (k.contains(part)) return true;
        return false;
    }
}
