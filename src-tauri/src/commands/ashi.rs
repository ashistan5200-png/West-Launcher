//! Ashi — West Launcher'ın maskotu ve Otomatik Suçlu Avcısı.
//! Planlama `crash::bisect`'te; burada her turu gerçekten oyunu açarak koşarız.

use super::launch::{kill_game, start_game, LaunchMode};
use crate::core::auth::AuthSession;
use crate::crash::bisect::{self, Phase, Planner, Verdict};
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
}

impl From<&ModInfo> for ModBrief {
    fn from(m: &ModInfo) -> Self {
        Self { file: m.file.clone(), name: m.name.clone() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VerdictDto {
    Culprit { mods: Vec<ModBrief> },
    Combination { suspects: Vec<ModBrief> },
    NotReproduced,
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

#[derive(Debug, Clone, Copy, PartialEq)]
enum Outcome {
    Ok,
    Crash,
}

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

    while let Some(test) = planner.next() {
        if cancel.load(Ordering::Relaxed) {
            return Err(AppError::msg("iptal"));
        }
        bisect::apply(&mods_dir, mods, &test.enabled)?;
        ctx.emit("testing", Some(&planner), test.enabled.len(), None, None, None);

        let outcome = run_test(ctx, auth.clone(), cancel).await?;
        planner.record(outcome == Outcome::Crash);
        let label = if outcome == Outcome::Crash { "crash" } else { "ok" };
        ctx.emit("tested", Some(&planner), test.enabled.len(), Some(label), None, None);
    }

    let brief = |ids: &[usize]| ids.iter().map(|&i| ModBrief::from(&mods[i])).collect::<Vec<_>>();
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
    let mut verdict: Option<Outcome> = None;
    let mut user_closed = false;

    loop {
        let sig = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        match sig {
            Ok(Some(GameSignal::Log(line))) => {
                if verdict.is_none() && CRASH.is_match(&line) {
                    verdict = Some(Outcome::Crash);
                    kill_game(&st, &ctx.id);
                } else if ready_at.is_none() && READY.is_match(&line) {
                    ready_at = Some(Instant::now());
                }
            }
            Ok(Some(GameSignal::Exit(code))) => {
                if verdict.is_none() {
                    verdict = Some(match (ready_at, code) {
                        (Some(_), _) => Outcome::Ok,
                        // Ana menüden önce temiz çıkış = kullanıcı pencereyi kapattı
                        (None, Some(0)) => {
                            user_closed = true;
                            Outcome::Crash
                        }
                        _ => Outcome::Crash,
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
                    verdict = Some(Outcome::Ok);
                    kill_game(&st, &ctx.id);
                }
            } else if started.elapsed() >= TEST_TIMEOUT {
                verdict = Some(Outcome::Crash);
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
    Ok(verdict.unwrap_or(Outcome::Crash))
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
            std::fs::rename(&src, dir.join(format!("{f}.disabled")))?;
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
