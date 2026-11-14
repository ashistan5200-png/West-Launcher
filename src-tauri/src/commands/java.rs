use super::progress_emitter;
use crate::error::Result;
use crate::instance::InstanceManager;
use crate::java::jvm::{hardware, optimize, recommend_memory, JvmProfile};
use crate::java::{detect, install, JavaInstall};
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn list_java(state: State<'_, AppState>) -> Result<Vec<JavaInstall>> {
    Ok(detect(&state.paths).await)
}

#[tauri::command]
pub async fn install_java(app: AppHandle, state: State<'_, AppState>, major: u32) -> Result<JavaInstall> {
    install(&state.http, &state.paths, major, progress_emitter(&app)).await
}

/// Instance ayar ekranında "bu instance hangi bayraklarla açılacak" önizlemesi.
#[tauri::command]
pub fn preview_jvm(state: State<'_, AppState>, instance_id: String, java_major: u32) -> Result<JvmProfile> {
    let mgr = InstanceManager::new(&state.paths);
    let inst = mgr.get(&instance_id)?;
    let hw = hardware();
    let mem = inst
        .memory_mb
        .or(state.settings.read().default_memory_mb)
        .unwrap_or_else(|| recommend_memory(&hw, mgr.mod_count(&instance_id)));
    Ok(optimize(java_major, &hw, mem))
}
