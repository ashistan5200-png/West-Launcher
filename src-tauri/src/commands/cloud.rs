//! West hesabı komutları (Supabase). Oturum anahtarları arayüze gönderilmez.
use crate::cloud::{self, SignupResult, Status, WestAccount};
use crate::error::Result;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn west_status(state: State<'_, AppState>) -> Result<Status> {
    Ok(cloud::status(&state.http, &state.paths.root).await)
}

#[tauri::command]
pub async fn west_username_available(state: State<'_, AppState>, username: String) -> Result<bool> {
    cloud::username_available(&state.http, username.trim()).await
}

#[tauri::command]
pub async fn west_signup(state: State<'_, AppState>, username: String, email: String, password: String) -> Result<SignupResult> {
    cloud::signup(&state.http, &state.paths.root, &username, &email, &password).await
}

#[tauri::command]
pub async fn west_login(state: State<'_, AppState>, email: String, password: String) -> Result<WestAccount> {
    cloud::login(&state.http, &state.paths.root, &email, &password).await
}

#[tauri::command]
pub async fn west_logout(state: State<'_, AppState>) -> Result<()> {
    cloud::logout(&state.http, &state.paths.root).await
}

#[tauri::command]
pub async fn west_reset_password(state: State<'_, AppState>, email: String) -> Result<()> {
    cloud::reset_password(&state.http, &email).await
}
