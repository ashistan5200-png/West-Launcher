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
pub async fn content_project(state: State<'_, AppState>, id: String) -> Result<serde_json::Value> {
    content::modrinth::project_detail(&state.http, &id).await
}

#[tauri::command]
pub async fn content_versions(state: State<'_, AppState>, id: String) -> Result<serde_json::Value> {
    content::modrinth::project_versions(&state.http, &id).await
}

#[tauri::command]
pub async fn content_tags(state: State<'_, AppState>) -> Result<content::modrinth::Tags> {
    content::modrinth::tags(&state.http, &state.paths.cache()).await
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

// ───────── Instance içerik yöneticisi ─────────

use crate::content::manage::{self, ContentFile, ExportOpts, ExportReport, FileEntry, LogFile, UpdateReport, World};
use crate::core::Progress;

fn not_running(state: &AppState, id: &str) -> Result<()> {
    if state.running.lock().contains_key(id) || state.hunts.lock().contains_key(id) {
        return Err(AppError::msg("Oyun açıkken bu işlem yapılamaz; önce oyunu kapat"));
    }
    Ok(())
}

fn backups_root(state: &AppState, id: &str) -> std::path::PathBuf {
    let base = state.settings.read().backup_dir.clone().map(std::path::PathBuf::from).unwrap_or_else(|| state.paths.backups());
    base.join(id)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub async fn list_content(state: State<'_, AppState>, instance_id: String) -> Result<Vec<ContentFile>> {
    let (a, b) = (state.paths.instance_dir(&instance_id), state.paths.instance_game_dir(&instance_id));
    blocking(move || Ok(manage::list(&a, &b))).await
}

#[tauri::command]
pub async fn refresh_content(state: State<'_, AppState>, instance_id: String) -> Result<Vec<ContentFile>> {
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    let loader = loader_slug(inst.loader.kind);
    manage::refresh(&state.http, &state.paths.instance_dir(&instance_id), &state.paths.instance_game_dir(&instance_id), &inst.mc_version, loader.as_deref()).await
}

#[tauri::command]
pub fn set_content_enabled(state: State<'_, AppState>, instance_id: String, ids: Vec<String>, enabled: bool) -> Result<()> {
    not_running(&state, &instance_id)?;
    manage::set_enabled(&state.paths.instance_game_dir(&instance_id), &ids, enabled)
}

#[tauri::command]
pub fn delete_content(state: State<'_, AppState>, instance_id: String, ids: Vec<String>) -> Result<()> {
    not_running(&state, &instance_id)?;
    manage::delete(&state.paths.instance_dir(&instance_id), &state.paths.instance_game_dir(&instance_id), &ids)
}

#[tauri::command]
pub async fn update_content(app: AppHandle, state: State<'_, AppState>, instance_id: String, ids: Vec<String>) -> Result<UpdateReport> {
    not_running(&state, &instance_id)?;
    let progress = progress_emitter(&app);
    let task = format!("update:{instance_id}");
    let r = manage::update(
        &state.http,
        &state.paths.instance_dir(&instance_id),
        &state.paths.instance_game_dir(&instance_id),
        &backups_root(&state, &instance_id),
        &ids,
        |cur, total| progress(Progress { task: task.clone(), stage: if cur >= total { "done".into() } else { "update".into() }, current: cur as u64, total: total as u64, message: Some("İçerik güncelleniyor".into()) }),
    )
    .await;
    r
}

#[tauri::command]
pub fn add_content_files(state: State<'_, AppState>, instance_id: String, paths: Vec<String>) -> Result<Vec<String>> {
    not_running(&state, &instance_id)?;
    manage::add_files(&state.paths.instance_game_dir(&instance_id), &paths)
}

#[tauri::command]
pub async fn list_worlds(state: State<'_, AppState>, instance_id: String) -> Result<Vec<World>> {
    let g = state.paths.instance_game_dir(&instance_id);
    blocking(move || Ok(manage::worlds(&g))).await
}

#[tauri::command]
pub async fn backup_world(state: State<'_, AppState>, instance_id: String, folder: String) -> Result<String> {
    let g = state.paths.instance_game_dir(&instance_id);
    let b = backups_root(&state, &instance_id);
    let keep = state.settings.read().backup_keep;
    blocking(move || manage::backup_world(&g, &b, &folder, keep)).await
}

#[tauri::command]
pub fn delete_world(state: State<'_, AppState>, instance_id: String, folder: String) -> Result<()> {
    not_running(&state, &instance_id)?;
    manage::delete_world(&state.paths.instance_game_dir(&instance_id), &folder)
}

#[tauri::command]
pub fn world_backups_dir(state: State<'_, AppState>, instance_id: String) -> String {
    backups_root(&state, &instance_id).join("worlds").display().to_string()
}

#[tauri::command]
pub fn list_logs(state: State<'_, AppState>, instance_id: String) -> Vec<LogFile> {
    manage::logs(&state.paths.instance_game_dir(&instance_id))
}

#[tauri::command]
pub async fn read_log(state: State<'_, AppState>, instance_id: String, path: String) -> Result<String> {
    let g = state.paths.instance_game_dir(&instance_id);
    blocking(move || manage::read_log(&g, &path)).await
}

#[tauri::command]
pub fn list_files(state: State<'_, AppState>, instance_id: String, path: String) -> Result<Vec<FileEntry>> {
    manage::list_dir(&state.paths.instance_game_dir(&instance_id), &path)
}

#[tauri::command]
pub fn file_path(state: State<'_, AppState>, instance_id: String, path: String) -> Result<String> {
    let g = state.paths.instance_game_dir(&instance_id);
    if path.is_empty() {
        return Ok(g.display().to_string());
    }
    let rel = content::safe_rel(&path).ok_or_else(|| AppError::msg("Geçersiz yol"))?;
    Ok(g.join(rel).display().to_string())
}

#[tauri::command]
pub async fn export_mrpack(state: State<'_, AppState>, instance_id: String, dest: String, version: String, extras: Vec<String>) -> Result<ExportReport> {
    let inst = InstanceManager::new(&state.paths).get(&instance_id)?;
    let (a, b) = (state.paths.instance_dir(&instance_id), state.paths.instance_game_dir(&instance_id));
    blocking(move || {
        let loader = loader_slug(inst.loader.kind);
        let lv = inst.loader.version.clone().unwrap_or_default();
        manage::export_mrpack(&a, &b, std::path::Path::new(&dest), &ExportOpts {
            name: &inst.name,
            version: &version,
            mc: &inst.mc_version,
            loader: loader.as_deref().map(|l| (l, lv.as_str())),
            extras: &extras,
        })
    })
    .await
}
