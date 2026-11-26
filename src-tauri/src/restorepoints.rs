//! Geri dönüş noktaları: oyun içi Mod Merkezi'nden (ya da launcher'dan) yapılan her değişiklik uygulanmadan
//! önce mods, resourcepacks ve shaderpacks klasörlerinin o anki hali kaydedilir. Dosyalar sabit bağlantı
//! (hard link) olarak saklanır; diskte yer kaplamaz ve asıl dosya silinse/güncellense de eski sürüm kalır.
//!
//! Geri dönerken hiçbir dosya silinmez: sonradan eklenenler yalnızca kapatılır (.disabled), eksik ya da
//! değişmiş olanlar kayıttan geri konur. West Companion'ın kendi jar'ı her zaman güncel kalır.

use crate::error::{AppError, Result};
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

const ROOT: &str = "restore-points";
const KEEP: usize = 6;
const DISABLED: &str = ".disabled";
const FOLDERS: [&str; 3] = ["mods", "resourcepacks", "shaderpacks"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// "mods/sodium.jar" (.disabled eki olmadan)
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePoint {
    pub id: String,
    pub at: i64,
    /// Bu noktadan sonra ne yapıldı (ör. "Sodium kapanacak, Iris eklendi")
    pub label: String,
    pub entries: Vec<Entry>,
}

fn root(instance_dir: &Path) -> PathBuf {
    instance_dir.join(ROOT)
}

/// West Companion launcher tarafından yönetilir; geri dönüşler ona dokunmaz
fn managed(id: &str) -> bool {
    id.starts_with("mods/west-companion")
}

fn content_files(game_dir: &Path) -> Vec<(String, bool, PathBuf)> {
    let mut out = vec![];
    for folder in FOLDERS {
        let Ok(rd) = std::fs::read_dir(game_dir.join(folder)) else { continue };
        for e in rd.flatten() {
            if !e.path().is_file() {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let (base, enabled) = match name.strip_suffix(DISABLED) {
                Some(b) => (b.to_string(), false),
                None => (name.clone(), true),
            };
            let low = base.to_ascii_lowercase();
            if !(low.ends_with(".jar") || low.ends_with(".zip")) {
                continue;
            }
            out.push((format!("{folder}/{base}"), enabled, e.path()));
        }
    }
    out.sort();
    out
}

fn link_or_copy(src: &Path, dest: &Path) -> std::io::Result<()> {
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    if std::fs::hard_link(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map(|_| ())
}

/// Saklanan dosyanın yolu (kimlikle aynı göreli yol, .disabled eki olmadan)
pub fn stored(instance_dir: &Path, point: &str, id: &str) -> PathBuf {
    root(instance_dir).join(point).join("files").join(id)
}

/// Şu anki durumu kaydet; en eski noktalar silinir
pub fn create(instance_dir: &Path, game_dir: &Path, label: &str) -> Result<RestorePoint> {
    let id = chrono::Utc::now().timestamp_millis().to_string();
    let mut entries = vec![];
    for (cid, enabled, path) in content_files(game_dir) {
        if managed(&cid) {
            continue;
        }
        link_or_copy(&path, &stored(instance_dir, &id, &cid))?;
        entries.push(Entry { id: cid, enabled });
    }
    let point = RestorePoint { id: id.clone(), at: chrono::Utc::now().timestamp(), label: label.chars().take(200).collect(), entries };
    write_json_atomic(&root(instance_dir).join(&id).join("point.json"), &point)?;
    let all = list(instance_dir);
    for old in all.iter().skip(KEEP) {
        let _ = std::fs::remove_dir_all(root(instance_dir).join(&old.id));
    }
    Ok(point)
}

/// Kayıtlı noktalar, yeniden eskiye
pub fn list(instance_dir: &Path) -> Vec<RestorePoint> {
    let mut out: Vec<RestorePoint> = std::fs::read_dir(root(instance_dir))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| std::fs::read(e.path().join("point.json")).ok())
                .filter_map(|b| serde_json::from_slice(&b).ok())
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    out
}

pub fn get(instance_dir: &Path, point: &str) -> Result<RestorePoint> {
    if point.is_empty() || point.contains(['/', '\\', '.']) {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let b = std::fs::read(root(instance_dir).join(point).join("point.json")).map_err(|_| AppError::msg(crate::i18n::t("Geri dönüş noktası bulunamadı")))?;
    Ok(serde_json::from_slice(&b)?)
}

/// Devralma için: bu noktada açık olan modlar (kaynak dosya, hedef ad)
pub fn enabled_mods(instance_dir: &Path, point: &RestorePoint) -> Vec<(PathBuf, String)> {
    point
        .entries
        .iter()
        .filter(|e| e.enabled && e.id.starts_with("mods/"))
        .map(|e| (stored(instance_dir, &point.id, &e.id), e.id.trim_start_matches("mods/").to_string()))
        .collect()
}

/// Klasörleri bu noktadaki hale getir (oyun kapalıyken). Hiçbir dosya silinmez.
pub fn restore(instance_dir: &Path, game_dir: &Path, point: &str) -> Result<()> {
    let p = get(instance_dir, point)?;
    let wanted: HashSet<&str> = p.entries.iter().map(|e| e.id.as_str()).collect();
    // Sonradan eklenenler: kapat
    for (cid, enabled, path) in content_files(game_dir) {
        if !managed(&cid) && enabled && !wanted.contains(cid.as_str()) {
            std::fs::rename(&path, game_dir.join(format!("{cid}{DISABLED}")))?;
        }
    }
    for e in &p.entries {
        let on = game_dir.join(&e.id);
        let off = game_dir.join(format!("{}{DISABLED}", e.id));
        let (want, other) = if e.enabled { (&on, &off) } else { (&off, &on) };
        let src = stored(instance_dir, &p.id, &e.id);
        let same = |a: &Path| match (std::fs::metadata(a), std::fs::metadata(&src)) {
            (Ok(x), Ok(y)) => x.len() == y.len(),
            _ => false,
        };
        if want.exists() && same(want) {
            if other.exists() && same(other) {
                std::fs::remove_file(other)?; // aynı dosyanın iki kopyası kalmasın
            }
            continue;
        }
        if other.exists() && same(other) {
            std::fs::rename(other, want)?;
            continue;
        }
        // Eksik ya da değişmiş: kayıttan geri koy (değişmiş olan .disabled olarak kalır)
        if want.exists() {
            // "mods/sodium.jar" → "mods/sodium.yeni.jar.disabled": kapalı bir mod olarak listelerde görünür
            let keep_id = match e.id.rsplit_once('.') {
                Some((stem, ext)) => format!("{stem}.yeni.{ext}"),
                None => format!("{}.yeni", e.id),
            };
            let keep = game_dir.join(format!("{keep_id}{DISABLED}"));
            std::fs::rename(want, keep)?;
        }
        if src.exists() {
            link_or_copy(&src, want)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_restore_without_deleting() {
        let tmp = std::env::temp_dir().join(format!("west-rp-{}", std::process::id()));
        let (dir, game) = (tmp.clone(), tmp.join("minecraft"));
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods/sodium.jar"), b"v1").unwrap();
        std::fs::write(game.join("mods/old.jar"), b"x").unwrap();
        std::fs::write(game.join("mods/west-companion.jar"), b"c1").unwrap();
        let p = create(&dir, &game, "önce").unwrap();
        assert_eq!(p.entries.len(), 2);

        // Sonra: old silindi, sodium güncellendi, yeni bir mod eklendi, companion güncellendi
        std::fs::remove_file(game.join("mods/old.jar")).unwrap();
        std::fs::remove_file(game.join("mods/sodium.jar")).unwrap();
        std::fs::write(game.join("mods/sodium.jar"), b"version2").unwrap();
        std::fs::write(game.join("mods/new.jar"), b"n").unwrap();
        std::fs::write(game.join("mods/west-companion.jar"), b"c2").unwrap();

        restore(&dir, &game, &p.id).unwrap();
        assert_eq!(std::fs::read(game.join("mods/old.jar")).unwrap(), b"x");
        assert_eq!(std::fs::read(game.join("mods/sodium.jar")).unwrap(), b"v1");
        assert!(game.join("mods/sodium.yeni.jar.disabled").exists(), "güncel sürüm silinmez, kapatılır");
        assert!(game.join("mods/new.jar.disabled").exists() && !game.join("mods/new.jar").exists());
        assert_eq!(std::fs::read(game.join("mods/west-companion.jar")).unwrap(), b"c2", "companion'a dokunulmaz");
        assert_eq!(list(&dir).len(), 1);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
