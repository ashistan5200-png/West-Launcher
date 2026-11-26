use crate::commands::progress_emitter;
use crate::content::install::{install, InstallCtx, InstallReport};
use crate::content::{Kind, Source};
use crate::error::{AppError, Result};
use crate::features::{self, FpsItem, PerfReport, Precheck, ServerPrepResult, ServerProbe};
use crate::instance::InstanceManager;
use crate::state::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn server_probe(address: String) -> Result<ServerProbe> {
    features::probe(&address).await
}

#[tauri::command]
pub async fn server_prep(app: AppHandle, state: State<'_, AppState>, address: String, name: Option<String>) -> Result<ServerPrepResult> {
    features::server_prep(&state, &address, name, progress_emitter(&app)).await
}

#[tauri::command]
pub async fn fps_plan(state: State<'_, AppState>, instance_id: String) -> Result<Vec<FpsItem>> {
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    features::fps_plan(&state, &inst).await
}

/// Seçilen performans modlarını kurar (bağımlılıklarıyla); kurulamayanlar rapora yazılır
#[tauri::command]
pub async fn fps_install(app: AppHandle, state: State<'_, AppState>, instance_id: String, slugs: Vec<String>) -> Result<InstallReport> {
    if state.running.lock().contains_key(&instance_id) {
        return Err(AppError::msg(crate::i18n::t("Instance çalışırken içerik kurulamaz")));
    }
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    let ctx = InstallCtx {
        http: &state.http,
        cf_key: None,
        instance_id: &instance_id,
        instance_dir: state.paths.instance_dir(&instance_id),
        game_dir: state.paths.instance_game_dir(&instance_id),
        mc_version: inst.mc_version.clone(),
        loader: crate::commands::content::loader_slug(inst.loader.kind),
        progress: progress_emitter(&app),
    };
    let mut all = InstallReport { installed: vec![], skipped: vec![], warnings: vec![] };
    for s in slugs {
        match install(&ctx, Source::Modrinth, &s, Kind::Mod).await {
            Ok(r) => {
                all.installed.extend(r.installed);
                all.skipped.extend(r.skipped);
                all.warnings.extend(r.warnings);
            }
            Err(e) => all.warnings.push(format!("{s}: {e}")),
        }
    }
    Ok(all)
}

#[tauri::command]
pub async fn install_precheck(state: State<'_, AppState>, instance_id: String, project_id: String, title: String) -> Result<Precheck> {
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    features::precheck(&state, &inst, &project_id, &title).await
}

#[tauri::command]
pub fn perf_report(state: State<'_, AppState>, instance_id: String) -> Result<PerfReport> {
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    Ok(features::perf_report(&state, &inst))
}

// ───────── Arkadaşla paket senkronu ─────────

#[tauri::command]
pub async fn pack_sync_publish(state: State<'_, AppState>, instance_id: String) -> Result<String> {
    crate::packsync::publish(&state, &instance_id).await
}

#[tauri::command]
pub async fn pack_sync_join(state: State<'_, AppState>, code: String) -> Result<crate::instance::Instance> {
    crate::packsync::join(&state, &code).await
}

#[tauri::command]
pub async fn pack_sync_status(state: State<'_, AppState>, instance_id: String) -> Result<crate::packsync::SyncStatus> {
    crate::packsync::status(&state, &instance_id).await
}

#[tauri::command]
pub async fn pack_sync_pull(state: State<'_, AppState>, instance_id: String) -> Result<crate::livemods::ImportReport> {
    crate::packsync::pull(&state, &instance_id).await
}

#[tauri::command]
pub fn pack_sync_unlink(state: State<'_, AppState>, instance_id: String) -> Result<()> {
    crate::packsync::unlink(&state, &instance_id)
}
