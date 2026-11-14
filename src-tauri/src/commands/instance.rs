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
