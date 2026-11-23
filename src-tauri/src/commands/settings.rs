use crate::error::Result;
use crate::java::jvm::{hardware, Hardware};
use crate::settings::Settings;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    settings.save(&state.paths.settings_file())?;
    crate::i18n::set_lang(&settings.language);
    state.discord.send(crate::discord::Presence::Configure { client_id: settings.discord_client_id.clone(), enabled: settings.discord_rpc });
    *state.settings.write() = settings;
    Ok(())
}

#[tauri::command]
pub fn get_hardware() -> Hardware {
    hardware()
}

#[tauri::command]
pub fn get_data_dir(state: State<'_, AppState>) -> String {
    state.paths.root.display().to_string()
}

/// İndirme önbelleğinin boyutu (bayt)
#[tauri::command]
pub async fn cache_size(state: State<'_, AppState>) -> Result<u64> {
    let dir = state.paths.cache();
    Ok(tokio::task::spawn_blocking(move || {
        walkdir::WalkDir::new(dir).into_iter().flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
    })
    .await
    .unwrap_or(0))
}

/// İndirme önbelleğini temizler (sürüm listeleri, geçici indirmeler); oyun dosyaları ve instance'lar etkilenmez
#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Result<()> {
    let dir = state.paths.cache();
    tokio::task::spawn_blocking(move || {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            }
        }
    })
    .await
    .map_err(|e| crate::error::AppError::msg(e.to_string()))?;
    Ok(())
}

/// Ayarları varsayılana döndürür (dil ve ilk açılış durumu korunur)
#[tauri::command]
pub fn reset_settings(state: State<'_, AppState>) -> Result<Settings> {
    let old = state.settings.read().clone();
    let s = Settings { language: old.language, onboarding_done: old.onboarding_done, ..Settings::default() };
    s.save(&state.paths.settings_file())?;
    *state.settings.write() = s.clone();
    Ok(s)
}
