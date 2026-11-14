//! Ekran görüntüsü galerisi: tüm instance'ların `screenshots/` klasörlerini
//! tarar, küçük resimleri (JPEG, 480 px) önbelleğe alır ve düzenlenmiş
//! kopyaları kaydeder. Orijinal dosyalar asla üzerine yazılmaz.

use crate::error::{AppError, Result};
use crate::instance::InstanceManager;
use crate::paths::Paths;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};

const THUMB_W: u32 = 480;
const THUMB_H: u32 = 270;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub path: String,
    pub file: String,
    pub instance_id: String,
    pub instance_name: String,
    pub size: u64,
    pub modified: DateTime<Utc>,
    /// Hazırsa önbellekteki küçük resmin yolu
    pub thumb: Option<String>,
    /// West düzenleyicisiyle üretilmiş kopya mı
    pub edited: bool,
}

fn is_image(p: &Path) -> bool {
    matches!(p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref(), Some("png" | "jpg" | "jpeg"))
}

pub fn thumb_path(paths: &Paths, file: &Path, size: u64, modified: i64) -> PathBuf {
    let key = hex::encode(Sha1::digest(format!("{}|{size}|{modified}", file.display()).as_bytes()));
    paths.cache().join("thumbs").join(format!("{}.jpg", &key[..20]))
}

pub fn list(paths: &Paths, only: Option<&str>) -> Result<Vec<Screenshot>> {
    let mut out = Vec::new();
    for inst in InstanceManager::new(paths).list()? {
        if only.is_some_and(|id| id != inst.id) {
            continue;
        }
        let dir = paths.instance_game_dir(&inst.id).join("screenshots");
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_file() || !is_image(&p) {
                continue;
            }
            let Ok(meta) = e.metadata() else { continue };
            let modified: DateTime<Utc> = meta.modified().map(DateTime::<Utc>::from).unwrap_or_else(|_| Utc::now());
            let tp = thumb_path(paths, &p, meta.len(), modified.timestamp());
            let file = e.file_name().to_string_lossy().into_owned();
            out.push(Screenshot {
                edited: file.contains("_west-edit"),
                thumb: tp.exists().then(|| tp.display().to_string()),
                path: p.display().to_string(),
                file,
                instance_id: inst.id.clone(),
                instance_name: inst.name.clone(),
                size: meta.len(),
                modified,
            });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// Yolun gerçekten bir instance'ın screenshots klasöründe olduğunu doğrular
/// (UI'dan gelen yollarla rastgele dosya silinmesini/okunmasını engeller).
pub fn guard(paths: &Paths, path: &str) -> Result<PathBuf> {
    let p = std::fs::canonicalize(path).map_err(|_| AppError::NotFound("ekran görüntüsü".into()))?;
    let root = std::fs::canonicalize(paths.instances()).unwrap_or_else(|_| paths.instances());
    let ok = p.starts_with(&root) && p.parent().and_then(|d| d.file_name()).map(|n| n == "screenshots").unwrap_or(false) && is_image(&p);
    if !ok {
        return Err(AppError::msg("Bu dosya bir ekran görüntüsü klasöründe değil"));
    }
    Ok(p)
}

/// Küçük resim üretir (en-boy oranı korunur). Zaten varsa dokunmaz.
pub fn make_thumb(paths: &Paths, file: &Path) -> Result<PathBuf> {
    let meta = std::fs::metadata(file)?;
    let modified: DateTime<Utc> = meta.modified().map(DateTime::<Utc>::from).unwrap_or_else(|_| Utc::now());
    let out = thumb_path(paths, file, meta.len(), modified.timestamp());
    if out.exists() {
        return Ok(out);
    }
    let img = image::open(file).map_err(|e| AppError::msg(format!("görüntü açılamadı: {e}")))?;
    let thumb = img.thumbnail(THUMB_W, THUMB_H).to_rgb8();
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut buf = std::io::BufWriter::new(std::fs::File::create(&out)?);
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 82)
        .encode_image(&thumb)
        .map_err(|e| AppError::msg(e.to_string()))?;
    Ok(out)
}

/// Düzenlenmiş görüntüyü orijinalin yanına `<ad>_west-edit[N].png` olarak yazar.
pub fn save_edit(original: &Path, png: &[u8]) -> Result<PathBuf> {
    if png.len() < 8 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(AppError::msg("Düzenleyiciden geçerli bir PNG gelmedi"));
    }
    let dir = original.parent().ok_or_else(|| AppError::msg("klasör yok"))?;
    let stem = original.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "screenshot".into());
    let stem = stem.split("_west-edit").next().unwrap_or(&stem).to_string();
    let mut n = 1;
    let target = loop {
        let name = if n == 1 { format!("{stem}_west-edit.png") } else { format!("{stem}_west-edit{n}.png") };
        let t = dir.join(name);
        if !t.exists() {
            break t;
        }
        n += 1;
    };
    std::fs::write(&target, png)?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edit_names_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("shots-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let orig = dir.join("2026-11-14_12.00.00.png");
        std::fs::write(&orig, b"x").unwrap();
        let png = b"\x89PNG\r\n\x1a\nrest";
        let a = save_edit(&orig, png).unwrap();
        let b = save_edit(&a, png).unwrap();
        assert!(a.ends_with("2026-11-14_12.00.00_west-edit.png"));
        assert!(b.ends_with("2026-11-14_12.00.00_west-edit2.png"));
        assert_eq!(std::fs::read(&orig).unwrap(), b"x");
        assert!(save_edit(&orig, b"nope").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
