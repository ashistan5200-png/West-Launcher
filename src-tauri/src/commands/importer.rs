use super::progress_emitter;
use crate::core::report;
use crate::error::Result;
use crate::importer::{self, Found};
use crate::instance::Instance;
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn detect_launchers() -> Vec<Found> {
    tokio::task::spawn_blocking(importer::detect).await.unwrap_or_default()
}

#[tauri::command]
pub async fn detect_launcher_folder(path: String) -> Vec<Found> {
    tokio::task::spawn_blocking(move || importer::detect_folder(std::path::Path::new(&path))).await.unwrap_or_default()
}

#[tauri::command]
pub async fn import_instance(app: AppHandle, state: State<'_, AppState>, found: Found, mc_version: Option<String>, include_worlds: bool) -> Result<Instance> {
    let paths = state.paths.clone();
    let progress = progress_emitter(&app);
    let task = format!("import-{}", found.name);
    tokio::task::spawn_blocking(move || {
        let r = importer::import(&paths, &found, mc_version, include_worlds, |n| report(&progress, &task, "import", n, 0));
        report(&progress, &task, "done", 1, 1);
        r
    })
    .await
    .map_err(|e| crate::error::AppError::msg(e.to_string()))?
}
