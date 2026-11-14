use crate::core::manifest::{fetch_manifest, ManifestEntry};
use crate::error::Result;
use crate::instance::loaders::{list_versions, LoaderVersion};
use crate::instance::LoaderKind;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn list_mc_versions(state: State<'_, AppState>, include_snapshots: bool) -> Result<Vec<ManifestEntry>> {
    let m = fetch_manifest(&state.http, &state.paths).await?;
    Ok(m.versions
        .into_iter()
        .filter(|v| include_snapshots || v.kind == "release")
        .collect())
}

#[tauri::command]
pub async fn list_loader_versions(state: State<'_, AppState>, kind: LoaderKind, mc: String) -> Result<Vec<LoaderVersion>> {
    list_versions(&state.http, kind, &mc).await
}
