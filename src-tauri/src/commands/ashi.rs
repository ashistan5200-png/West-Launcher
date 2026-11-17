//! Ashi — West Client'ın maskotu ve Otomatik Suçlu Avcısı.
//! Planlama `crash::bisect`'te; burada her turu gerçekten oyunu açarak koşarız.

use super::launch::{kill_game, start_game, LaunchMode};
use crate::core::auth::AuthSession;
use crate::crash::bisect::{self, Phase, Planner, Res, Verdict};
use crate::crash::fingerprint::Fingerprint;
use crate::crash::modinfo::{self, ModInfo};
use crate::error::{AppError, Result};
use crate::state::{AppState, GameSignal, Hunt};
use base64::Engine;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

pub const EV_ASHI: &str = "ashi";

/// Oyunun ana menüye ulaştığını gösteren log işaretleri (1.12 → 1.21+).
static READY: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+ minecraft:textures/atlas/blocks|Narrator library .*loaded").unwrap()
});
static CRASH: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"---- Minecraft Crash Report ----|Crash report saved to|#@!@# Game crashed!|Failed to start the minecraft server|ModResolutionException|Incompatible mods? found|LoadingFailedException|Mod loading has failed")
        .unwrap()
});

/// Bir denemenin üst süresi; aşılırsa takılma = sorun kabul edilir.
const TEST_TIMEOUT: Duration = Duration::from_secs(8 * 60);
/// Ana menüye ulaştıktan sonra geç çökmeleri yakalamak için bekleme.
const SETTLE: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModBrief {
    pub file: String,
    pub name: String,
    /// Kütüphane/çekirdek mod: kapatmak yerine güncellemek önerilir
    pub library: bool,
    /// Bu moda zorunlu olarak bağlı modlar (kapatılırsa onlar da çalışmaz)
    pub dependents: Vec<String>,
}

impl From<&ModInfo> for ModBrief {
    fn from(m: &ModInfo) -> Self {
        Self { file: m.file.clone(), name: m.name.clone(), library: false, dependents: vec![] }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VerdictDto {
    Culprit { mods: Vec<ModBrief> },
    Combination { suspects: Vec<ModBrief> },
    NotReproduced,
    /// Oyun bir bağımlılık/uyumsuzluk hatasıyla hiç açılmıyor: mod yükleyici zaten nedenini söylüyor
    Dependency { message: String },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AshiEvent {
    pub instance_id: String,
    /// "started" | "testing" | "tested" | "done" | "cancelled" | "error"
    pub kind: &'static str,
    pub round: u32,
    pub max_rounds: u32,
    pub phase: Option<Phase>,
    pub total_mods: usize,
    pub enabled: usize,
    pub suspects: usize,
    /// "crash" | "ok" (yalnızca "tested")
    pub outcome: Option<&'static str>,
    pub verdict: Option<VerdictDto>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
enum Outcome {
    Ok,
    Crash(Fingerprint, String),
}

static REPORT_PATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"Crash report saved to:?\s*(?:#@!@#\s*)?(.+?\.txt)").unwrap());

struct Ctx {
    app: AppHandle,
    id: String,
    total: usize,
    max_rounds: u32,
}

impl Ctx {
    fn emit(&self, kind: &'static str, p: Option<&Planner>, enabled: usize, outcome: Option<&'static str>, verdict: Option<VerdictDto>, message: Option<String>) {
        let _ = self.app.emit(
            EV_ASHI,
            AshiEvent {
                instance_id: self.id.clone(),
                kind,
                round: p.map(|p| p.round).unwrap_or(0),
                max_rounds: self.max_rounds,
                phase: p.map(|p| p.phase()),
                total_mods: self.total,
                enabled,
                suspects: p.map(|p| p.suspects().len()).unwrap_or(self.total),
                outcome,
                verdict,
                message,
            },
        );
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HuntPlan {
    pub mod_count: usize,
    pub max_rounds: u32,
}

/// UI uyarı penceresi için: kaç mod var, en fazla kaç tur sürer.
#[tauri::command]
pub fn plan_hunt(state: State<'_, AppState>, id: String) -> Result<HuntPlan> {
    let mods = modinfo::scan(&state.paths.instance_game_dir(&id).join("mods"))?;
    Ok(HuntPlan { mod_count: mods.len(), max_rounds: Planner::estimated_rounds(mods.len()) })
}

#[tauri::command]
pub async fn start_hunt(app: AppHandle, state: State<'_, AppState>, id: String, auth: Option<AuthSession>, offline_name: Option<String>) -> Result<HuntPlan> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg("Önce oyunu kapatın; Ashi oyunu kendisi açıp kapatacak"));
    }
    if state.hunts.lock().contains_key(&id) {
        return Err(AppError::msg("Ashi zaten bu instance'ta avda"));
    }
    let auth = super::accounts::resolve_launch_auth(&state, auth, offline_name).await?;
    let mods_dir = state.paths.instance_game_dir(&id).join("mods");
    bisect::restore(&mods_dir);
    let mods = modinfo::scan(&mods_dir)?;
    if mods.len() < 2 {
        return Err(AppError::msg("Avlanacak kadar mod yok (en az 2 gerekli)"));
    }
    let plan = HuntPlan { mod_count: mods.len(), max_rounds: Planner::estimated_rounds(mods.len()) };
    let cancel = Arc::new(AtomicBool::new(false));
    state.hunts.lock().insert(id.clone(), Hunt { cancel: cancel.clone() });

    let ctx = Ctx { app: app.clone(), id: id.clone(), total: mods.len(), max_rounds: plan.max_rounds };
    tokio::spawn(async move {
        ctx.emit("started", None, mods.len(), None, None, None);
        let result = hunt(&ctx, &mods, auth, &cancel).await;
        let st = ctx.app.state::<AppState>();
        // Ne olursa olsun: tüm modlar eski haline
        bisect::restore(&mods_dir);
        st.watchers.lock().remove(&ctx.id);
        st.hunts.lock().remove(&ctx.id);
        match result {
            Ok((planner, verdict)) => ctx.emit("done", Some(&planner), mods.len(), None, Some(verdict), None),
            Err(_) if cancel.load(Ordering::Relaxed) => ctx.emit("cancelled", None, mods.len(), None, None, None),
            Err(e) => ctx.emit("error", None, mods.len(), None, None, Some(e.to_string())),
        }
    });
    Ok(plan)
}

async fn hunt(ctx: &Ctx, mods: &[ModInfo], auth: AuthSession, cancel: &AtomicBool) -> Result<(Planner, VerdictDto)> {
    let st = ctx.app.state::<AppState>();
    let mods_dir = st.paths.instance_game_dir(&ctx.id).join("mods");
    let mut planner = Planner::new(mods);
    let mut baseline: Option<Fingerprint> = None;
    let mut retries = 0u32;

    while let Some(test) = planner.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::msg("iptal"));
        }
        bisect::apply(&mods_dir, mods, &test.enabled)?;
        ctx.emit("testing", Some(&planner), test.enabled.len(), None, None, None);

        let outcome = run_test(ctx, auth.clone(), cancel).await?;
        let (res, label) = match &outcome {
            Outcome::Ok => (Res::Ok, "ok"),
            Outcome::Crash(fp, text) => match &baseline {
                None => {
                    // İlk tur: bağımlılık hatasıysa avlanmaya gerek yok, yükleyici nedenini söylüyor
                    if let Fingerprint::Dependency { message } = fp {
                        return Ok((planner, VerdictDto::Dependency { message: message.clone() }));
                    }
                    tracing::info!("Ashi: ilk çökme parmak izi: {}", fp.summary());
                    baseline = Some(fp.clone());
                    (Res::Crash, "crash")
                }
                Some(b) if fp.same_as(b) => (Res::Crash, "crash"),
                Some(_) => {
                    // Farklı hata: kapatılan bir moda gizli bağımlılık mı? Eksik sınıfı sağlayan modu bul.
                    let hidden = Fingerprint::missing_class(text).and_then(|cls| {
                        (0..mods.len()).filter(|i| !test.enabled.contains(i)).find(|&i| {
                            let on = mods_dir.join(&mods[i].file);
                            let off = mods_dir.join(format!("{}{}", mods[i].file, bisect::OFF_SUFFIX));
                            modinfo::jar_has_class(if on.exists() { &on } else { &off }, &cls)
                        })
                    });
                    if let Some(i) = hidden.filter(|_| retries < 12) {
                        if planner.force_enable(i) {
                            retries += 1;
                            tracing::info!("Ashi: gizli bağımlılık bulundu, hep açık kalacak: {}", mods[i].name);
                            ctx.emit("tested", Some(&planner), test.enabled.len(), Some("other"), None, Some(format!("{} gizli bir bağımlılık; açık tutuluyor", mods[i].name)));
                            continue;
                        }
                    }
                    tracing::info!("Ashi: farklı bir hata (belirsiz deneme): {}", fp.summary());
                    (Res::Other, "other")
                }
            },
        };
        planner.record(res);
        ctx.emit("tested", Some(&planner), test.enabled.len(), Some(label), None, None);
    }

    let brief = |ids: &[usize]| {
        ids.iter()
            .map(|&i| {
                let mut b = ModBrief::from(&mods[i]);
                b.library = planner.is_library(i);
                b.dependents = planner.dependents(i).into_iter().map(|j| mods[j].name.clone()).collect();
                b
            })
            .collect::<Vec<_>>()
    };
    let verdict = match planner.verdict().cloned().unwrap_or(Verdict::NotReproduced) {
        Verdict::Culprit { mods } => VerdictDto::Culprit { mods: brief(&mods) },
        Verdict::Combination { suspects } => VerdictDto::Combination { suspects: brief(&suspects) },
        Verdict::NotReproduced => VerdictDto::NotReproduced,
    };
    Ok((planner, verdict))
}

/// Oyunu bir kez açar ve sonucu belirler:
/// ana menüye ulaşıp `SETTLE` boyunca ayakta kalırsa Ok, öncesinde düşerse
/// ya da çökme raporu basarsa ya da süre aşılırsa Crash.
async fn run_test(ctx: &Ctx, auth: AuthSession, cancel: &AtomicBool) -> Result<Outcome> {
    let st = ctx.app.state::<AppState>();
    let (tx, mut rx) = mpsc::unbounded_channel();
    st.watchers.lock().insert(ctx.id.clone(), tx);

    if let Err(e) = start_game(&ctx.app, &ctx.id, auth, None, LaunchMode::Hunt).await {
        st.watchers.lock().remove(&ctx.id);
        // Java/ağ gibi modlarla ilgisiz hatalar avı durdurur
        return Err(e);
    }

    let started = Instant::now();
    let mut ready_at: Option<Instant> = None;
    let mut verdict: Option<bool> = None; // Some(true) = çöktü
    let mut user_closed = false;
    let mut timed_out = false;
    let mut log: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let mut report: Option<String> = None;

    loop {
        let sig = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        match sig {
            Ok(Some(GameSignal::Log(line))) => {
                if let Some(c) = REPORT_PATH.captures(&line) {
                    report = Some(c[1].trim().to_string());
                }
                if verdict.is_none() && CRASH.is_match(&line) {
                    verdict = Some(true);
                    // Raporun/yığın izinin yazılması için kısa bir süre tanı
                    let st2 = ctx.app.clone();
                    let id2 = ctx.id.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(1500)).await;
                        kill_game(&st2.state::<AppState>(), &id2);
                    });
                } else if ready_at.is_none() && READY.is_match(&line) {
                    ready_at = Some(Instant::now());
                }
                log.push_back(line);
                if log.len() > 4000 {
                    log.pop_front();
                }
            }
            Ok(Some(GameSignal::Exit(code))) => {
                if verdict.is_none() {
                    verdict = Some(match (ready_at, code) {
                        (Some(_), _) => false,
                        // Ana menüden önce temiz çıkış = kullanıcı pencereyi kapattı
                        (None, Some(0)) => {
                            user_closed = true;
                            true
                        }
                        _ => true,
                    });
                }
                break;
            }
            Ok(None) => break,
            Err(_) => {}
        }

        if cancel.load(Ordering::Relaxed) {
            kill_game(&st, &ctx.id);
            wait_exit(&mut rx).await;
            st.watchers.lock().remove(&ctx.id);
            return Err(AppError::msg("iptal"));
        }
        if verdict.is_none() {
            if let Some(t) = ready_at {
                if t.elapsed() >= SETTLE {
                    verdict = Some(false);
                    kill_game(&st, &ctx.id);
                }
            } else if started.elapsed() >= TEST_TIMEOUT {
                verdict = Some(true);
                timed_out = true;
                kill_game(&st, &ctx.id);
            }
        }
        // Sonuç belli ve oyun öldürüldüyse çıkışı bekle ki sonraki tur çakışmasın
        if verdict.is_some() && !st.running.lock().contains_key(&ctx.id) {
            break;
        }
    }
    st.watchers.lock().remove(&ctx.id);

    if user_closed {
        return Err(AppError::msg("Oyun penceresi ana menüden önce kapatıldı; Ashi avı durdurdu. Avı tekrar başlatabilirsin."));
    }
    if verdict == Some(false) {
        return Ok(Outcome::Ok);
    }
    // Parmak izi: çökme raporu (varsa) + son log satırları
    let mut text = String::new();
    if let Some(p) = report {
        let path = std::path::PathBuf::from(&p);
        let path = if path.is_absolute() { path } else { st.paths.instance_game_dir(&ctx.id).join(path) };
        if let Ok(r) = std::fs::read_to_string(&path) {
            text.push_str(&r);
            text.push('\n');
        }
    }
    text.extend(log.iter().map(|l| format!("{l}\n")));
    let fp = crate::crash::fingerprint::from_text(&text, timed_out);
    Ok(Outcome::Crash(fp, text))
}

async fn wait_exit(rx: &mut mpsc::UnboundedReceiver<GameSignal>) {
    let _ = tokio::time::timeout(Duration::from_secs(20), async {
        while let Some(s) = rx.recv().await {
            if matches!(s, GameSignal::Exit(_)) {
                break;
            }
        }
    })
    .await;
}

#[tauri::command]
pub fn cancel_hunt(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<()> {
    let hunts = state.hunts.lock();
    let h = hunts.get(&id).ok_or_else(|| AppError::NotFound("süren av".into()))?;
    h.cancel.store(true, Ordering::Relaxed);
    drop(hunts);
    kill_game(&app.state::<AppState>(), &id);
    Ok(())
}

/// Ashi'nin bulduğu modları kalıcı olarak devre dışı bırakır (`.jar.disabled`,
/// Prism/Modrinth ile aynı kural — dosya silinmez, geri açılabilir).
#[tauri::command]
pub fn disable_mods(state: State<'_, AppState>, id: String, files: Vec<String>) -> Result<Vec<String>> {
    let dir = state.paths.instance_game_dir(&id).join("mods");
    let mut done = Vec::new();
    for f in files {
        if f.contains(['/', '\\']) || f.contains("..") || !f.ends_with(".jar") {
            return Err(AppError::msg(format!("Geçersiz dosya adı: {f}")));
        }
        let src = dir.join(&f);
        if src.exists() {
            crate::util::retry(|| std::fs::rename(&src, dir.join(format!("{f}.disabled")))).map_err(|e| crate::error::AppError::at(std::path::Path::new(&src), e))?;
            done.push(f);
        }
    }
    Ok(done)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AshiSkin {
    /// data:image/png;base64,…
    pub data_url: String,
    pub slim: bool,
}

pub const ASHI_PLAYER: &str = "AshiWest";

/// Maskotun skinini Mojang'dan AshiWest oyuncusunun profilinden çeker; 24 saat
/// önbelleğe alır. Hata olursa UI paketli yedek skine düşer.
#[tauri::command]
pub async fn ashi_skin(state: State<'_, AppState>) -> Result<AshiSkin> {
    let cache = state.paths.cache().join("ashi-skin.json");
    if let Ok(meta) = std::fs::metadata(&cache) {
        let fresh = meta.modified().ok().and_then(|m| m.elapsed().ok()).map(|d| d < Duration::from_secs(86_400)).unwrap_or(false);
        if fresh {
            if let Ok(skin) = serde_json::from_slice::<AshiSkin>(&std::fs::read(&cache)?) {
                return Ok(skin);
            }
        }
    }
    let (png, slim) = crate::skins::fetch_player_skin(&state.http, ASHI_PLAYER).await?;
    let out = AshiSkin { data_url: format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)), slim };
    let _ = crate::util::write_json_atomic(&cache, &out);
    Ok(out)
}

/// Ashi Çözücü: son çökme raporunu (ya da verilen log dosyasını) okuyup suçluyu ve nedeni bulur.
#[tauri::command]
pub async fn analyze_crash(state: State<'_, AppState>, id: String, file: Option<String>) -> Result<Option<crate::crash::analyze::Analysis>> {
    let gd = state.paths.instance_game_dir(&id);
    tokio::task::spawn_blocking(move || crate::crash::analyze::analyze(&gd, file.as_deref()))
        .await
        .map_err(|e| crate::error::AppError::msg(e.to_string()))
}

/// Ashi Çözücü onarımı: geçersiz dosya adları yüzünden çöken modu düzeltip yeniden paketler.
#[tauri::command]
pub async fn fix_mod(state: State<'_, AppState>, id: String, file: String, location: Option<String>) -> Result<crate::crash::fixer::FixReport> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg("Oyun açıkken mod düzeltilemez; önce oyunu kapat"));
    }
    let mods = state.paths.instance_game_dir(&id).join("mods");
    tokio::task::spawn_blocking(move || crate::crash::fixer::fix_bad_paths(&mods, &file, location.as_deref()))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

/// Onarımı geri al
#[tauri::command]
pub fn undo_fix(state: State<'_, AppState>, id: String, fixed: String, backup: String) -> Result<()> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg("Oyun açıkken geri alınamaz; önce oyunu kapat"));
    }
    crate::crash::fixer::undo(&state.paths.instance_game_dir(&id).join("mods"), &fixed, &backup)
}
