//! Çökme parmak izi: iki çökmenin "aynı hata" olup olmadığını anlamak için.
//!
//! Suçlu avında bir modu kapatmak, ona gizlice bağlı başka bir modun *farklı*
//! bir hatayla çökmesine yol açabilir. Bu çökme asıl hatayla karıştırılırsa av
//! yanlış moda (çoğunlukla bir kütüphaneye) yönelir. Bu yüzden her denemenin
//! çökmesi ilk (tüm modlar açık) çökmenin parmak iziyle karşılaştırılır.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Fingerprint {
    /// Mod yükleyici bağımlılık/uyumsuzluk hatası (oyun hiç başlamadı)
    Dependency { message: String },
    /// Java istisnası
    Exception { class: String, message: String },
    /// Süre aşımı: oyun takıldı
    Hang,
    /// Çöktü ama nedeni loglardan okunamadı
    Unknown,
}

static EXC: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^(?:Caused by: |Exception in thread \S+ |\s*)?((?:[a-zA-Z_$][\w$]*\.)+[A-Z][\w$]*(?:Exception|Error|Throwable))(?::\s*(.*))?$").unwrap());
static DESC: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?m)^Description: (.*)$").unwrap());
static DEP: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(Incompatible mods? found|ModResolutionException|requires (?:any version|version) .* of|which is missing|Mod loading has failed|Missing or unsupported mandatory dependencies|is incompatible with)").unwrap()
});
static MISSING_CLASS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:NoClassDefFoundError|ClassNotFoundException):\s*([\w$./]+)").unwrap());
static NOISE: Lazy<Regex> = Lazy::new(|| Regex::new(r"0x[0-9a-fA-F]+|\b\d+\b|@[0-9a-f]{4,}").unwrap());

/// Sıradan, her oyunda görülen ve gerçek nedeni taşımayan sarmalayıcı istisnalar.
const WRAPPERS: &[&str] = &[
    "net.minecraft.ReportedException",
    "net.minecraft.class_148",
    "java.util.concurrent.CompletionException",
    "java.util.concurrent.ExecutionException",
    "java.lang.reflect.InvocationTargetException",
    "java.lang.RuntimeException",
];

fn normalize(msg: &str) -> String {
    let m = NOISE.replace_all(msg.trim(), "#");
    m.chars().take(160).collect()
}

/// Log satırlarından (ve varsa çökme raporundan) parmak izi çıkarır.
pub fn from_text(text: &str, timed_out: bool) -> Fingerprint {
    if timed_out {
        return Fingerprint::Hang;
    }
    if let Some(m) = DEP.find(text) {
        // Yükleyicinin açıklayıcı satırını al
        let line = text[m.start()..].lines().next().unwrap_or("").trim();
        return Fingerprint::Dependency { message: line.chars().take(300).collect() };
    }
    // En içteki (gerçek) istisna: önce "Caused by" zincirinin sonu, yoksa ilk istisna
    let mut best: Option<(String, String)> = None;
    for c in EXC.captures_iter(text) {
        let class = c[1].to_string();
        if class.starts_with("org.slf4j") || class.contains("Logger") {
            continue;
        }
        let msg = c.get(2).map(|m| m.as_str()).unwrap_or("");
        let is_cause = c.get(0).map(|m| m.as_str().trim_start().starts_with("Caused by")).unwrap_or(false);
        if best.is_none() || is_cause || WRAPPERS.contains(&best.as_ref().unwrap().0.as_str()) {
            best = Some((class, normalize(msg)));
        }
    }
    if let Some((class, message)) = best {
        return Fingerprint::Exception { class, message };
    }
    if let Some(d) = DESC.captures(text) {
        return Fingerprint::Exception { class: "Description".into(), message: normalize(&d[1]) };
    }
    Fingerprint::Unknown
}

impl Fingerprint {
    /// Bu deneme çökmesi, ilk çökmeyle aynı sorun mu?
    pub fn same_as(&self, baseline: &Fingerprint) -> bool {
        use Fingerprint::*;
        match (self, baseline) {
            // Nedeni okunamayan çökmeyi eskisi gibi "aynı" say (temkinli)
            (Unknown, _) | (_, Unknown) => true,
            (Hang, Hang) => true,
            (Dependency { .. }, Dependency { .. }) => true,
            (Exception { class: a, message: ma }, Exception { class: b, message: mb }) => a == b && (ma == mb || ma.is_empty() || mb.is_empty() || ma.starts_with(mb.as_str()) || mb.starts_with(ma.as_str())),
            _ => false,
        }
    }

    /// Gizli bağımlılık ipucu: eksik sınıf (paket yolu, `/` ile).
    pub fn missing_class(text: &str) -> Option<String> {
        MISSING_CLASS.captures(text).map(|c| c[1].replace('.', "/").trim_end_matches(".class").to_string())
    }

    pub fn summary(&self) -> String {
        match self {
            Fingerprint::Dependency { message } => message.clone(),
            Fingerprint::Exception { class, message } => {
                let short = class.rsplit('.').next().unwrap_or(class);
                if message.is_empty() { short.to_string() } else { format!("{short}: {message}") }
            }
            Fingerprint::Hang => "Oyun yüklenirken takıldı".into(),
            Fingerprint::Unknown => "Bilinmeyen çökme".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixin_crash_vs_missing_class() {
        let a = from_text(
            "---- Minecraft Crash Report ----\nDescription: Initializing game\n\njava.lang.RuntimeException: Mixin transformation failed\nCaused by: org.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered\n",
            false,
        );
        assert!(matches!(&a, Fingerprint::Exception { class, .. } if class.ends_with("MixinTransformerError")));
        let b = from_text("java.lang.NoClassDefFoundError: me/shedaniel/clothconfig2/api/ConfigBuilder\n\tat foo.Bar.init(Bar.java:12)\n", false);
        assert!(!b.same_as(&a), "gizli bağımlılıktan doğan çökme asıl hatayla karıştırılmamalı");
        assert_eq!(Fingerprint::missing_class("java.lang.NoClassDefFoundError: me/shedaniel/clothconfig2/api/ConfigBuilder").unwrap(), "me/shedaniel/clothconfig2/api/ConfigBuilder");
    }

    #[test]
    fn same_crash_with_different_numbers() {
        let a = from_text("java.lang.IllegalStateException: Duplicate id 1234 at 0x7fa1", false);
        let b = from_text("java.lang.IllegalStateException: Duplicate id 98 at 0x11", false);
        assert!(b.same_as(&a));
    }

    #[test]
    fn dependency_errors() {
        let f = from_text("net.fabricmc.loader.impl.FormattedException: Incompatible mods found!\n - Mod 'Sodium Extra' (sodium-extra) requires any version of sodium, which is missing!", false);
        assert!(matches!(f, Fingerprint::Dependency { .. }));
        let e = from_text("java.lang.NullPointerException: Cannot invoke \"x\"", false);
        assert!(!f.same_as(&e));
    }

    #[test]
    fn unknown_and_hang() {
        assert_eq!(from_text("", true), Fingerprint::Hang);
        assert_eq!(from_text("nothing useful", false), Fingerprint::Unknown);
        assert!(Fingerprint::Unknown.same_as(&Fingerprint::Hang));
    }
}
