use super::{progress_emitter, EV_GAME_EXIT, EV_GAME_LOG};
use crate::core::auth::AuthSession;
use crate::core::install::{extract_natives, install_version};
use crate::core::launch::{build_args, redact, spawn, LaunchOptions};
use crate::core::manifest::{ensure_vanilla_json, resolve_version};
use crate::error::{AppError, Result};
use crate::instance::{loaders::install_loader, InstanceManager};
use crate::java::jvm::{hardware, optimize, recommend_memory};
use crate::java::{self, probe, JavaInstall};
use crate::state::{AppState, GameSignal, RunningGame, RunningInfo, LOG_TAIL};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLine<'a> {
    instance_id: &'a str,
    line: String,
    stderr: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    instance_id: String,
    code: Option<i32>,
    session_secs: u64,
    crashed: bool,
    /// Ashi'nin test çalıştırması mı? (UI bunlar için çökme uyarısı göstermez)
    during_hunt: bool,
    /// Ashi önerisini yalnızca modlu instance'larda göstermek için
    mod_count: usize,
}

/// Oyunun nasıl başlatılacağı.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum LaunchMode {
    /// Normal oturum: oynama süresi kaydedilir, pencere küçültülebilir
    Play,
    /// Ashi test çalıştırması: istatistik tutulmaz, UI çökme uyarısı vermez
    Hunt,
}

async fn resolve_java(state: &AppState, app: &AppHandle, override_path: Option<&str>, major: u32) -> Result<JavaInstall> {
    if let Some(p) = override_path {
        return probe(&PathBuf::from(p)).await.ok_or_else(|| AppError::msg(format!("Geçersiz Java yolu: {p}")));
    }
    let auto = state.settings.read().auto_java;
    java::ensure(&state.http, &state.paths, major, auto, progress_emitter(app)).await
}

pub fn resolve_auth(auth: Option<AuthSession>, offline_name: Option<String>) -> Result<AuthSession> {
    match (auth, offline_name) {
        (Some(a), _) => Ok(a),
        (None, Some(n)) if !n.trim().is_empty() => Ok(AuthSession::offline(n.trim())),
        _ => Err(AppError::msg("Bir hesap seçin veya offline kullanıcı adı girin")),
    }
}

/// Tam başlatma hattı: Java → loader → dosyalar → natives → JVM optimizasyonu → spawn.
/// Hem "Oyna" düğmesi hem de Ashi'nin test turları bunu kullanır.
pub async fn start_game(app: &AppHandle, id: &str, auth: AuthSession, join_server: Option<String>, mode: LaunchMode) -> Result<u32> {
    let state = app.state::<AppState>();
    if state.running.lock().contains_key(id) {
        return Err(AppError::msg("Bu instance zaten çalışıyor"));
    }
    let mgr = InstanceManager::new(&state.paths);
    let mut inst = mgr.get(id)?;
    let progress = progress_emitter(app);
    let concurrency = state.settings.read().max_concurrent_downloads;

    // 1) Vanilla'nın istediği Java (Forge kurulumcusu da buna ihtiyaç duyar)
    let vanilla = ensure_vanilla_json(&state.http, &state.paths, &inst.mc_version).await?;
    let vanilla_major = vanilla.java_version.as_ref().map(|j| j.major_version).unwrap_or(8);
    let mut java = resolve_java(&state, app, inst.java_path.as_deref(), vanilla_major).await?;

    // 2) Loader kurulumu (önbellekli)
    let needs_install = inst.version_id.as_ref().map(|v| !state.paths.version_json(v).exists()).unwrap_or(true);
    if needs_install {
        let vid = install_loader(&state.http, &state.paths, &inst, Some(&java.path), progress.clone()).await?;
        inst.version_id = Some(vid);
        mgr.save(&inst)?;
    }
    let version_id = inst.version_id.clone().unwrap();

    // 3) Birleşik sürüm + dosyalar
    let version = resolve_version(&state.http, &state.paths, &version_id).await?;
    if let Some(req) = &version.java_version {
        if req.major_version != java.major && inst.java_path.is_none() {
            java = resolve_java(&state, app, None, req.major_version).await?;
        }
    }
    let libs = install_version(&state.http, &state.paths, &version, concurrency, id, progress.clone()).await?;

    // West Companion: normal oyunda kur/güncelle; Ashi'nin test turlarında devre dışı
    if mode == LaunchMode::Play {
        let res_dir = app.path().resource_dir().unwrap_or_default();
        let enabled = state.settings.read().companion_enabled;
        let rep = crate::companion::prepare(&state.http, &state.paths, &res_dir, &inst, enabled, progress.clone()).await;
        for n in rep.notes {
            tracing::info!("companion: {n}");
        }
    } else {
        crate::companion::remove(&state.paths.instance_game_dir(id));
    }

    let natives = state.paths.instance_natives(id);
    {
        let archives = libs.natives.clone();
        let dest = natives.clone();
        tokio::task::spawn_blocking(move || extract_natives(&archives, &dest))
            .await
            .map_err(|e| AppError::msg(e.to_string()))??;
    }

    // 4) JVM optimizasyonu
    let hw = hardware();
    let mod_count = mgr.mod_count(id);
    let memory = inst
        .memory_mb
        .or(state.settings.read().default_memory_mb)
        .unwrap_or_else(|| recommend_memory(&hw, mod_count));
    let profile = optimize(java.major, &hw, memory);

    let token = auth.access_token.clone();
    let game_dir = state.paths.instance_game_dir(id);
    let opts = LaunchOptions {
        java: java.path.clone(),
        game_dir: game_dir.clone(),
        natives_dir: natives,
        memory_mb: profile.memory_mb,
        jvm_flags: profile.flags.clone(),
        extra_jvm_args: inst.extra_jvm_args.clone(),
        resolution: inst.resolution,
        auth,
        join_server,
    };
    let args = build_args(&state.paths, &version, &libs, &opts)?;
    tracing::info!("başlatılıyor {id}: {} {}", java.path.display(), redact(&args, &token).join(" "));

    // 5) Spawn + olay köprüsü
    let log_app = app.clone();
    let log_id = id.to_string();
    let on_log = Arc::new(move |line: String, stderr: bool| {
        let safe = if token.len() > 8 { line.replace(&token, "********") } else { line };
        let st = log_app.state::<AppState>();
        if let Some(g) = st.running.lock().get_mut(&log_id) {
            if g.log_tail.len() >= LOG_TAIL {
                g.log_tail.pop_front();
            }
            g.log_tail.push_back(safe.clone());
        }
        if safe.contains("Saved screenshot as") {
            let _ = log_app.emit(super::screenshots::EV_TAKEN, serde_json::json!({ "instanceId": log_id }));
        }
        if let Some(w) = st.watchers.lock().get(&log_id) {
            let _ = w.send(GameSignal::Log(safe.clone()));
        }
        let _ = log_app.emit(EV_GAME_LOG, LogLine { instance_id: &log_id, line: safe, stderr });
    });

    let exit_app = app.clone();
    let exit_id = id.to_string();
    let on_exit = Arc::new(move |code: Option<i32>| {
        let st = exit_app.state::<AppState>();
        let game = st.running.lock().remove(&exit_id);
        let secs = game.as_ref().map(|g| g.started.elapsed().as_secs()).unwrap_or(0);
        let mgr = InstanceManager::new(&st.paths);
        if mode == LaunchMode::Play {
            let _ = mgr.record_session(&exit_id, secs);
        }
        if let Some(w) = st.watchers.lock().get(&exit_id) {
            let _ = w.send(GameSignal::Exit(code));
        }
        let crashed = matches!(code, Some(c) if c != 0 && c != -1);
        if mode == LaunchMode::Play && st.running.lock().is_empty() {
            st.discord.send(crate::discord::Presence::Idle);
        }
        if st.running.lock().is_empty() {
            crate::overlay::on_games_stopped(&exit_app);
        }
        let _ = exit_app.emit(
            EV_GAME_EXIT,
            ExitEvent {
                instance_id: exit_id.clone(),
                code,
                session_secs: secs,
                crashed,
                during_hunt: mode == LaunchMode::Hunt,
                mod_count: mgr.mod_count(&exit_id),
            },
        );
    });

    // Yarış durumunu önlemek için kaydı spawn'dan önce aç
    state.running.lock().insert(
        id.to_string(),
        RunningGame { pid: 0, started: std::time::Instant::now(), kill: None, log_tail: Default::default() },
    );
    let handle = match spawn(&java.path, args, &game_dir, on_log, on_exit).await {
        Ok(h) => h,
        Err(e) => {
            state.running.lock().remove(id);
            return Err(e);
        }
    };
    if let Some(g) = state.running.lock().get_mut(id) {
        g.pid = handle.pid;
        g.kill = Some(handle.kill);
    }
    if mode == LaunchMode::Play {
        let loader = format!("{:?}", inst.loader.kind).replace("NeoForge", "NeoForge");
        state.discord.send(crate::discord::Presence::Playing {
            instance: inst.name.clone(),
            detail: format!("{} {} · {} mod", loader, inst.mc_version, mod_count),
            started_unix: chrono::Utc::now().timestamp(),
        });
    }
    if mode == LaunchMode::Play {
        crate::overlay::on_game_started(&app);
    }
    if mode == LaunchMode::Play && state.settings.read().close_on_launch {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.minimize();
        }
    }
    Ok(handle.pid)
}

#[tauri::command]
pub async fn launch_instance(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    // 2. aşamada hesap yöneticisinden gelen oturum; şimdilik offline isim desteklenir
    auth: Option<AuthSession>,
    offline_name: Option<String>,
    join_server: Option<String>,
) -> Result<u32> {
    if state.hunts.lock().contains_key(&id) {
        return Err(AppError::msg("Ashi bu instance'ta suçlu avında; bitmesini bekleyin veya avı durdurun"));
    }
    let auth = super::accounts::resolve_launch_auth(&state, auth, offline_name).await?;
    write_offline_skin(&state, &id);
    start_game(&app, &id, auth, join_server, LaunchMode::Play).await
}

/// Çalışan oyuna durdurma sinyali gönderir. Oyun yoksa false döner.
pub fn kill_game(state: &AppState, id: &str) -> bool {
    let mut running = state.running.lock();
    match running.get_mut(id).and_then(|g| g.kill.take()) {
        Some(k) => k.send(()).is_ok(),
        None => false,
    }
}

#[tauri::command]
pub fn kill_instance(state: State<'_, AppState>, id: String) -> Result<()> {
    if !state.running.lock().contains_key(&id) {
        return Err(AppError::NotFound(format!("çalışan instance {id}")));
    }
    kill_game(&state, &id);
    Ok(())
}

#[tauri::command]
pub fn running_instances(state: State<'_, AppState>) -> Vec<RunningInfo> {
    state.running_info()
}

/// Etkin hesap offline ise ve launcher'da bir skin seçtiyse, West Companion'ın
/// oyunda göstermesi için skin dosyasını instance'a yazar.
fn write_offline_skin(state: &AppState, id: &str) {
    let store = crate::accounts::AccountStore::load(&state.paths.accounts_file());
    let lib = crate::skins::Library::new(&state.paths.root);
    let skin = store
        .active_account()
        .filter(|a| a.kind == crate::accounts::AccountKind::Offline)
        .and_then(|a| a.skin_id.clone())
        .and_then(|sid| Some((lib.read(&sid).ok()?, lib.list().into_iter().find(|e| e.id == sid)?.slim)));
    let game = state.paths.instance_game_dir(id);
    let _ = crate::companion::write_skin(&game, skin.as_ref().map(|(png, slim)| (png.as_slice(), *slim)));
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    pub compatible: bool,
    pub enabled: bool,
    pub config: crate::companion::CompanionConfig,
}

#[tauri::command]
pub fn get_companion(state: State<'_, AppState>, id: String) -> Result<CompanionInfo> {
    let inst = InstanceManager::new(&state.paths).get(&id)?;
    Ok(CompanionInfo {
        compatible: crate::companion::compatible(&inst),
        enabled: state.settings.read().companion_enabled,
        config: crate::companion::read_config(&state.paths.instance_game_dir(&id)),
    })
}

/// Oyun açıkken de çalışır: mod dosyayı ~2 sn içinde yeniden okur.
#[tauri::command]
pub fn set_companion_config(state: State<'_, AppState>, id: String, config: crate::companion::CompanionConfig) -> Result<()> {
    crate::companion::write_config(&state.paths.instance_game_dir(&id), &config)
}
