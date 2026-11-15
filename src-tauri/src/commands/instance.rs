use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, NewInstance};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_instances(state: State<'_, AppState>) -> Result<Vec<Instance>> {
    InstanceManager::new(&state.paths).list()
}

#[tauri::command]
pub fn get_instance(state: State<'_, AppState>, id: String) -> Result<Instance> {
    InstanceManager::new(&state.paths).get(&id)
}

#[tauri::command]
pub fn create_instance(state: State<'_, AppState>, req: NewInstance) -> Result<Instance> {
    InstanceManager::new(&state.paths).create(req)
}

#[tauri::command]
pub fn update_instance(state: State<'_, AppState>, instance: Instance) -> Result<Instance> {
    let mgr = InstanceManager::new(&state.paths);
    let current = mgr.get(&instance.id)?;
    // MC sürümü veya loader değişirse yeniden kurulum gerekir.
    let mut next = instance;
    if current.mc_version != next.mc_version
        || current.loader.kind != next.loader.kind
        || current.loader.version != next.loader.version
    {
        next.version_id = None;
    }
    mgr.save(&next)?;
    Ok(next)
}

#[tauri::command]
pub fn clone_instance(state: State<'_, AppState>, id: String, name: String, include_worlds: bool) -> Result<Instance> {
    InstanceManager::new(&state.paths).clone_instance(&id, &name, include_worlds)
}

#[tauri::command]
pub fn make_template(state: State<'_, AppState>, id: String, name: String) -> Result<Instance> {
    InstanceManager::new(&state.paths).make_template(&id, &name)
}

#[tauri::command]
pub fn create_from_template(state: State<'_, AppState>, template_id: String, name: String) -> Result<Instance> {
    InstanceManager::new(&state.paths).from_template(&template_id, &name)
}

#[tauri::command]
pub fn delete_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg("Çalışan bir instance silinemez"));
    }
    InstanceManager::new(&state.paths).delete(&id)
}

#[tauri::command]
pub fn instance_path(state: State<'_, AppState>, id: String) -> String {
    state.paths.instance_game_dir(&id).display().to_string()
}

/// Instance simgesi veya banner'ı: seçilen görsel instance klasörüne kopyalanır.
/// `path = None` → kaldır (prosedürel görünüme dön).
#[tauri::command]
pub fn set_instance_image(state: State<'_, AppState>, id: String, kind: String, path: Option<String>) -> Result<Instance> {
    let mgr = InstanceManager::new(&state.paths);
    let mut inst = mgr.get(&id)?;
    let dir = state.paths.instance_dir(&id);
    let prefix = match kind.as_str() {
        "icon" => "icon",
        "banner" => "banner",
        _ => return Err(AppError::msg("Geçersiz görsel türü")),
    };
    // Eski kopyaları temizle
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with(&format!("{prefix}-")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let stored = match path {
        None => None,
        Some(p) => {
            let src = std::path::PathBuf::from(&p);
            let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !["png", "jpg", "jpeg", "webp", "gif"].contains(&ext.as_str()) {
                return Err(AppError::msg("Yalnızca PNG, JPG, WEBP veya GIF görseller kullanılabilir"));
            }
            if std::fs::metadata(&src)?.len() > 12 * 1024 * 1024 {
                return Err(AppError::msg("Görsel en fazla 12 MB olabilir"));
            }
            // Dosya adına zaman damgası: arayüz önbelleği eski görseli göstermesin
            let dest = dir.join(format!("{prefix}-{}.{ext}", chrono::Utc::now().timestamp_millis()));
            std::fs::copy(&src, &dest)?;
            Some(dest.display().to_string())
        }
    };
    if prefix == "icon" {
        inst.icon = stored;
    } else {
        inst.banner = stored;
    }
    mgr.save(&inst)?;
    Ok(inst)
}

// ───────── Oyun modları (Build / PvP …) ─────────

use crate::instance::modes::{self, ApplyReport, GameMode, Modes};

fn not_running(state: &AppState, id: &str) -> Result<()> {
    if state.running.lock().contains_key(id) {
        return Err(AppError::msg("Oyun açıkken mod değiştirilemez; önce oyunu kapat."));
    }
    Ok(())
}

#[tauri::command]
pub fn list_modes(state: State<'_, AppState>, id: String) -> Modes {
    modes::load(&state.paths.instance_dir(&id))
}

/// Şu anki açık/kapalı içerikleri (ve isteğe bağlı options.txt'yi) yeni bir mod olarak kaydeder.
/// `mode_id` verilirse o modu günceller.
#[tauri::command]
pub fn save_mode(state: State<'_, AppState>, id: String, mode_id: Option<String>, name: String, icon: String, include_options: bool) -> Result<GameMode> {
    modes::capture(&state.paths.instance_dir(&id), &state.paths.instance_game_dir(&id), mode_id.as_deref(), &name, &icon, include_options)
}

#[tauri::command]
pub fn apply_mode(state: State<'_, AppState>, id: String, mode_id: String) -> Result<ApplyReport> {
    not_running(&state, &id)?;
    modes::apply(&state.paths.instance_dir(&id), &state.paths.instance_game_dir(&id), &mode_id)
}

#[tauri::command]
pub fn rename_mode(state: State<'_, AppState>, id: String, mode_id: String, name: String, icon: String) -> Result<()> {
    modes::rename(&state.paths.instance_dir(&id), &mode_id, &name, &icon)
}

#[tauri::command]
pub fn delete_mode(state: State<'_, AppState>, id: String, mode_id: String) -> Result<()> {
    modes::delete(&state.paths.instance_dir(&id), &mode_id)
}
