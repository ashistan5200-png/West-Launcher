use crate::error::Result;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::Path;

/// Yarıda kesilmiş yazmalara karşı geçici dosya + rename ile atomik JSON yazımı.
pub fn write_json_atomic<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(value)?).map_err(|e| crate::error::AppError::at(&tmp, e))?;
    retry(|| std::fs::rename(&tmp, path)).map_err(|e| crate::error::AppError::at(path, e))?;
    Ok(())
}

/// Windows'ta antivirüs ya da kapanmakta olan bir işlem dosyayı kısa süre kilitleyebilir:
/// "Erişim engellendi" alınırsa birkaç kez kısa aralıklarla yeniden dene.
pub fn retry<T>(mut f: impl FnMut() -> std::io::Result<T>) -> std::io::Result<T> {
    let mut wait = 60;
    for _ in 0..6 {
        match f() {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                std::thread::sleep(std::time::Duration::from_millis(wait));
                wait = (wait * 2).min(800);
            }
            r => return r,
        }
    }
    f()
}

pub fn sha1_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// Klasörü kopyalar; `skip` göreli yolun ilk bileşenine göre filtreler
/// (örn. "saves", "logs").
pub fn copy_dir_filtered(src: &Path, dst: &Path, skip: &[&str]) -> Result<u64> {
    let mut copied = 0u64;
    for entry in walkdir::WalkDir::new(src).min_depth(1) {
        let entry = entry.map_err(|e| crate::error::AppError::msg(e.to_string()))?;
        let rel = entry.path().strip_prefix(src).unwrap();
        let first = rel
            .components()
            .next()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .unwrap_or_default();
        if skip.iter().any(|s| *s == first) {
            continue;
        }
        let target = dst.join(rel);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(p) = target.parent() {
                std::fs::create_dir_all(p)?;
            }
            copied += std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(copied)
}

/// İnsan okunur, dosya sistemi güvenli kimlik üretir.
pub fn slugify(name: &str) -> String {
    let mut s: String = name
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'ç' => 'c', 'ğ' => 'g', 'ı' => 'i', 'ö' => 'o', 'ş' => 's', 'ü' => 'u',
            c if c.is_ascii_alphanumeric() => c,
            _ => '-',
        })
        .collect();
    while s.contains("--") {
        s = s.replace("--", "-");
    }
    let s = s.trim_matches('-').to_string();
    if s.is_empty() { "instance".into() } else { s }
}

pub fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

/// Mojang kural motorunun kullandığı mimari adı.
pub fn os_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86"
    }
}

pub fn classpath_separator() -> &'static str {
    if cfg!(windows) { ";" } else { ":" }
}
