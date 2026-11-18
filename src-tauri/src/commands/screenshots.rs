use crate::error::{AppError, Result};
use crate::screenshots::{self, guard, make_thumb, Screenshot};
use crate::state::AppState;
use base64::Engine;
use serde::Serialize;
use tauri::ipc::Response;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub const EV_THUMB: &str = "screenshot-thumb";
pub const EV_TAKEN: &str = "screenshot-taken";

#[tauri::command]
pub fn list_screenshots(state: State<'_, AppState>, instance_id: Option<String>) -> Result<Vec<Screenshot>> {
    screenshots::list(&state.paths, instance_id.as_deref())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbReady {
    path: String,
    thumb: Option<String>,
}

/// Eksik küçük resimleri tek bir arka plan iş parçacığında sırayla üretir
/// (CPU'yu boğmamak için paralel değil); her biri hazır oldukça olay gönderir.
#[tauri::command]
pub fn generate_thumbs(app: AppHandle, paths: Vec<String>) {
    std::thread::spawn(move || {
        let st = app.state::<AppState>();
        for p in paths {
            let thumb = guard(&st.paths, &p).and_then(|f| make_thumb(&st.paths, &f)).ok().map(|t| t.display().to_string());
            let _ = app.emit(EV_THUMB, ThumbReady { path: p, thumb });
        }
    });
}

/// Orijinal görüntü baytları (düzenleyici için). İkili yanıt: base64 yükü yok,
/// ve blob: URL olarak açıldığı için tuval "kirlenmez".
#[tauri::command]
pub fn read_screenshot(state: State<'_, AppState>, path: String) -> Result<Response> {
    let p = guard(&state.paths, &path)?;
    Ok(Response::new(std::fs::read(p)?))
}

#[tauri::command]
pub fn copy_screenshot(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<()> {
    let p = guard(&state.paths, &path)?;
    let img = tauri::image::Image::from_path(&p).map_err(|e| AppError::msg(crate::i18n::tf("görüntü okunamadı: {0}", &[&e])))?;
    app.clipboard().write_image(&img).map_err(|e| AppError::msg(crate::i18n::tf("panoya kopyalanamadı: {0}", &[&e])))
}

/// Düzenleyicinin ürettiği PNG'yi (base64) doğrudan panoya koyar.
#[tauri::command]
pub fn copy_png_bytes(app: AppHandle, png_base64: String) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| AppError::msg(e.to_string()))?;
    let img = tauri::image::Image::from_bytes(&bytes).map_err(|e| AppError::msg(e.to_string()))?;
    app.clipboard().write_image(&img).map_err(|e| AppError::msg(crate::i18n::tf("panoya kopyalanamadı: {0}", &[&e])))
}

#[tauri::command]
pub fn export_screenshot(state: State<'_, AppState>, path: String, dest: String) -> Result<()> {
    let p = guard(&state.paths, &path)?;
    std::fs::copy(p, dest)?;
    Ok(())
}

/// Silme işletim sisteminin çöp kutusuna gider; yanlışlıkla silinen geri alınabilir.
#[tauri::command]
pub fn delete_screenshot(state: State<'_, AppState>, path: String) -> Result<()> {
    let p = guard(&state.paths, &path)?;
    trash::delete(&p).or_else(|_| std::fs::remove_file(&p)).map_err(|e| AppError::msg(format!("silinemedi: {e}")))
}

#[tauri::command]
pub fn save_screenshot_edit(state: State<'_, AppState>, source: String, png_base64: String) -> Result<Screenshot> {
    let p = guard(&state.paths, &source)?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| AppError::msg(e.to_string()))?;
    let out = screenshots::save_edit(&p, &bytes)?;
    let out_s = out.display().to_string();
    screenshots::list(&state.paths, None)?
        .into_iter()
        .find(|s| std::fs::canonicalize(&s.path).ok().as_deref() == Some(out.as_path()) || s.path == out_s)
        .ok_or_else(|| AppError::msg(crate::i18n::t("kaydedilen dosya bulunamadı")))
}

#[tauri::command]
pub fn screenshots_folder(state: State<'_, AppState>, instance_id: String) -> String {
    let dir = state.paths.instance_game_dir(&instance_id).join("screenshots");
    let _ = std::fs::create_dir_all(&dir);
    dir.display().to_string()
}

/// Düzenleyiciden gelen PNG'yi kullanıcının seçtiği yere yazar (dışa aktar).
#[tauri::command]
pub fn export_png(dest: String, png_base64: String) -> Result<()> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| AppError::msg(e.to_string()))?;
    if bytes.len() < 8 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" {
        return Err(AppError::msg(crate::i18n::t("geçersiz PNG")));
    }
    std::fs::write(dest, bytes)?;
    Ok(())
}
