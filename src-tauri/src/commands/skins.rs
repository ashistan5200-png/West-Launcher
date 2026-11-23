use crate::error::Result;
use crate::skins::{fetch_player_skin, Library, SkinWithData};
use crate::state::AppState;
use tauri::State;

fn lib(state: &AppState) -> Library {
    Library::new(&state.paths.root)
}

#[tauri::command]
pub fn list_skins(state: State<'_, AppState>) -> Vec<SkinWithData> {
    let l = lib(&state);
    l.list().into_iter().filter_map(|e| l.with_data(e)).collect()
}

/// Bilgisayardan seçilen .png (yol, dosya diyaloğundan gelir).
#[tauri::command]
pub fn import_skin_file(state: State<'_, AppState>, path: String) -> Result<SkinWithData> {
    let p = std::path::Path::new(&path);
    let bytes = std::fs::read(p)?;
    let name = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Skin".into());
    let l = lib(&state);
    let e = l.add(&bytes, &name, false, "file")?;
    Ok(l.with_data(e).expect("az önce yazıldı"))
}

/// Herhangi bir oyuncunun güncel skinini arşive ekler.
#[tauri::command]
pub async fn import_skin_player(state: State<'_, AppState>, name: String) -> Result<SkinWithData> {
    let (png, slim) = fetch_player_skin(&state.http, name.trim()).await?;
    let l = lib(&state);
    let e = l.add(&png, name.trim(), slim, &format!("player:{}", name.trim()))?;
    Ok(l.with_data(e).expect("az önce yazıldı"))
}

#[tauri::command]
pub fn update_skin(state: State<'_, AppState>, id: String, name: Option<String>, slim: Option<bool>, favorite: Option<bool>) -> Result<SkinWithData> {
    let l = lib(&state);
    let e = l.update(&id, name, slim, favorite, false)?;
    Ok(l.with_data(e).expect("kayıt var"))
}

#[tauri::command]
pub fn delete_skin(state: State<'_, AppState>, id: String) -> Result<()> {
    lib(&state).remove(&id)
}

/// Skin editöründe çizilen skin (base64 PNG). `name` boşsa "Benim skinim".
#[tauri::command]
pub fn save_skin_png(state: State<'_, AppState>, png_base64: String, name: String, slim: bool) -> Result<SkinWithData> {
    use base64::Engine;
    let raw = png_base64.split_once(',').map(|(_, b)| b).unwrap_or(&png_base64);
    let bytes = base64::engine::general_purpose::STANDARD.decode(raw.trim()).map_err(|e| crate::error::AppError::Msg(e.to_string()))?;
    let l = lib(&state);
    let n = if name.trim().is_empty() { "Benim skinim".to_string() } else { name.trim().to_string() };
    let e = l.add(&bytes, &n, slim, "editor")?;
    let e = l.update(&e.id, Some(n), Some(slim), None, false)?;
    Ok(l.with_data(e).expect("az önce yazıldı"))
}
