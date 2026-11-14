use crate::error::Result;
use crate::news::{self, AssetDiff, ModUpdate, PatchNote};
use crate::state::AppState;
use tauri::ipc::Response;
use tauri::State;

#[tauri::command]
pub async fn news_patch_notes(state: State<'_, AppState>) -> Result<Vec<PatchNote>> {
    news::patch_notes(&state.http, &state.paths, 60).await
}

#[tauri::command]
pub async fn news_patch_body(state: State<'_, AppState>, content_path: String) -> Result<String> {
    news::patch_note_body(&state.http, &content_path).await
}

#[tauri::command]
pub async fn news_mod_updates(state: State<'_, AppState>) -> Result<Vec<ModUpdate>> {
    news::mod_updates(&state.http, 40).await
}

#[tauri::command]
pub async fn news_asset_diff(state: State<'_, AppState>, version: String, base: Option<String>) -> Result<AssetDiff> {
    news::diff_assets(&state.http, &state.paths, &version, base).await
}

/// Doku PNG'si — ikili yanıt (önizleme ve indirme için)
#[tauri::command]
pub fn news_texture(state: State<'_, AppState>, version: String, path: String) -> Result<Response> {
    Ok(Response::new(news::read_texture(&state.paths, &version, &path)?))
}

/// Ses .ogg — ikili yanıt
#[tauri::command]
pub async fn news_sound(state: State<'_, AppState>, hash: String) -> Result<Response> {
    Ok(Response::new(news::read_sound(&state.http, &state.paths, &hash).await?))
}

/// Seçilen dosyayı kullanıcının belirlediği yere kaydeder.
#[tauri::command]
pub async fn news_export(state: State<'_, AppState>, dest: String, version: Option<String>, path: Option<String>, hash: Option<String>) -> Result<()> {
    let bytes = match (hash, version, path) {
        (Some(h), _, _) => news::read_sound(&state.http, &state.paths, &h).await?,
        (None, Some(v), Some(p)) => news::read_texture(&state.paths, &v, &p)?,
        _ => return Err(crate::error::AppError::msg("dışa aktarılacak dosya belirtilmedi")),
    };
    std::fs::write(dest, bytes)?;
    Ok(())
}
