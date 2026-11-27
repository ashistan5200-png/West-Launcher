use super::{progress_emitter, EV_GAME_EXIT, EV_GAME_LOG};
use crate::core::auth::AuthSession;
use crate::core::install::{extract_natives, install_version};
use crate::core::launch::{build_args, join_args, redact, spawn, supports_quick_play, LaunchOptions};
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
        return probe(&PathBuf::from(p)).await.ok_or_else(|| AppError::msg(crate::i18n::tf("Geçersiz Java yolu: {0}", &[&p])));
    }
    let auto = state.settings.read().auto_java;
    java::ensure(&state.http, &state.paths, major, auto, progress_emitter(app)).await
}

pub fn resolve_auth(auth: Option<AuthSession>, offline_name: Option<String>) -> Result<AuthSession> {
    match (auth, offline_name) {
        (Some(a), _) => Ok(a),
        (None, Some(n)) if !n.trim().is_empty() => Ok(AuthSession::offline(n.trim())),
        _ => Err(AppError::msg(crate::i18n::t("Bir hesap seçin veya offline kullanıcı adı girin"))),
    }
}

/// Tam başlatma hattı: Java → loader → dosyalar → natives → JVM optimizasyonu → spawn.
/// Hem "Oyna" düğmesi hem de Ashi'nin test turları bunu kullanır.
pub async fn start_game(app: &AppHandle, id: &str, auth: AuthSession, join_server: Option<String>, mode: LaunchMode) -> Result<u32> {
    let state = app.state::<AppState>();
    if state.running.lock().contains_key(id) {
        return Err(AppError::msg(crate::i18n::t("Bu instance zaten çalışıyor")));
    }
    // Önceki oturum çöktüyse oyun içi mod merkezinde kalan bekleyen değişiklikleri şimdi uygula
    if mode == LaunchMode::Play {
        let _ = crate::livemods::apply_pending(&state, id).await;
        crate::livemods::clean_staged(&state.paths.instance_dir(id));
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
        let prefs = state.settings.read().clone();
        let gd = state.paths.instance_game_dir(id);
        if enabled {
            if let Err(e) = crate::companion::apply_prefs(&gd, &prefs) {
                tracing::warn!("companion ayarları yazılamadı: {e}");
            }
        }
        if prefs.accessibility.low_graphics {
            if let Err(e) = crate::companion::apply_low_graphics(&gd) {
                tracing::warn!("grafik ayarları hafifletilemedi: {e}");
            }
        }
        // Optimizasyon modları: yalnızca Fabric/Quilt; uyumsuz olanlar atlanır, hata oyunu durdurmaz
        let loader = crate::commands::content::loader_slug(inst.loader.kind);
        let fabricish = matches!(loader.as_deref(), Some("fabric") | Some("quilt"));
        if fabricish && enabled {
            let ctx = crate::content::install::InstallCtx {
                http: &state.http,
                cf_key: None,
                instance_id: id,
                instance_dir: state.paths.instance_dir(id),
                game_dir: gd.clone(),
                mc_version: inst.mc_version.clone(),
                loader: loader.clone(),
                progress: progress.clone(),
            };
            // Dünyayı paylaş: her ağda (modem/CGNAT fark etmez) çalışan e4mc tüneli
            if let Err(e) = crate::content::install::install(&ctx, crate::content::Source::Modrinth, "e4mc", crate::content::Kind::Mod).await {
                tracing::info!("e4mc kurulamadı: {e}");
            }
        }
        if prefs.accessibility.perf_mods && fabricish {
            let ctx = crate::content::install::InstallCtx {
                http: &state.http,
                cf_key: None,
                instance_id: id,
                instance_dir: state.paths.instance_dir(id),
                game_dir: gd.clone(),
                mc_version: inst.mc_version.clone(),
                loader,
                progress: progress.clone(),
            };
            for slug in crate::companion::PERF_MODS {
                match crate::content::install::install(&ctx, crate::content::Source::Modrinth, slug, crate::content::Kind::Mod).await {
                    Ok(r) => {
                        for i in r.installed {
                            tracing::info!("performans modu kuruldu: {}", i.title);
                        }
                    }
                    Err(e) => tracing::info!("performans modu atlandı ({slug}): {e}"),
                }
            }
        }
    } else {
        crate::companion::remove(&state.paths.instance_game_dir(id));
    }

    let natives = {
        let archives = libs.natives.clone();
        let dest = state.paths.instance_natives(id);
        tokio::task::spawn_blocking(move || extract_natives(&archives, &dest))
            .await
            .map_err(|e| AppError::msg(e.to_string()))??
    };

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
    let mut opts = LaunchOptions {
        java: java.path.clone(),
        game_dir: game_dir.clone(),
        natives_dir: natives,
        memory_mb: profile.memory_mb,
        jvm_flags: profile.flags.clone(),
        extra_jvm_args: {
            // Genel varsayılan JVM argümanları önce, instance'ınkiler sonra (aynı ayar varsa instance'ınki geçerli)
            let mut a = state.settings.read().game.jvm_args.iter().filter(|x| !x.trim().is_empty()).cloned().collect::<Vec<_>>();
            a.extend(inst.extra_jvm_args.iter().cloned());
            // Launcher köprüsü: oyun içi Mod Merkezi
            if mode == LaunchMode::Play {
                if let Ok(b) = crate::bridge::ensure(&state.http, &state.paths.root).await {
                    a.extend(crate::bridge::jvm_args(b, id));
                }
            }
            a
        },
        resolution: inst.resolution.or(state.settings.read().game.resolution),
        fullscreen: state.settings.read().game.fullscreen,
        auth,
        join_server,
    };
    // Katılma argümanları sona eklenir; önbellekteki komut onlarsız saklanır ki hızlı yeniden başlatmada hedef değişebilsin
    let join = opts.join_server.take();
    let base_args = build_args(&state.paths, &version, &libs, &opts)?;
    let quick_play = supports_quick_play(&version);

    let hook_env = hook_env(&state, &inst, &java.path);
    let (pre, post, wrapper) = {
        let g = &state.settings.read().game;
        (g.pre_launch.trim().to_string(), g.post_exit.trim().to_string(), g.wrapper.trim().to_string())
    };
    // Başlatma öncesi komut (yalnızca oyna): hata dönerse oyun açılmaz
    if mode == LaunchMode::Play && !pre.is_empty() {
        run_hook(&pre, &hook_env, &game_dir, true).await?;
    }
    let loader = format!("{:?}", inst.loader.kind);
    let prepared = Prepared {
        java: java.path.clone(),
        args: base_args,
        quick_play,
        game_dir,
        wrapper: if mode == LaunchMode::Play { wrapper } else { String::new() },
        token,
        post,
        hook_env,
        inst_name: inst.name.clone(),
        game: crate::discord::GameInfo { loader, mc: inst.mc_version.clone(), mods: mod_count },
        memory_mb: profile.memory_mb as u64,
    };
    if mode == LaunchMode::Play {
        crate::livemods::remember(id, prepared.clone());
    }
    let pid = run_prepared(app, id, mode, &prepared, join.as_deref(), &[], Role::Normal).await?;
    if mode == LaunchMode::Play {
        let behavior = state.settings.read().launch_behavior.clone();
        if let Some(w) = app.get_webview_window("main") {
            match behavior.as_str() {
                "minimize" => { let _ = w.minimize(); }
                "hide" => { let _ = w.hide(); }
                _ => {}
            }
        }
    }
    Ok(pid)
}

/// Bir oyunu yeniden çalıştırmak için gereken her şey. İlk başlatmada hazırlanır; oyun içi mod merkezinin
/// yeniden başlatması bunu kullanır, böylece Java/dosya doğrulama/indirme adımları tekrarlanmaz.
#[derive(Clone)]
pub struct Prepared {
    pub java: PathBuf,
    /// Katılma (quickPlay) argümanları olmadan tam komut
    pub args: Vec<String>,
    pub quick_play: bool,
    pub game_dir: PathBuf,
    pub wrapper: String,
    pub token: String,
    pub post: String,
    pub hook_env: Vec<(String, String)>,
    pub inst_name: String,
    /// Discord'da gösterilen özet
    pub game: crate::discord::GameInfo,
    pub memory_mb: u64,
}

/// Çalıştırılan sürecin rolü
#[derive(Clone)]
pub enum Role {
    /// Sıradan oyun: instance'ın çalışan oyunu olarak kaydedilir
    Normal,
    /// Devralma: eski oyun açıkken arka planda açılır; eski oyun kapanınca "terfi" eder ve normal oyun olur.
    /// Terfiden önce kapanırsa (ör. yeni mod düzeni çöktü) eski oyuna dokunulmaz.
    Handoff(Arc<crate::livemods::Handoff>),
}

/// Hazır komutu çalıştırır, günlük ve çıkış olaylarını bağlar.
pub async fn run_prepared(app: &AppHandle, id: &str, mode: LaunchMode, p: &Prepared, join: Option<&str>, extra_jvm: &[String], role: Role) -> Result<u32> {
    let state = app.state::<AppState>();
    let mut args: Vec<String> = extra_jvm.to_vec();
    args.extend(p.args.iter().cloned());
    args.extend(join_args(p.quick_play, join));
    tracing::info!("başlatılıyor {id}: {} {}", p.java.display(), redact(&args, &p.token).join(" "));

    // Spawn + olay köprüsü
    let log_app = app.clone();
    let log_id = id.to_string();
    let token = p.token.clone();
    let log_role = role.clone();
    let on_log = Arc::new(move |line: String, stderr: bool| {
        let safe = if token.len() > 8 { line.replace(&token, "********") } else { line };
        if let Role::Handoff(h) = &log_role {
            if !h.promoted() {
                h.log(safe);
                return;
            }
        }
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
    let exit_game_dir = p.game_dir.clone();
    let exit_env = p.hook_env.clone();
    let post = p.post.clone();
    let exit_role = role.clone();
    let on_exit = Arc::new(move |code: Option<i32>| {
        if let Role::Handoff(h) = &exit_role {
            if !h.promoted() {
                // Yeni mod düzeni açılamadı: eski oyun açık kalır, bekleyen değişiklikler uygulanmaz
                crate::livemods::handoff_failed(&exit_app, &exit_id, h, code);
                return;
            }
        }
        let st = exit_app.state::<AppState>();
        let game = st.running.lock().remove(&exit_id);
        let secs = game.as_ref().map(|g| g.started.elapsed().as_secs()).unwrap_or(0);
        let mgr = InstanceManager::new(&st.paths);
        if mode == LaunchMode::Play {
            let _ = mgr.record_session(&exit_id, secs);
        }
        // Ayarlar → "Dünyaları yedekle": bu oturumda değişen dünyalar arka planda yedeklenir
        if mode == LaunchMode::Play {
            crate::features::backup_changed_worlds(&st, &exit_id, secs);
        }
        if let Some(w) = st.watchers.lock().get(&exit_id) {
            let _ = w.send(GameSignal::Exit(code));
        }
        // Oyun içi mod merkezi: bekleyen değişiklikleri uygula; devralma ya da yeniden başlatma varsa sürdür
        let relaunching = mode == LaunchMode::Play && crate::livemods::on_game_exit(&exit_id);
        if mode == LaunchMode::Play && !post.is_empty() && !relaunching {
            let (cmd, env, dir) = (post.clone(), exit_env.clone(), exit_game_dir.clone());
            tauri::async_runtime::spawn(async move {
                if let Err(e) = run_hook(&cmd, &env, &dir, false).await {
                    tracing::warn!("oyun sonrası komut: {e}");
                }
            });
        }
        // "Gizle" seçiliyse oyun kapanınca launcher geri gelir
        if mode == LaunchMode::Play && !relaunching && st.running.lock().is_empty() && st.settings.read().launch_behavior == "hide" {
            if let Some(w) = exit_app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }
        let crashed = matches!(code, Some(c) if c != 0 && c != -1);
        if mode == LaunchMode::Play && !relaunching && st.running.lock().is_empty() {
            st.discord.send(crate::discord::Presence::Idle { page: "__exit".into() });
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

    let normal = matches!(role, Role::Normal);
    // Yarış durumunu önlemek için kaydı spawn'dan önce aç (devralma süreci terfi edince kaydedilir)
    if normal {
        state.running.lock().insert(
            id.to_string(),
            RunningGame { pid: 0, started: std::time::Instant::now(), kill: None, log_tail: Default::default() },
        );
    }
    let handle = match spawn(&p.java, args, &p.game_dir, &p.wrapper, on_log, on_exit).await {
        Ok(h) => h,
        Err(e) => {
            if normal {
                state.running.lock().remove(id);
            }
            return Err(e);
        }
    };
    match &role {
        Role::Normal => {
            if let Some(g) = state.running.lock().get_mut(id) {
                g.pid = handle.pid;
                g.kill = Some(handle.kill);
            }
        }
        Role::Handoff(h) => h.attach(handle.pid, handle.kill),
    }
    if mode == LaunchMode::Play {
        state.discord.send(crate::discord::Presence::Playing {
            instance: p.inst_name.clone(),
            game: p.game.clone(),
            server: join.map(str::to_string),
            started_unix: chrono::Utc::now().timestamp(),
            invite: None,
        });
        // Discord'da "Birlikte oyna": paketin daveti arka planda hazırlanır
        let (rpc, join_btn) = { let st = state.settings.read(); (st.discord_rpc, st.discord_join) };
        if rpc && join_btn && crate::cloud::configured() {
            let app = app.clone();
            let id = id.to_string();
            let server = join.map(str::to_string);
            tauri::async_runtime::spawn(async move {
                let st = app.state::<AppState>();
                match crate::invite::ensure(&st, &id, server.as_deref()).await {
                    Ok(code) => st.discord.send(crate::discord::Presence::Invite { code }),
                    Err(e) => tracing::warn!("Discord daveti hazırlanamadı: {e}"),
                }
            });
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
        return Err(AppError::msg(crate::i18n::t("Ashi bu instance'ta suçlu avında; bitmesini bekleyin veya avı durdurun")));
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
        return Err(AppError::NotFound(crate::i18n::tf("çalışan instance {0}", &[&id])));
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

/// Başlatma komutlarına verilen ortam değişkenleri (Prism/MultiMC ile aynı adlar)
fn hook_env(state: &AppState, inst: &crate::instance::Instance, java: &std::path::Path) -> Vec<(String, String)> {
    vec![
        ("INST_NAME".into(), inst.name.clone()),
        ("INST_ID".into(), inst.id.clone()),
        ("INST_DIR".into(), state.paths.instance_dir(&inst.id).display().to_string()),
        ("INST_MC_DIR".into(), state.paths.instance_game_dir(&inst.id).display().to_string()),
        ("INST_JAVA".into(), java.display().to_string()),
        ("INST_MC_VERSION".into(), inst.mc_version.clone()),
    ]
}

/// Kullanıcının başlatma komutunu sistem kabuğunda çalıştırır. wait: bitmesini bekle ve hata dönerse hata ver.
pub async fn run_hook(command: &str, env: &[(String, String)], cwd: &std::path::Path, wait: bool) -> Result<()> {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg(command);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = tokio::process::Command::new("sh");
        c.arg("-c").arg(command);
        c
    };
    cmd.current_dir(cwd).envs(env.iter().map(|(k, v)| (k.as_str(), v.as_str()))).stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn().map_err(|e| AppError::msg(crate::i18n::tf("Komut çalıştırılamadı: {0}", &[&e])))?;
    if !wait {
        let _ = child.wait().await;
        return Ok(());
    }
    match tokio::time::timeout(std::time::Duration::from_secs(300), child.wait()).await {
        Ok(Ok(st)) if st.success() => Ok(()),
        Ok(Ok(st)) => Err(AppError::msg(crate::i18n::tf("Başlatma öncesi komut hata verdi (çıkış kodu {0}); oyun açılmadı.", &[&st.code().unwrap_or(-1)]))),
        Ok(Err(e)) => Err(AppError::msg(e.to_string())),
        Err(_) => {
            let _ = child.kill().await;
            Err(AppError::msg(crate::i18n::t("Başlatma öncesi komut 5 dakikada bitmedi; oyun açılmadı.")))
        }
    }
}

#[cfg(all(test, not(windows)))]
mod hook_tests {
    use super::run_hook;
    #[tokio::test]
    async fn hooks_run_with_env_and_fail_on_error() {
        let dir = std::env::temp_dir();
        let env = vec![("INST_NAME".to_string(), "Deneme".to_string())];
        let out = dir.join(format!("west-hook-{}.txt", uuid::Uuid::new_v4()));
        run_hook(&format!("echo \"$INST_NAME\" > '{}'", out.display()), &env, &dir, true).await.unwrap();
        assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "Deneme");
        let _ = std::fs::remove_file(&out);
        let e = run_hook("exit 3", &env, &dir, true).await.unwrap_err().to_string();
        assert!(e.contains('3'), "{e}");
    }
}
