use super::content::loader_slug;
use crate::assistant::ollama::{self, OllamaStatus, PullProgress};
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
    let (provider_name, url, model) = {
        let s = state.settings.read();
        (s.ai_provider.clone(), s.ollama_url.clone(), s.ollama_model.clone())
    };
    let claude_key = secrets.anthropic_api_key.clone().filter(|k| !k.trim().is_empty());
    let provider = match (provider_name.as_str(), claude_key) {
        ("claude", Some(key)) => Provider::Claude { key },
        ("ollama", _) => Provider::Ollama { url, model },
        _ => Provider::Off,
    };
    let ctx = Ctx {
        http: &state.http,
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

/// `name`: "anthropic" | "curseforge". Boş değer anahtarı siler.
#[tauri::command]
pub fn set_secret(state: State<'_, AppState>, name: String, value: String) -> Result<SecretStatus> {
    let mut s = Secrets::load(&state.paths.root);
    let v = Some(value.trim().to_string()).filter(|v| !v.is_empty());
    match name.as_str() {
        "anthropic" => s.anthropic_api_key = v,
        "curseforge" => s.curseforge_api_key = v,
        _ => return Err(crate::error::AppError::msg("bilinmeyen anahtar")),
    }
    s.save(&state.paths.root)?;
    Ok(s.status())
}

#[tauri::command]
pub async fn ollama_status(state: State<'_, AppState>) -> Result<OllamaStatus> {
    let (url, model) = {
        let s = state.settings.read();
        (s.ollama_url.clone(), s.ollama_model.clone())
    };
    Ok(ollama::status(&state.http, &url, &model).await)
}

/// Seçili yerel modeli indirir; ilerleme "ollama-pull" olayıyla gelir.
#[tauri::command]
pub async fn ollama_pull(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let (url, model) = {
        let s = state.settings.read();
        (s.ollama_url.clone(), s.ollama_model.clone())
    };
    let emitter = app.clone();
    let res = ollama::pull(&state.http, &url, &model, move |p| {
        let _ = emitter.emit("ollama-pull", p);
    })
    .await;
    if let Err(e) = &res {
        let _ = app.emit("ollama-pull", PullProgress { status: "error".into(), completed: 0, total: 0, done: true, error: Some(e.to_string()) });
    }
    res
}
