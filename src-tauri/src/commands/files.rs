//! Dosya araçları: klasörü/dosyayı işletim sisteminde açma, instance içindeki metin
//! dosyalarını (options.txt, config…) uygulama içinde düzenleme ve görsel kırpma için
//! görsel okuma / geçici kaydetme.

use crate::content::safe_rel;
use crate::error::{AppError, Result};
use crate::state::AppState;
use base64::Engine;
use std::path::{Path, PathBuf};
use tauri::State;

/// Varsayılan uygulamayla açılmasında sakınca olmayan dosya türleri. Diğerleri
/// (ör. .exe, .jar, .bat) asla çalıştırılmaz; yalnızca klasörde gösterilir.
const SAFE_OPEN: &[&str] = &["txt", "log", "json", "json5", "toml", "cfg", "conf", "properties", "ini", "md", "yml", "yaml", "snbt", "png", "jpg", "jpeg", "webp", "gif"];

fn ext(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Klasörü açar ya da dosyayı varsayılan uygulamasıyla açar. `reveal` → dosyayı klasöründe seçili gösterir.
#[tauri::command]
pub fn open_path(state: State<'_, AppState>, path: String, reveal: bool) -> Result<()> {
    if path.contains("://") {
        return Err(AppError::msg("Geçersiz yol"));
    }
    let p = PathBuf::from(&path);
    // Launcher'ın kendi klasörlerinden henüz oluşmamış olanı (ör. ilk açılıştan önce saves) oluştur
    if !p.exists() && p.extension().is_none() && p.starts_with(&state.paths.root) {
        let _ = std::fs::create_dir_all(&p);
    }
    if !p.exists() {
        return Err(AppError::msg("Bu klasör ya da dosya henüz yok"));
    }
    let is_dir = p.is_dir();
    let open_directly = is_dir || (!reveal && SAFE_OPEN.contains(&ext(&p).as_str()));
    os_open(&p, !open_directly).map_err(|e| AppError::msg(format!("Açılamadı: {e}")))
}

#[cfg(windows)]
fn os_open(p: &Path, select: bool) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("explorer");
    if select {
        // explorer, /select argümanını yalnızca bu biçimde (tırnaklar virgülden sonra) anlar
        cmd.raw_arg(format!("/select,\"{}\"", p.display()));
    } else {
        cmd.arg(p);
    }
    // explorer başarıda bile 1 döndürebildiği için çıkış kodu beklenmez
    cmd.spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn os_open(p: &Path, select: bool) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new("open");
    if select {
        cmd.arg("-R");
    }
    cmd.arg(p).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn os_open(p: &Path, select: bool) -> std::io::Result<()> {
    let target = if select { p.parent().unwrap_or(p) } else { p };
    std::process::Command::new("xdg-open").arg(target).spawn().map(|_| ())
}

// ───────── Instance içi metin dosyaları ─────────

const TEXT_MAX: u64 = 2 * 1024 * 1024;

fn instance_file(state: &AppState, instance_id: &str, rel: &str) -> Result<PathBuf> {
    let r = safe_rel(rel).ok_or_else(|| AppError::msg("Geçersiz yol"))?;
    Ok(state.paths.instance_game_dir(instance_id).join(r))
}

/// Uygulama içi düzenleyici için metin dosyasını okur.
#[tauri::command]
pub fn read_instance_text(state: State<'_, AppState>, instance_id: String, path: String) -> Result<String> {
    let p = instance_file(&state, &instance_id, &path)?;
    let md = std::fs::metadata(&p).map_err(|_| AppError::msg("Dosya bulunamadı"))?;
    if md.len() > TEXT_MAX {
        return Err(AppError::msg("Dosya düzenlemek için çok büyük (en fazla 2 MB)"));
    }
    let bytes = std::fs::read(&p)?;
    if bytes.contains(&0) {
        return Err(AppError::msg("Bu dosya metin değil; uygulama içinde düzenlenemez"));
    }
    String::from_utf8(bytes).map_err(|_| AppError::msg("Dosya UTF-8 metin değil; uygulama içinde düzenlenemez"))
}

#[tauri::command]
pub fn write_instance_text(state: State<'_, AppState>, instance_id: String, path: String, content: String) -> Result<()> {
    let p = instance_file(&state, &instance_id, &path)?;
    if !p.is_file() {
        return Err(AppError::msg("Dosya bulunamadı"));
    }
    if content.len() as u64 > TEXT_MAX {
        return Err(AppError::msg("Dosya çok büyük"));
    }
    let tmp = p.with_extension("west-tmp");
    std::fs::write(&tmp, content.as_bytes())?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

// ───────── Görsel kırpma ─────────

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];

/// Seçilen görseli kırpma penceresinde göstermek için data URL olarak okur
/// (webview, uygulama klasörü dışındaki dosyalara doğrudan erişemez).
#[tauri::command]
pub fn read_image_data(path: String) -> Result<String> {
    let p = PathBuf::from(&path);
    let e = ext(&p);
    if !IMAGE_EXTS.contains(&e.as_str()) {
        return Err(AppError::msg("Yalnızca PNG, JPG, WEBP veya GIF seçilebilir"));
    }
    let md = std::fs::metadata(&p).map_err(|_| AppError::msg("Görsel bulunamadı"))?;
    if md.len() > 25 * 1024 * 1024 {
        return Err(AppError::msg("Görsel en fazla 25 MB olabilir"));
    }
    let mime = if e == "jpg" || e == "jpeg" { "image/jpeg".to_string() } else { format!("image/{e}") };
    Ok(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(std::fs::read(&p)?)))
}

/// Kırpılmış görseli geçici bir dosyaya yazar ve yolunu döndürür; yükleme komutları bu yolu kullanır.
#[tauri::command]
pub fn save_temp_image(state: State<'_, AppState>, data: String, ext: String) -> Result<String> {
    let e = ext.to_lowercase();
    if !["png", "jpg", "jpeg", "webp"].contains(&e.as_str()) {
        return Err(AppError::msg("Geçersiz görsel türü"));
    }
    let b64 = data.split_once(',').map(|x| x.1).unwrap_or(&data);
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| AppError::msg("Görsel verisi bozuk"))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::msg("Görsel en fazla 8 MB olabilir"));
    }
    let dir = state.paths.root.join("cache").join("crops");
    std::fs::create_dir_all(&dir)?;
    // Bir saatten eski kırpıntıları temizle
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for f in rd.flatten() {
            let old = f.metadata().and_then(|m| m.modified()).map(|t| t.elapsed().map(|d| d.as_secs() > 3600).unwrap_or(false)).unwrap_or(false);
            if old {
                let _ = std::fs::remove_file(f.path());
            }
        }
    }
    let p = dir.join(format!("{}.{e}", uuid::Uuid::new_v4()));
    std::fs::write(&p, bytes)?;
    Ok(p.display().to_string())
}
