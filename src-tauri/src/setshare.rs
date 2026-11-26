//! Mod setlerini kodla paylaşma. Sunucu gerekmez: setin içeriği (Modrinth proje kimlikleri, Minecraft
//! sürümü, yükleyici) sıkıştırılıp "WEST-SET:…" metnine çevrilir. Kodu alan, eksik modları Modrinth'ten
//! (bağımlılıklarıyla) kurar ve aynı adla yeni bir set elde eder.
//!
//! Modrinth'te karşılığı olmayan (elle eklenmiş) dosyalar koda giremez; sayıları bildirilir.

use crate::content::manage::ContentFile;
use crate::error::{AppError, Result};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

pub const PREFIX: &str = "WEST-SET:";
const MAX_CODE: usize = 16 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SharedSet {
    /// Biçim sürümü
    pub v: u8,
    /// Set adı
    pub n: String,
    /// Minecraft sürümü ve yükleyici (uyarı için; kurulum alanın kendi sürümüne uygun dosyayı seçer)
    pub mc: String,
    pub l: String,
    /// Açık modlar, kaynak paketleri, shader'lar (Modrinth proje kimlikleri)
    pub m: Vec<String>,
    #[serde(default)]
    pub r: Vec<String>,
    #[serde(default)]
    pub s: Vec<String>,
}

/// Setteki açık içeriklerden paylaşılabilir kod üret. (kod, Modrinth'te bulunmadığı için atlanan sayısı)
pub fn encode(name: &str, mc: &str, loader: &str, enabled: &[String], files: &[ContentFile]) -> Result<(String, usize)> {
    let (mut m, mut r, mut s, mut skipped) = (vec![], vec![], vec![], 0);
    for id in enabled {
        if id.starts_with("mods/west-companion") {
            continue;
        }
        let Some(pid) = files.iter().find(|f| &f.id == id).and_then(|f| f.project_id.clone()).filter(|p| !p.is_empty()) else {
            skipped += 1;
            continue;
        };
        let list = if id.starts_with("mods/") { &mut m } else if id.starts_with("resourcepacks/") { &mut r } else { &mut s };
        if !list.contains(&pid) {
            list.push(pid);
        }
    }
    if m.is_empty() && r.is_empty() && s.is_empty() {
        return Err(AppError::msg(crate::i18n::t("Bu sette Modrinth'te bulunan içerik yok; paylaşılacak bir şey kalmadı.")));
    }
    let set = SharedSet { v: 1, n: name.chars().take(32).collect(), mc: mc.into(), l: loader.into(), m, r, s };
    Ok((pack(&set)?, skipped))
}

/// Seti "WEST-SET:…" koduna çevirir
pub fn pack(set: &SharedSet) -> Result<String> {
    let json = serde_json::to_vec(set)?;
    let mut z = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    z.write_all(&json)?;
    Ok(format!("{PREFIX}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(z.finish()?)))
}

pub fn decode(code: &str) -> Result<SharedSet> {
    let bad = || AppError::msg(crate::i18n::t("Bu bir West set kodu değil ya da eksik kopyalanmış."));
    let code: String = code.trim().chars().filter(|c| !c.is_whitespace()).collect();
    if code.len() > MAX_CODE {
        return Err(bad());
    }
    let body = code.strip_prefix(PREFIX).ok_or_else(bad)?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body).map_err(|_| bad())?;
    let mut json = Vec::new();
    flate2::read::DeflateDecoder::new(&raw[..]).take(256 * 1024).read_to_end(&mut json).map_err(|_| bad())?;
    let set: SharedSet = serde_json::from_slice(&json).map_err(|_| bad())?;
    let valid = |ids: &[String]| ids.iter().all(|i| !i.is_empty() && i.len() <= 64 && i.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    if set.v != 1 || !valid(&set.m) || !valid(&set.r) || !valid(&set.s) || set.m.len() + set.r.len() + set.s.len() > 400 {
        return Err(bad());
    }
    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(id: &str, pid: Option<&str>) -> ContentFile {
        serde_json::from_value(serde_json::json!({
            "id": id, "file": id.rsplit('/').next().unwrap(), "kind": "mod", "enabled": true, "size": 1, "sha1": "x", "title": id,
            "version": null, "author": null, "authorAvatar": null, "icon": null, "projectId": pid, "source": null, "url": null,
            "update": null, "dependencyOf": null, "managed": false
        }))
        .unwrap()
    }

    #[test]
    fn roundtrip_and_rejects_garbage() {
        let files = vec![file("mods/sodium.jar", Some("AANobbMI")), file("mods/local.jar", None), file("resourcepacks/f.zip", Some("abc123"))];
        let enabled: Vec<String> = ["mods/sodium.jar", "mods/local.jar", "resourcepacks/f.zip", "mods/west-companion.jar"].iter().map(|s| s.to_string()).collect();
        let (code, skipped) = encode("PvP", "26.2", "fabric", &enabled, &files).unwrap();
        assert!(code.starts_with(PREFIX));
        assert_eq!(skipped, 1);
        let s = decode(&format!("  {code}\n")).unwrap();
        assert_eq!((s.n.as_str(), s.m.clone(), s.r.clone()), ("PvP", vec!["AANobbMI".to_string()], vec!["abc123".to_string()]));
        assert!(decode("WEST-SET:!!!").is_err());
        assert!(decode("merhaba").is_err());
    }
}
