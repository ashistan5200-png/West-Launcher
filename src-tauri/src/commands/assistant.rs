use super::content::loader_slug;
use crate::assistant::{ollama, setup};
use crate::assistant::{chat, ChatOutcome, Ctx, InstanceBrief, Provider};
use crate::error::Result;
use crate::instance::InstanceManager;
use crate::secrets::{SecretStatus, Secrets};
use crate::state::AppState;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

/// Ashi ile bir sohbet turu. `history` UI'ın sakladığı ham API geçmişidir.
#[tauri::command]
pub async fn ashi_chat(state: State<'_, AppState>, history: Vec<Value>, message: String, active_instance: Option<String>) -> Result<ChatOutcome> {
    let secrets = Secrets::load(&state.paths.root);
    let instances: Vec<InstanceBrief> = InstanceManager::new(&state.paths)
        .list()?
        .into_iter()
        .filter(|i| !i.is_template)
        .map(|i| InstanceBrief {
            loader: loader_slug(i.loader.kind).unwrap_or_else(|| "vanilla".into()),
            id: i.id,
            name: i.name,
            mc_version: i.mc_version,
        })
        .collect();
    let active = active_instance.and_then(|id| instances.iter().find(|i| i.id == id).cloned());
    let (provider_name, url, model, claude_model) = {
        let s = state.settings.read();
        (s.ai_provider.clone(), s.ollama_url.clone(), s.ollama_model.clone(), s.claude_model.clone())
    };
    let claude_key = secrets.anthropic_api_key.clone().filter(|k| !k.trim().is_empty());
    // Claude seçili ve anahtar varsa ajan modu; yoksa yerel model (kapalıysa sessizce açılır); o da yoksa anahtar kelime modu
    let provider = match (provider_name.as_str(), claude_key) {
        ("claude", Some(key)) => Provider::Claude { key, model: claude_model },
        _ if provider_name != "off" && setup::ensure_running(&state.http, &url, &state.paths.root).await => Provider::Ollama { url, model },
        _ => Provider::Off,
    };
    let ctx = Ctx {
        http: &state.http,
        state: &state,
        provider,
        cf_key: secrets.curseforge_api_key.as_deref().filter(|k| !k.trim().is_empty()),
        instances,
        active,
    };
    chat(&ctx, history, &message).await
}

#[tauri::command]
pub fn secret_status(state: State<'_, AppState>) -> SecretStatus {
    Secrets::load(&state.paths.root).status()
}

/// `name`: "curseforge". Boş değer anahtarı siler.
#[tauri::command]
pub fn set_secret(state: State<'_, AppState>, name: String, value: String) -> Result<SecretStatus> {
    let mut s = Secrets::load(&state.paths.root);
    let v = Some(value.trim().to_string()).filter(|v| !v.is_empty());
    match name.as_str() {
        "curseforge" => s.curseforge_api_key = v,
        "anthropic" => s.anthropic_api_key = v,
        _ => return Err(crate::error::AppError::msg("bilinmeyen anahtar")),
    }
    s.save(&state.paths.root)?;
    Ok(s.status())
}

/// Ashi'nin yerel yapay zekasının durumu (kurulum ekranı için).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    /// Ollama bilgisayarda kurulu mu (çalışmasa bile)
    pub installed: bool,
    pub running: bool,
    pub model: String,
    pub model_installed: bool,
    /// Bu bilgisayarın RAM'ine göre önerilen model ve indirme boyutu (GB)
    pub recommended: String,
    pub download_gb: f32,
}

#[tauri::command]
pub async fn ollama_status(state: State<'_, AppState>) -> Result<AiStatus> {
    let (url, model) = {
        let s = state.settings.read();
        (s.ollama_url.clone(), s.ollama_model.clone())
    };
    let st = ollama::status(&state.http, &url, &model).await;
    let installed = st.running || setup::find_binary(&state.paths.root).is_some();
    // Ollama'nın kendisi ≈1.5 GB; kuruluysa yalnızca model indirilir
    let download_gb = if st.model_installed { 0.0 } else { setup::model_size_gb(&model) } + if installed { 0.0 } else { 1.5 };
    Ok(AiStatus { installed, running: st.running, model_installed: st.model_installed, model, recommended: setup::recommended_model().into(), download_gb })
}

/// Ollama'yı ve modeli tek seferde kurar; ilerleme "ollama-setup" olayıyla gelir.
/// `model` verilirse önce ayarlara yazılır.
#[tauri::command]
pub async fn ollama_setup(app: AppHandle, state: State<'_, AppState>, model: Option<String>) -> Result<()> {
    let (url, model) = {
        let mut s = state.settings.write();
        if let Some(m) = model.filter(|m| !m.trim().is_empty()) {
            s.ollama_model = m;
        }
        s.ai_provider = "ollama".into();
        let _ = s.save(&state.paths.settings_file());
        (s.ollama_url.clone(), s.ollama_model.clone())
    };
    let emitter = app.clone();
    let res = setup::run(&state.http, &state.paths.root, &url, &model, move |p| {
        let _ = emitter.emit("ollama-setup", p);
    })
    .await;
    if let Err(e) = &res {
        let _ = app.emit("ollama-setup", setup::SetupProgress { stage: "error", label: "Kurulum durdu".into(), completed: 0, total: 0, error: Some(e.to_string()) });
    }
    res
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    pub has_password: bool,
}

#[tauri::command]
pub fn lock_status(state: State<'_, AppState>) -> LockStatus {
    LockStatus { has_password: Secrets::load(&state.paths.root).launcher_password.is_some() }
}

/// `None` veya boş → kilidi kaldırır.
#[tauri::command]
pub fn set_launcher_password(state: State<'_, AppState>, password: Option<String>) -> Result<LockStatus> {
    let mut s = Secrets::load(&state.paths.root);
    s.launcher_password = match password.filter(|p| !p.is_empty()) {
        Some(p) => Some(crate::secrets::hash_password(&p)?),
        None => None,
    };
    s.save(&state.paths.root)?;
    Ok(LockStatus { has_password: s.launcher_password.is_some() })
}

#[tauri::command]
pub async fn verify_launcher_password(state: State<'_, AppState>, password: String) -> Result<bool> {
    let hash = Secrets::load(&state.paths.root).launcher_password;
    // Argon2 bilinçli olarak yavaştır; arayüzü bloklamamak için ayrı iş parçacığında
    Ok(match hash {
        Some(h) => tokio::task::spawn_blocking(move || crate::secrets::verify_password(&password, &h)).await.unwrap_or(false),
        None => true,
    })
}

/// "Şifremi unuttum": kilidi kaldırır ve güvenlik için kayıtlı hesapları siler
/// (kurtarma yolu kilidin hesap çalmaya dönüşmesini engeller).
#[tauri::command]
pub fn reset_launcher_lock(state: State<'_, AppState>) -> Result<()> {
    let mut s = Secrets::load(&state.paths.root);
    s.launcher_password = None;
    s.save(&state.paths.root)?;
    let _ = std::fs::remove_file(state.paths.accounts_file());
    Ok(())
}
