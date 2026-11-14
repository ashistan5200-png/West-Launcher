use super::progress_emitter;
use crate::content::install::{install, InstallCtx, InstallReport};
use crate::content::{self, load_index, modpack, InstalledContent, Kind, SearchQuery, SearchResult, Source};
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, LoaderKind};
use crate::secrets::Secrets;
use crate::state::AppState;
use tauri::{AppHandle, State};

pub fn loader_slug(k: LoaderKind) -> Option<String> {
    match k {
        LoaderKind::Vanilla => None,
        LoaderKind::Fabric => Some("fabric".into()),
        LoaderKind::Quilt => Some("quilt".into()),
        LoaderKind::Forge => Some("forge".into()),
        LoaderKind::NeoForge => Some("neoforge".into()),
    }
}

#[tauri::command]
pub async fn search_content(state: State<'_, AppState>, query: SearchQuery) -> Result<SearchResult> {
    let cf = Secrets::load(&state.paths.root).curseforge_api_key;
    content::search(&state.http, cf.as_deref(), &query).await
}

#[tauri::command]
pub async fn install_content(app: AppHandle, state: State<'_, AppState>, instance_id: String, source: Source, project_id: String, kind: Kind) -> Result<InstallReport> {
    if state.running.lock().contains_key(&instance_id) || state.hunts.lock().contains_key(&instance_id) {
        return Err(AppError::msg("Instance çalışırken içerik kurulamaz"));
    }
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    let cf = Secrets::load(&state.paths.root).curseforge_api_key;
    let ctx = InstallCtx {
        http: &state.http,
        cf_key: cf.as_deref(),
        instance_id: &instance_id,
        instance_dir: state.paths.instance_dir(&instance_id),
        game_dir: state.paths.instance_game_dir(&instance_id),
        mc_version: inst.mc_version.clone(),
        loader: loader_slug(inst.loader.kind),
        progress: progress_emitter(&app),
    };
    install(&ctx, source, &project_id, kind).await
}

#[tauri::command]
pub async fn install_modpack(app: AppHandle, state: State<'_, AppState>, source: Source, project_id: String) -> Result<Instance> {
    let cf = Secrets::load(&state.paths.root).curseforge_api_key;
    let ctx = modpack::PackCtx {
        http: &state.http,
        paths: &state.paths,
        cf_key: cf.as_deref(),
        concurrency: state.settings.read().max_concurrent_downloads,
        progress: progress_emitter(&app),
    };
    modpack::install(&ctx, source, &project_id).await
}

#[tauri::command]
pub fn installed_content(state: State<'_, AppState>, instance_id: String) -> Vec<InstalledContent> {
    load_index(&state.paths.instance_dir(&instance_id))
}
