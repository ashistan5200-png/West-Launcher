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
pub fn save_settings(app: tauri::AppHandle, state: State<'_, AppState>, settings: Settings) -> Result<()> {
    settings.save(&state.paths.settings_file())?;
    state.discord.send(crate::discord::Presence::Configure { client_id: settings.discord_client_id.clone(), enabled: settings.discord_rpc });
    *state.settings.write() = settings;
    crate::overlay::settings_changed(&app);
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
