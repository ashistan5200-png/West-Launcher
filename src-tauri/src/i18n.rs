//! Launcher arka ucunun kullanıcıya görünen mesajlarının çevirisi.
//!
//! Kaynak metin Türkçedir ve anahtar olarak kullanılır: t("Oyun açılamadı") → "Couldn't start the game".
//! Değişkenli mesajlarda yer tutucular {0}, {1}… şeklindedir: tf("{0} indirilemedi", &[&ad]).
//! Dil, Ayarlar'daki seçimden gelir (bkz. set_lang); çevirisi olmayan metin Türkçe kalır.

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::fmt::Display;

static LANG: Lazy<RwLock<String>> = Lazy::new(|| RwLock::new("tr".into()));

fn parse(src: &str) -> HashMap<String, String> {
    serde_json::from_str(src).unwrap_or_default()
}

static EN: Lazy<HashMap<String, String>> = Lazy::new(|| parse(include_str!("../i18n/en.json")));
static DE: Lazy<HashMap<String, String>> = Lazy::new(|| parse(include_str!("../i18n/de.json")));

/// Ayarlar yüklenince ve değişince çağrılır. Boş ya da bilinmeyen dil → Türkçe.
pub fn set_lang(lang: &str) {
    let l = match lang {
        "en" | "de" => lang,
        _ => "tr",
    };
    *LANG.write() = l.to_string();
}

pub fn lang() -> String {
    LANG.read().clone()
}

/// Metni seçili dile çevir
pub fn t(s: &str) -> String {
    let dict = match LANG.read().as_str() {
        "en" => &*EN,
        "de" => &*DE,
        _ => return s.to_string(),
    };
    dict.get(s).cloned().unwrap_or_else(|| s.to_string())
}

/// Değişkenli metni çevir: {0}, {1}… yer tutucuları sırayla doldurulur
pub fn tf(s: &str, args: &[&dyn Display]) -> String {
    let mut out = t(s);
    for (i, a) in args.iter().enumerate() {
        out = out.replace(&format!("{{{i}}}"), &a.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_and_args() {
        set_lang("tr");
        assert_eq!(tf("{0} indirilemedi ({1})", &[&"Sodium", &3]), "Sodium indirilemedi (3)");
        set_lang("xx");
        assert_eq!(lang(), "tr");
        // Sözlükte olmayan metin olduğu gibi kalır
        set_lang("en");
        assert_eq!(t("bu metin sözlükte yok"), "bu metin sözlükte yok");
        set_lang("tr");
    }
}
