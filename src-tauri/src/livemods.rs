//! Oyun içi mod merkezi (West Companion'daki "Modlar" ekranı) için köprü uç noktaları.
//!
//! Oyun açıkken:
//! - Kaynak paketleri, shader'lar ve (tek oyunculuda) veri paketleri hemen uygulanır; oyun tarafı yeniden yükler.
//! - Mod dosyaları (jar) çalışan oyunda değiştirilemez (Windows açık dosyayı kilitler, Fabric yüklü modu
//!   kaldıramaz): açma/kapama, silme ve güncelleme "bekleyen değişiklik" olarak kaydedilir, geri alınabilir ve
//!   oyun kapanınca uygulanır. "Uygula ve yeniden başlat" oyunu kapatır, değişiklikleri uygular ve oyuncuyu
//!   aynı dünyaya/sunucuya geri sokar.
//! - Yeni kurulan modlar hemen diske iner; bir sonraki açılışta yüklenir (o ana kadar geri alınabilir).

use crate::content::install::{install, InstallCtx};
use crate::content::{self, manage, modrinth, Kind, SearchQuery, Source};
use crate::core::http::DownloadTask;
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::commands::launch::{Prepared, Role};
use crate::state::RunningGame;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// instance → yeniden başlatma planı (Some(katılma hedefi) / None: ana menü)
static RESTART: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static ICONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static LAST: OnceLock<Mutex<HashMap<String, Prepared>>> = OnceLock::new();
static HANDOFFS: OnceLock<Mutex<HashMap<String, Arc<Handoff>>>> = OnceLock::new();
/// Devralma oyununun mods klasörü (instance klasöründe)
const STAGED_DIR: &str = "staged-mods";
/// Yeni oturum hazır komutla açıldı (launcher arayüzü "çalışıyor" durumunu günceller)
pub const EV_RELAUNCHED: &str = "live-relaunched";

pub const EV_RELAUNCH: &str = "live-relaunch";
const PENDING_FILE: &str = "west-pending.json";
const DISABLED: &str = ".disabled";

pub fn set_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

fn restarts() -> &'static Mutex<HashMap<String, Option<String>>> {
    RESTART.get_or_init(Default::default)
}

/// Bekleyen değişiklik
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Op {
    /// enable | disable | delete | update | install
    pub kind: String,
    pub ids: Vec<String>,
    pub label: String,
    pub at: i64,
    /// Yeni oturum bu değişikliklerle açılamadıysa sebebi: normal başlatmada uygulanmaz, devralmaya katılmaz
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failed: Option<String>,
}

fn pending_path(dir: &Path) -> PathBuf {
    dir.join(PENDING_FILE)
}

pub fn load_pending(instance_dir: &Path) -> Vec<Op> {
    std::fs::read_to_string(pending_path(instance_dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_pending(instance_dir: &Path, ops: &[Op]) -> Result<()> {
    if ops.is_empty() {
        let _ = std::fs::remove_file(pending_path(instance_dir));
        return Ok(());
    }
    std::fs::write(pending_path(instance_dir), serde_json::to_vec_pretty(ops)?)?;
    Ok(())
}

/// Oyun kapanınca (ya da bir önceki oturum çöktüyse açılıştan önce) bekleyenleri uygular.
pub async fn apply_pending(state: &AppState, id: &str) -> Vec<String> {
    let dir = state.paths.instance_dir(id);
    let game = state.paths.instance_game_dir(id);
    let ops = load_pending(&dir);
    let mut errors = Vec::new();
    if ops.is_empty() {
        return errors;
    }
    let (failed, ops): (Vec<Op>, Vec<Op>) = ops.into_iter().partition(|o| o.failed.is_some());
    // Uygulamadan önce şu anki düzeni kaydet: istenirse tek tıkla geri dönülür
    if !ops.is_empty() {
        let label = ops.iter().map(|o| o.label.as_str()).collect::<Vec<_>>().join(", ");
        if let Err(e) = crate::restorepoints::create(&dir, &game, &label) {
            tracing::warn!("geri dönüş noktası oluşturulamadı: {e}");
        }
    }
    for op in &ops {
        let r = match op.kind.as_str() {
            "restore" => match op.ids.first() {
                Some(p) => crate::restorepoints::restore(&dir, &game, p),
                None => Ok(()),
            },
            "enable" => manage::set_enabled(&game, &op.ids, true),
            "disable" => manage::set_enabled(&game, &op.ids, false),
            "delete" => manage::delete(&dir, &game, &op.ids),
            "update" => {
                let backups = state.paths.backups().join(id);
                manage::update(&state.http, &dir, &game, &backups, &op.ids, |_, _| {}).await.map(|_| ())
            }
            _ => Ok(()),
        };
        if let Err(e) = r {
            tracing::warn!("bekleyen değişiklik uygulanamadı ({}): {e}", op.label);
            errors.push(format!("{}: {e}", op.label));
        }
    }
    // Açılamayan değişiklikler kullanıcı geri alana ya da tekrar deneyene dek bekler
    let _ = save_pending(&dir, &failed);
    errors
}

/// Oyun kapanırken çağrılır: yeniden başlatma istendi mi (katılma hedefiyle)
pub fn take_restart(id: &str) -> Option<Option<String>> {
    restarts().lock().ok()?.remove(id)
}

/// Oyun kapandıktan sonra çağrılır. Bekleyen değişiklikleri uygular ve:
/// - arka planda açılmış bir devralma oyunu varsa onu instance'ın oyunu yapar (o da kaldığı yere girer);
/// - yeniden başlatma istendiyse oyunu hazır komutla hemen yeniden açar (Java/dosya doğrulaması tekrarlanmaz).
/// Oyun yeniden açılıyorsa true döner (launcher penceresi geri getirilmez, oyun sonrası komut çalışmaz).
pub fn on_game_exit(id: &str) -> bool {
    let Some(app) = APP.get().cloned() else { return false };
    let id = id.to_string();
    let restart = take_restart(&id);
    let handoff = handoffs().lock().ok().and_then(|m| m.get(&id).cloned());
    if let Some(h) = handoff.filter(|h| !h.promoted() && !h.failed()) {
        h.old_gone.store(true, Ordering::SeqCst);
        tauri::async_runtime::spawn(async move {
            let st = app.state::<AppState>();
            let errors = apply_pending(&st, &id).await;
            if !errors.is_empty() {
                tracing::warn!("devralma: bazı değişiklikler uygulanamadı: {errors:?}");
            }
            promote(&app, &id, &h);
        });
        return true;
    }
    if let Some(join) = restart {
        tauri::async_runtime::spawn(async move {
            let st = app.state::<AppState>();
            let errors = apply_pending(&st, &id).await;
            let prepared = last().lock().ok().and_then(|m| m.get(&id).cloned());
            if let Some(p) = prepared {
                let t0 = std::time::Instant::now();
                match crate::commands::launch::run_prepared(&app, &id, crate::commands::launch::LaunchMode::Play, &p, join.as_deref(), &[], Role::Normal).await {
                    Ok(pid) => {
                        tracing::info!("hızlı yeniden başlatma: {} ms", t0.elapsed().as_millis());
                        let _ = app.emit(EV_RELAUNCHED, json!({ "instanceId": id, "pid": pid }));
                        return;
                    }
                    Err(e) => tracing::warn!("hızlı yeniden başlatma olmadı, tam başlatma deneniyor: {e}"),
                }
            }
            let _ = app.emit(EV_RELAUNCH, json!({ "instanceId": id, "join": join, "errors": errors }));
        });
        return true;
    }
    tauri::async_runtime::spawn(async move {
        let st = app.state::<AppState>();
        apply_pending(&st, &id).await;
    });
    false
}

// ───────── Hızlı yeniden başlatma ve devralma ─────────

/// Son başarılı başlatmanın hazır komutu (instance başına, yalnızca bellekte)
pub fn remember(id: &str, p: Prepared) {
    if let Ok(mut m) = last().lock() {
        m.insert(id.to_string(), p);
    }
}

fn last() -> &'static Mutex<HashMap<String, Prepared>> {
    LAST.get_or_init(Default::default)
}

fn handoffs() -> &'static Mutex<HashMap<String, Arc<Handoff>>> {
    HANDOFFS.get_or_init(Default::default)
}

/// Eski oyun açıkken yeni mod düzeniyle arka planda açılan oyun.
/// Durum: starting → ready (ana menüye ulaştı) → go (eski oyun kapandı, kaldığı yere girsin) | failed
pub struct Handoff {
    pub join: Option<String>,
    pub staged: PathBuf,
    state: Mutex<String>,
    error: Mutex<Option<String>>,
    promoted: AtomicBool,
    old_gone: AtomicBool,
    /// Kullanıcı iptal etti (çökme sayılmaz)
    cancelled: AtomicBool,
    tail: Mutex<VecDeque<String>>,
    pid: AtomicU32,
    kill: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
    started: Instant,
}

impl Handoff {
    fn new(join: Option<String>, staged: PathBuf) -> Self {
        Self {
            join,
            staged,
            state: Mutex::new("starting".into()),
            error: Mutex::new(None),
            promoted: AtomicBool::new(false),
            old_gone: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            tail: Mutex::new(VecDeque::new()),
            pid: AtomicU32::new(0),
            kill: Mutex::new(None),
            started: Instant::now(),
        }
    }
    pub fn promoted(&self) -> bool {
        self.promoted.load(Ordering::SeqCst)
    }
    fn failed(&self) -> bool {
        self.state() == "failed"
    }
    fn state(&self) -> String {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }
    fn set_state(&self, v: &str) {
        if let Ok(mut s) = self.state.lock() {
            *s = v.to_string();
        }
    }
    /// Terfiden önceki günlük satırları (çökerse sebebini göstermek için).
    /// Fabric uyumsuz modda süreci kapatmayıp hata penceresi açar: bunu yakalayıp devralmayı hemen iptal et.
    pub fn log(&self, line: String) {
        let fatal = FATAL_LINES.iter().any(|k| line.contains(k));
        if let Ok(mut t) = self.tail.lock() {
            if t.len() >= 400 {
                t.pop_front();
            }
            t.push_back(line);
        }
        if fatal && !self.promoted() && self.state() == "starting" {
            let tail: Vec<String> = self.tail.lock().map(|t| t.iter().cloned().collect()).unwrap_or_default();
            if let Ok(mut e) = self.error.lock() {
                *e = failure_reason(&tail);
            }
            self.set_state("failed");
            self.cancel();
        }
    }
    pub fn attach(&self, pid: u32, kill: tokio::sync::oneshot::Sender<()>) {
        self.pid.store(pid, Ordering::SeqCst);
        if let Ok(mut k) = self.kill.lock() {
            *k = Some(kill);
        }
    }
    fn cancel(&self) {
        if let Some(k) = self.kill.lock().ok().and_then(|mut k| k.take()) {
            let _ = k.send(());
        }
    }
}

/// Yeni oyunun açılamadığını kesinleştiren günlük satırları (Fabric bu durumda pencere açıp bekler)
const FATAL_LINES: [&str; 4] = ["Incompatible mods found", "Mod resolution failed", "Could not execute entrypoint stage", "---- Minecraft Crash Report ----"];
/// Yeni oyun bu sürede ana menüye ulaşmazsa devralma iptal edilir
const HANDOFF_TIMEOUT_SECS: u64 = 240;

/// Eski oyun kapandı: devralma oyununu instance'ın çalışan oyunu yap
fn promote(app: &AppHandle, id: &str, h: &Arc<Handoff>) {
    if h.failed() {
        return;
    }
    let st = app.state::<AppState>();
    let tail: VecDeque<String> = h.tail.lock().map(|t| t.clone()).unwrap_or_default();
    let kill = h.kill.lock().ok().and_then(|mut k| k.take());
    let pid = h.pid.load(Ordering::SeqCst);
    st.running.lock().insert(id.to_string(), RunningGame { pid, started: Instant::now(), kill, log_tail: tail });
    h.promoted.store(true, Ordering::SeqCst);
    if h.state() == "ready" {
        h.set_state("go");
    }
    tracing::info!("devralma: yeni oturum devraldı ({} ms)", h.started.elapsed().as_millis());
    // Önceki devralmaların klasörleri (kapanan oyunlarındı) artık serbest
    if let Some(root) = h.staged.parent() {
        if let Ok(rd) = std::fs::read_dir(root) {
            for e in rd.flatten().filter(|e| e.path() != h.staged) {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    let _ = app.emit(EV_RELAUNCHED, json!({ "instanceId": id, "pid": pid }));
}

/// Devralma oyunu terfiden önce kapandı (ör. yeni mod düzeni çöktü): eski oyun açık kalır
pub fn handoff_failed(app: &AppHandle, id: &str, h: &Arc<Handoff>, code: Option<i32>) {
    let tail: Vec<String> = h.tail.lock().map(|t| t.iter().cloned().collect()).unwrap_or_default();
    let reason = failure_reason(&tail).unwrap_or_else(|| crate::i18n::tf("Oyun açılamadı (çıkış kodu {0})", &[&code.map(|c| c.to_string()).unwrap_or_else(|| "?".into())]));
    if let Ok(mut e) = h.error.lock() {
        if e.is_none() {
            *e = Some(reason);
        }
    }
    h.set_state("failed");
    let st = app.state::<AppState>();
    let dir = st.paths.instance_dir(id);
    let _ = std::fs::write(dir.join("west-handoff-crash.log"), tail.join("\n"));
    if !h.cancelled.load(Ordering::SeqCst) {
        let reason = h.error.lock().ok().and_then(|e| e.clone()).unwrap_or_default();
        mark_failed(&dir, &st.paths.instance_game_dir(id), &reason);
    }
    let staged = h.staged.clone();
    std::thread::spawn(move || {
        // Süreç yeni kapandı; Windows dosyaları bırakana dek kısa bir süre tekrar dene
        for _ in 0..10 {
            if std::fs::remove_dir_all(&staged).is_ok() || !staged.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

/// Yeni oturum bu değişikliklerle açılamadı: değişiklikleri işaretle (normal başlatmada uygulanmasın) ve
/// yeni kurulan jar'ları devre dışı bırak ki oyun kapatılıp açılınca da çökmesin.
fn mark_failed(dir: &Path, game: &Path, reason: &str) {
    let mut ops = load_pending(dir);
    for op in ops.iter_mut().filter(|o| o.failed.is_none()) {
        op.failed = Some(reason.to_string());
        if op.kind == "install" {
            for id in &op.ids {
                let p = game.join(id);
                if p.exists() {
                    let _ = std::fs::rename(&p, game.join(format!("{id}{DISABLED}")));
                }
            }
        }
    }
    let _ = save_pending(dir, &ops);
}

/// "Tekrar dene": işaretleri kaldır, kapatılan yeni jar'ları geri aç
fn clear_failed(dir: &Path, game: &Path) -> Vec<Op> {
    let mut ops = load_pending(dir);
    for op in ops.iter_mut().filter(|o| o.failed.is_some()) {
        op.failed = None;
        if op.kind == "install" {
            for id in &op.ids {
                let off = game.join(format!("{id}{DISABLED}"));
                if off.exists() && !game.join(id).exists() {
                    let _ = std::fs::rename(&off, game.join(id));
                }
            }
        }
    }
    let _ = save_pending(dir, &ops);
    ops
}

/// Bekleyen bir değişikliği geri al; kurulmuş ama henüz yüklenmemiş dosyalar silinir
fn undo_op(dir: &Path, game: &Path, index: usize) -> Result<Vec<Op>> {
    let mut ops = load_pending(dir);
    if index < ops.len() {
        let op = ops.remove(index);
        if op.kind == "install" {
            // Henüz yüklenmedi: dosyaları sil (açılamadığı için kapatılmış olabilir)
            let _ = manage::delete(dir, game, &op.ids);
            for id in &op.ids {
                let _ = std::fs::remove_file(game.join(format!("{id}{DISABLED}")));
            }
        }
        save_pending(dir, &ops)?;
    }
    Ok(ops)
}

// ───────── Launcher arayüzü için komutlar (oyun kapalıyken de) ─────────

/// Oyun içinde bekleyen / açılamayan değişiklikler
#[tauri::command]
pub fn livemods_pending(state: tauri::State<'_, AppState>, id: String) -> Vec<Op> {
    load_pending(&state.paths.instance_dir(&id))
}

#[tauri::command]
pub fn livemods_undo(state: tauri::State<'_, AppState>, id: String, index: usize) -> Result<Vec<Op>> {
    undo_op(&state.paths.instance_dir(&id), &state.paths.instance_game_dir(&id), index)
}

/// Açılamadı işaretlerini kaldır (kapatılan jar'lar geri açılır); bir sonraki açılışta uygulanırlar
#[tauri::command]
pub fn livemods_retry(state: tauri::State<'_, AppState>, id: String) -> Vec<Op> {
    clear_failed(&state.paths.instance_dir(&id), &state.paths.instance_game_dir(&id))
}

/// Oyun kapalıyken bekleyenleri hemen uygula; uygulanamayanların açıklamalarını döner
#[tauri::command]
pub async fn livemods_apply(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<String>> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg(crate::i18n::t("Oyun açıkken değişiklikler oyunun içinden uygulanır (Mod Merkezi → Uygula).")));
    }
    Ok(apply_pending(&state, &id).await)
}

/// Arayüz için noktaların özeti (dosya listesi olmadan)
fn points_brief(dir: &Path) -> Vec<Value> {
    crate::restorepoints::list(dir)
        .into_iter()
        .map(|p| {
            let mods = p.entries.iter().filter(|e| e.enabled && e.id.starts_with("mods/")).count();
            let packs = p.entries.iter().filter(|e| e.enabled && !e.id.starts_with("mods/")).count();
            json!({ "id": p.id, "at": p.at, "label": p.label, "mods": mods, "packs": packs })
        })
        .collect()
}

/// Oyun açıkken geri dönüş: diğer bekleyenlerin yerine tek bir "geri dön" işlemi (devralmayla uygulanır)
fn queue_restore(dir: &Path, game: &Path, point: &str) -> Result<Vec<Op>> {
    let p = crate::restorepoints::get(dir, point)?;
    // Henüz yüklenmemiş kurulumlar zaten noktada yok; geri dönüş onları kapatır
    let _ = game;
    let when = chrono::DateTime::from_timestamp(p.at, 0).map(|d| d.with_timezone(&chrono::Local).format("%d.%m %H:%M").to_string()).unwrap_or_default();
    let ops = vec![Op { kind: "restore".into(), ids: vec![p.id], label: crate::i18n::tf("{0} düzenine dönülecek", &[&when]), at: chrono::Utc::now().timestamp(), failed: None }];
    save_pending(dir, &ops)?;
    Ok(ops)
}

#[tauri::command]
pub fn livemods_points(state: tauri::State<'_, AppState>, id: String) -> Vec<Value> {
    points_brief(&state.paths.instance_dir(&id))
}

/// Oyun kapalıyken hemen geri dön (önce şu anki düzen de kaydedilir)
#[tauri::command]
pub fn livemods_restore(state: tauri::State<'_, AppState>, id: String, point: String) -> Result<()> {
    if state.running.lock().contains_key(&id) {
        return Err(AppError::msg(crate::i18n::t("Oyun açıkken geri dönüş oyunun içinden yapılır (Mod Merkezi → Bekleyenler).")));
    }
    let (dir, game) = (state.paths.instance_dir(&id), state.paths.instance_game_dir(&id));
    crate::restorepoints::get(&dir, &point)?;
    crate::restorepoints::create(&dir, &game, &crate::i18n::t("Geri dönmeden önceki düzen"))?;
    crate::restorepoints::restore(&dir, &game, &point)?;
    save_pending(&dir, &[])
}

// ───────── Set paylaşımı ─────────

fn export_set(dir: &Path, game: &Path, inst: &Instance, mode_id: &str) -> Result<(String, usize)> {
    let mode = crate::instance::modes::load(dir).modes.into_iter().find(|m| m.id == mode_id).ok_or_else(|| AppError::msg(crate::i18n::t("Mod bulunamadı")))?;
    let files = manage::list(dir, game);
    crate::setshare::encode(&mode.name, &inst.mc_version, &loader_of(inst).unwrap_or_default(), &mode.enabled, &files)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub name: String,
    /// Yeni kurulan içerik sayısı
    pub installed: usize,
    /// Bu sürüm için bulunamayan projeler
    pub missing: Vec<String>,
    /// Set başka bir Minecraft sürümü/yükleyici için hazırlanmışsa onun adı
    pub other_version: Option<String>,
}

/// Kodu çöz, eksikleri Modrinth'ten kur, set olarak kaydet. in_game: yeni modlar "yeniden başlatınca yüklenir"
/// bekleyen değişikliği olarak kaydedilir (Uygula ile oyun kapanmadan geçilir).
async fn import_set(state: &AppState, inst_id: &str, code: &str, in_game: bool) -> Result<ImportReport> {
    let set = crate::setshare::decode(code)?;
    let inst = InstanceManager::new(&state.paths).get(inst_id)?;
    let (dir, game) = (state.paths.instance_dir(inst_id), state.paths.instance_game_dir(inst_id));
    let loader = loader_of(&inst);
    let other_version = (set.mc != inst.mc_version || Some(set.l.as_str()) != loader.as_deref()).then(|| format!("{} {}", set.l, set.mc));
    let ctx = InstallCtx {
        http: &state.http,
        cf_key: None,
        instance_id: inst_id,
        instance_dir: dir.clone(),
        game_dir: game.clone(),
        mc_version: inst.mc_version.clone(),
        loader: loader.clone(),
        progress: std::sync::Arc::new(|_| {}),
    };
    let mut wanted: Vec<String> = vec![];
    let (mut installed, mut new_mods, mut missing) = (0, vec![], vec![]);
    for (pids, kind, folder) in [(&set.m, Kind::Mod, "mods"), (&set.r, Kind::Resourcepack, "resourcepacks"), (&set.s, Kind::Shader, "shaderpacks")] {
        for pid in pids {
            let have: Vec<String> = manage::list(&dir, &game).into_iter().filter(|c| c.project_id.as_deref() == Some(pid.as_str())).map(|c| c.id).collect();
            if !have.is_empty() {
                wanted.extend(have);
                continue;
            }
            match install(&ctx, Source::Modrinth, pid, kind).await {
                Ok(rep) => {
                    for i in rep.installed {
                        let id = format!("{folder}/{}", i.file);
                        installed += 1;
                        if kind == Kind::Mod {
                            new_mods.push(id.clone());
                        }
                        wanted.push(id);
                    }
                }
                Err(e) => {
                    tracing::info!("paylaşılan setten kurulamadı ({pid}): {e}");
                    missing.push(pid.clone());
                }
            }
        }
    }
    // Setteki modların bağımlılıkları da açık kalmalı; West Companion her zaman açık
    let deps: Vec<String> = plan(&game, &wanted, true).into_iter().map(|x| x.0).collect();
    wanted.extend(deps);
    let all = manage::list(&dir, &game);
    let mut enabled: Vec<String> = vec![];
    let mut disabled: Vec<String> = vec![];
    for c in &all {
        if c.managed || c.id.starts_with("mods/west-companion") || wanted.contains(&c.id) {
            enabled.push(c.id.clone());
        } else {
            disabled.push(c.id.clone());
        }
    }
    let mode = crate::instance::modes::add(&dir, &set.n, "🎮", enabled, disabled)?;
    if in_game && !new_mods.is_empty() {
        let label = format!("{} {}", titles(&all, &new_mods), crate::i18n::t("eklendi (yeniden başlatınca yüklenir)"));
        push_op(&dir, "install", new_mods, &label)?;
    }
    Ok(ImportReport { name: mode.name, installed, missing, other_version })
}

#[tauri::command]
pub fn sets_export(state: tauri::State<'_, AppState>, id: String, mode_id: String) -> Result<Value> {
    let inst = InstanceManager::new(&state.paths).get(&id)?;
    let (code, skipped) = export_set(&state.paths.instance_dir(&id), &state.paths.instance_game_dir(&id), &inst, &mode_id)?;
    Ok(json!({ "code": code, "skipped": skipped }))
}

#[tauri::command]
pub async fn sets_import(state: tauri::State<'_, AppState>, id: String, code: String) -> Result<ImportReport> {
    let running = state.running.lock().contains_key(&id);
    import_set(&state, &id, &code, running).await
}

/// Günlükten çökme sebebini çıkar: önce suçlu modu adıyla, sonra Fabric'in uyumsuzluk açıklamasını,
/// sonra çökme raporundaki ilk hatayı; zararsız gürültüyü (çevrimdışı hesabın 401'i, uyarılar) atlar.
fn failure_reason(tail: &[String]) -> Option<String> {
    let clean = |l: &str| -> String {
        let l = l.trim();
        let l = l.split_once("]: ").map(|x| x.1).unwrap_or(l);
        l.chars().take(240).collect()
    };
    if let Some(m) = tail.iter().find_map(|l| l.split_once("provided by '").and_then(|(_, r)| r.split_once('\'')).map(|(m, _)| m.to_string())) {
        return Some(crate::i18n::tf("\"{0}\" modu bu oyun sürümüyle açılamıyor", &[&m]));
    }
    if let Some(i) = tail.iter().position(|l| l.contains("Incompatible mods found") || l.contains("Mod resolution failed")) {
        let details: Vec<String> = tail[i + 1..].iter().map(|l| clean(l)).filter(|l| !l.is_empty()).take(2).collect();
        let head = crate::i18n::t("Uyumsuz modlar var");
        return Some(if details.is_empty() { head } else { format!("{head}: {}", details.join(" · ")) });
    }
    let noise = |l: &str| l.contains("WARN") || l.contains("authlib") || l.contains("401") || l.contains("Realms");
    let from = tail.iter().position(|l| l.contains("---- Minecraft Crash Report ----")).unwrap_or(0);
    tail[from..]
        .iter()
        .find(|l| (l.contains("Exception") || l.contains("Error:") || l.contains("Mixin apply")) && !noise(l))
        .map(|l| clean(l))
}

/// Bekleyen değişiklikler uygulanmış olsaydı yüklenecek jar'lar: (kaynak dosya, hedef ad) ve indirilecek güncellemeler
fn staged_plan(dir: &Path, game: &Path, ops: &[Op]) -> (Vec<(PathBuf, String)>, Vec<String>) {
    if let Some(point) = ops.iter().filter(|o| o.failed.is_none() && o.kind == "restore").find_map(|o| o.ids.first()) {
        if let Ok(p) = crate::restorepoints::get(dir, point) {
            let mut files = crate::restorepoints::enabled_mods(dir, &p);
            // West Companion her zaman güncel olandan
            if let Ok(rd) = std::fs::read_dir(game.join("mods")) {
                for e in rd.flatten() {
                    let n = e.file_name().to_string_lossy().to_string();
                    if n.starts_with("west-companion") && n.ends_with(".jar") {
                        files.push((e.path(), n));
                    }
                }
            }
            return (files, vec![]);
        }
    }
    let mods = game.join("mods");
    let mut state: BTreeMap<String, (PathBuf, bool)> = BTreeMap::new();
    if let Ok(rd) = std::fs::read_dir(&mods) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let (base, enabled) = match name.strip_suffix(DISABLED) {
                Some(b) => (b.to_string(), false),
                None => (name.clone(), true),
            };
            if !base.to_ascii_lowercase().ends_with(".jar") || !e.path().is_file() {
                continue;
            }
            // Aynı adın hem açık hem kapalı kopyası varsa açık olan geçerli
            let id = format!("mods/{base}");
            if state.get(&id).map(|x| x.1).unwrap_or(false) {
                continue;
            }
            state.insert(id, (e.path(), enabled));
        }
    }
    let mut updates = Vec::new();
    for op in ops.iter().filter(|o| o.failed.is_none()) {
        for id in &op.ids {
            match op.kind.as_str() {
                "enable" => {
                    if let Some(x) = state.get_mut(id) {
                        x.1 = true;
                    }
                }
                "disable" => {
                    if let Some(x) = state.get_mut(id) {
                        x.1 = false;
                    }
                }
                "delete" => {
                    state.remove(id);
                }
                "update" => {
                    if state.contains_key(id) {
                        updates.push(id.clone());
                    }
                }
                _ => {}
            }
        }
    }
    let files = state
        .into_iter()
        .filter(|(id, (_, on))| *on && !updates.contains(id))
        .map(|(id, (src, _))| (src, id.trim_start_matches("mods/").to_string()))
        .collect();
    (files, updates)
}

/// Dosyayı hedefe sabit bağlantı (yer kaplamaz, kilitli dosyada da çalışır) ya da kopya olarak koy
fn link_or_copy(src: &Path, dest: &Path) -> std::io::Result<()> {
    if std::fs::hard_link(src, dest).is_ok() {
        return Ok(());
    }
    std::fs::copy(src, dest).map(|_| ())
}

/// Eski devralma klasörlerini temizle (kullanımdakiler silinemez, atlanır)
pub fn clean_staged(instance_dir: &Path) {
    let root = instance_dir.join(STAGED_DIR);
    if let Ok(rd) = std::fs::read_dir(&root) {
        for e in rd.flatten() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
    let _ = std::fs::remove_dir(&root);
}

/// Yeni mod düzeniyle oyunu arka planda aç (eski oyun açık kalır)
async fn start_handoff(state: &AppState, id: &str, p: &Prepared, join: Option<String>) -> Result<()> {
    let app = APP.get().cloned().ok_or_else(|| AppError::msg("uygulama hazır değil"))?;
    let dir = state.paths.instance_dir(id);
    let game = state.paths.instance_game_dir(id);
    let staged = dir.join(STAGED_DIR).join(chrono::Utc::now().timestamp_millis().to_string());
    std::fs::create_dir_all(&staged)?;
    let ops = load_pending(&dir);
    let (files, updates) = staged_plan(&dir, &game, &ops);
    {
        let staged = staged.clone();
        tokio::task::spawn_blocking(move || -> std::io::Result<()> {
            for (src, name) in files {
                link_or_copy(&src, &staged.join(name))?;
            }
            Ok(())
        })
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    }
    // Güncellemeler: yeni sürüm doğrudan geçici klasöre iner (eski dosya oyunda açık olsa da)
    if !updates.is_empty() {
        let list = manage::list(&dir, &game);
        for uid in &updates {
            let info = list.iter().find(|c| &c.id == uid).and_then(|c| c.update.clone());
            match info {
                Some(u) if !u.file_name.contains(['/', '\\']) => {
                    state.http.download(&DownloadTask { url: u.url.clone(), path: staged.join(&u.file_name), sha1: Some(u.sha1.clone()).filter(|s| !s.is_empty()), size: Some(u.size) }).await?;
                }
                _ => {
                    // Güncelleme bilgisi yoksa eski sürümle devam
                    let cur = game.join(uid);
                    if cur.exists() {
                        link_or_copy(&cur, &staged.join(uid.trim_start_matches("mods/")))?;
                    }
                }
            }
        }
    }
    let h = Arc::new(Handoff::new(join, staged.clone()));
    if let Ok(mut m) = handoffs().lock() {
        m.insert(id.to_string(), h.clone());
    }
    // Bekçi: yeni oyun takılırsa (ör. hata penceresinde beklerse) devralmayı iptal et, eski oyun açık kalsın
    {
        let h = h.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(HANDOFF_TIMEOUT_SECS)).await;
            if h.state() == "starting" && !h.promoted() {
                if let Ok(mut e) = h.error.lock() {
                    *e = Some(crate::i18n::t("Yeni oturum zamanında açılamadı"));
                }
                h.set_state("failed");
                h.cancel();
            }
        });
    }
    let extra = vec![format!("-Dfabric.modsFolder={}", staged.display()), "-Dwest.handoff=1".to_string()];
    if let Err(e) = crate::commands::launch::run_prepared(&app, id, crate::commands::launch::LaunchMode::Play, p, None, &extra, Role::Handoff(h.clone())).await {
        if let Ok(mut m) = handoffs().lock() {
            m.remove(id);
        }
        let _ = std::fs::remove_dir_all(&staged);
        return Err(e);
    }
    Ok(())
}

/// İkinci bir oyun için yeterli boş bellek var mı
fn room_for_second_game(p: &Prepared) -> bool {
    let hw = crate::java::jvm::hardware();
    hw.available_memory_mb >= p.memory_mb + 1536
}

// ───────── Köprü uç noktaları ─────────

fn param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == name).then(|| crate::bridge::decode_query(v))
    })
}

fn ids_of(body: &Value) -> Vec<String> {
    body["ids"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).filter(|s| !s.contains("..")).collect()).unwrap_or_default()
}

fn kind_of(id: &str) -> &str {
    id.split_once('/').map(|x| x.0).unwrap_or("")
}

fn is_mod(id: &str) -> bool {
    kind_of(id) == "mods"
}

/// Mod jar'larının kimlikleri ve bağımlılıkları (kapalılar dahil)
struct ModMeta {
    id: String,
    title: String,
    enabled: bool,
    provides: BTreeSet<String>,
    depends: BTreeSet<String>,
}

fn mod_meta(game: &Path) -> Vec<ModMeta> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(game.join("mods")) else { return out };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let (base, enabled) = match name.strip_suffix(DISABLED) {
            Some(b) => (b.to_string(), false),
            None => (name.clone(), true),
        };
        if !base.ends_with(".jar") || base.starts_with(crate::companion::JAR_PREFIX) {
            continue;
        }
        if let Ok(m) = crate::crash::modinfo::read_mod(&e.path()) {
            out.push(ModMeta { id: format!("mods/{base}"), title: m.name.clone(), enabled, provides: m.provides, depends: m.depends });
        }
    }
    out
}

const BUILTIN: &[&str] = &["minecraft", "java", "fabricloader", "fabric", "quilt_loader", "quilted_fabric_api"];

/// Açma/kapamanın birlikte etkilediği modlar: kapatılırken ona bağlı olanlar, açılırken onun ihtiyaç duyduğu kapalılar.
fn plan(game: &Path, ids: &[String], enabled: bool) -> Vec<(String, String)> {
    let meta = mod_meta(game);
    let mut chosen: Vec<String> = ids.iter().filter(|i| is_mod(i)).cloned().collect();
    let mut seen: HashSet<String> = chosen.iter().cloned().collect();
    let mut i = 0;
    while i < chosen.len() {
        let cur = chosen[i].clone();
        i += 1;
        let Some(m) = meta.iter().find(|m| m.id == cur) else { continue };
        if !enabled {
            let found: Vec<String> = meta.iter().filter(|o| o.enabled && !seen.contains(&o.id) && o.depends.iter().any(|d| m.provides.contains(d))).map(|o| o.id.clone()).collect();
            for id in found {
                seen.insert(id.clone());
                chosen.push(id);
            }
        } else {
            for d in m.depends.iter().filter(|d| !BUILTIN.contains(&d.as_str())) {
                if meta.iter().any(|o| o.enabled && o.provides.contains(d)) {
                    continue;
                }
                if let Some(o) = meta.iter().find(|o| !o.enabled && o.provides.contains(d) && !seen.contains(&o.id)) {
                    seen.insert(o.id.clone());
                    chosen.push(o.id.clone());
                }
            }
        }
    }
    let extra: Vec<(String, String)> = chosen
        .into_iter()
        .filter(|c| !ids.contains(c))
        .map(|c| {
            let t = meta.iter().find(|m| m.id == c).map(|m| m.title.clone()).unwrap_or_else(|| c.clone());
            (c, t)
        })
        .collect();
    extra
}

fn on_disk_enabled(game: &Path, id: &str) -> Option<bool> {
    let p = game.join(id);
    if p.exists() {
        return Some(true);
    }
    let off = game.join(format!("{id}{DISABLED}"));
    off.exists().then_some(false)
}

fn push_toggle(dir: &Path, game: &Path, ids: &[String], enabled: bool, label: &str) -> Result<()> {
    let mut ops = load_pending(dir);
    // Aynı dosyalar için önceki aç/kapa kayıtlarını kaldır (son karar geçerli)
    for op in ops.iter_mut().filter(|o| o.kind == "enable" || o.kind == "disable") {
        op.ids.retain(|i| !ids.contains(i));
    }
    ops.retain(|o| !o.ids.is_empty());
    let need: Vec<String> = ids.iter().filter(|i| on_disk_enabled(game, i) != Some(enabled)).cloned().collect();
    if !need.is_empty() {
        ops.push(Op { kind: if enabled { "enable".into() } else { "disable".into() }, ids: need, label: label.to_string(), at: chrono::Utc::now().timestamp(), failed: None });
    }
    save_pending(dir, &ops)
}

fn push_op(dir: &Path, kind: &str, ids: Vec<String>, label: &str) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut ops = load_pending(dir);
    ops.push(Op { kind: kind.into(), ids, label: label.to_string(), at: chrono::Utc::now().timestamp(), failed: None });
    save_pending(dir, &ops)
}

fn titles(list: &[manage::ContentFile], ids: &[String]) -> String {
    let names: Vec<String> = ids.iter().map(|i| list.iter().find(|c| &c.id == i).map(|c| c.title.clone()).unwrap_or_else(|| i.rsplit('/').next().unwrap_or(i).to_string())).collect();
    match names.len() {
        0 => String::new(),
        1..=2 => names.join(", "),
        n => format!("{}, {} +{}", names[0], names[1], n - 2),
    }
}

fn loader_of(inst: &Instance) -> Option<String> {
    crate::commands::content::loader_slug(inst.loader.kind)
}

pub async fn route(method: &str, path: &str, query: &str, body: &Value) -> Result<Value> {
    let app = APP.get().ok_or_else(|| AppError::msg("launcher hazır değil"))?;
    let state = app.state::<AppState>();
    let inst_id = param(query, "inst").unwrap_or_default();
    if inst_id.is_empty() || inst_id.contains(['/', '\\', '.']) {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let inst = InstanceManager::new(&state.paths).get(&inst_id)?;
    let dir = state.paths.instance_dir(&inst_id);
    let game = state.paths.instance_game_dir(&inst_id);

    match (method, path) {
        ("GET", "/mods/list") => {
            let (d, g) = (dir.clone(), game.clone());
            let list = tokio::task::spawn_blocking(move || manage::list(&d, &g)).await.map_err(|e| AppError::msg(e.to_string()))?;
            let g2 = game.clone();
            let meta = tokio::task::spawn_blocking(move || mod_meta(&g2)).await.unwrap_or_default();
            let items: Vec<Value> = list
                .iter()
                .map(|c| {
                    let mut v = serde_json::to_value(c).unwrap_or(Value::Null);
                    if let Some(m) = meta.iter().find(|m| m.id == c.id) {
                        v["modIds"] = json!(m.provides.iter().collect::<Vec<_>>());
                    }
                    v
                })
                .collect();
            Ok(json!({ "items": items, "pending": load_pending(&dir), "mc": inst.mc_version, "loader": loader_of(&inst) }))
        }
        ("POST", "/mods/refresh") => {
            let loader = loader_of(&inst);
            manage::refresh(&state.http, &dir, &game, &inst.mc_version, loader.as_deref()).await?;
            Ok(json!({ "ok": true }))
        }
        ("POST", "/mods/plan") => {
            let ids = ids_of(body);
            let enabled = body["enabled"].as_bool().unwrap_or(true);
            let extra = plan(&game, &ids, enabled);
            Ok(json!({ "extra": extra.iter().map(|(id, t)| json!({ "id": id, "title": t })).collect::<Vec<_>>() }))
        }
        ("POST", "/mods/toggle") => {
            let mut ids = ids_of(body);
            let enabled = body["enabled"].as_bool().unwrap_or(true);
            if body["withRelated"].as_bool().unwrap_or(true) {
                ids.extend(plan(&game, &ids, enabled).into_iter().map(|x| x.0));
            }
            let list = manage::list(&dir, &game);
            let (mods, now): (Vec<String>, Vec<String>) = ids.into_iter().partition(|i| is_mod(i));
            if !now.is_empty() {
                manage::set_enabled(&game, &now, enabled)?;
            }
            if !mods.is_empty() {
                let label = format!("{} {}", titles(&list, &mods), if enabled { crate::i18n::t("açılacak") } else { crate::i18n::t("kapanacak") });
                push_toggle(&dir, &game, &mods, enabled, &label)?;
            }
            Ok(json!({ "live": now, "pending": load_pending(&dir) }))
        }
        ("POST", "/mods/delete") => {
            let ids = ids_of(body);
            let list = manage::list(&dir, &game);
            let (mods, now): (Vec<String>, Vec<String>) = ids.into_iter().partition(|i| is_mod(i));
            if !now.is_empty() {
                manage::delete(&dir, &game, &now)?;
            }
            let label = format!("{} {}", titles(&list, &mods), crate::i18n::t("silinecek"));
            push_op(&dir, "delete", mods, &label)?;
            Ok(json!({ "live": now, "pending": load_pending(&dir) }))
        }
        ("POST", "/mods/update") => {
            let ids = ids_of(body);
            let list = manage::list(&dir, &game);
            let (mods, now): (Vec<String>, Vec<String>) = ids.into_iter().partition(|i| is_mod(i));
            let mut updated = Vec::new();
            if !now.is_empty() {
                let backups = state.paths.backups().join(&inst_id);
                updated = manage::update(&state.http, &dir, &game, &backups, &now, |_, _| {}).await?.updated;
            }
            let label = format!("{} {}", titles(&list, &mods), crate::i18n::t("güncellenecek"));
            push_op(&dir, "update", mods, &label)?;
            Ok(json!({ "live": updated, "pending": load_pending(&dir) }))
        }
        ("GET", "/mods/search") => {
            let kind = param(query, "kind").unwrap_or_else(|| "mod".into());
            let (k, loader) = match kind.as_str() {
                "resourcepack" => (Kind::Resourcepack, None),
                "shader" => (Kind::Shader, None),
                "datapack" => (Kind::Mod, Some("datapack".to_string())),
                _ => (Kind::Mod, loader_of(&inst)),
            };
            let q = SearchQuery {
                query: param(query, "q").unwrap_or_default(),
                kind: Some(k),
                game_version: Some(inst.mc_version.clone()),
                loader,
                sort: param(query, "sort"),
                limit: Some(20),
                offset: param(query, "offset").and_then(|o| o.parse().ok()),
                sources: Some(vec![Source::Modrinth]),
                categories: param(query, "cat").filter(|c| !c.is_empty()).map(|c| vec![c]),
                environment: None,
            };
            let r = content::search(&state.http, None, &q).await?;
            let installed: HashSet<String> = content::load_index(&dir).into_iter().map(|c| c.project_id).collect();
            let hits: Vec<Value> = r
                .hits
                .into_iter()
                .map(|h| {
                    let mut v = serde_json::to_value(&h).unwrap_or(Value::Null);
                    v["installed"] = json!(installed.contains(&h.id));
                    v
                })
                .collect();
            Ok(json!({ "hits": hits, "total": r.total }))
        }
        ("GET", "/mods/project") => {
            let id = param(query, "id").unwrap_or_default();
            let mut detail = modrinth::project_detail(&state.http, &id).await?;
            let loader = match param(query, "kind").as_deref() {
                Some("datapack") => Some("datapack".to_string()),
                Some("mod") | None => loader_of(&inst),
                _ => None,
            };
            let compatible = modrinth::best_version(&state.http, &id, &inst.mc_version, loader.as_deref()).await.ok();
            detail["compatible"] = compatible.map(|v| json!({ "id": v.id, "name": v.name, "number": v.version_number, "type": v.version_type })).unwrap_or(Value::Null);
            detail["installed"] = json!(content::load_index(&dir).iter().any(|c| c.project_id == id));
            Ok(detail)
        }
        ("POST", "/mods/install") => {
            let pid = body["projectId"].as_str().unwrap_or_default().to_string();
            if pid.is_empty() || pid.contains(['/', '\\', '.']) {
                return Err(AppError::msg(crate::i18n::t("Geçersiz proje")));
            }
            let kind = body["kind"].as_str().unwrap_or("mod");
            if kind == "datapack" {
                let world = body["world"].as_str().unwrap_or_default();
                if world.is_empty() || world.contains(['/', '\\']) || world.contains("..") {
                    return Err(AppError::msg(crate::i18n::t("Veri paketi için tek oyunculu bir dünyada olmalısın")));
                }
                let v = modrinth::best_version(&state.http, &pid, &inst.mc_version, Some("datapack")).await?;
                let f = v.files.iter().find(|f| f.primary).or_else(|| v.files.first()).ok_or_else(|| AppError::msg(crate::i18n::t("İndirilecek dosya yok")))?;
                let dest = game.join("saves").join(world).join("datapacks").join(&f.filename);
                state.http.download(&DownloadTask { url: f.url.clone(), path: dest, sha1: f.hashes.get("sha1").cloned(), size: Some(f.size) }).await?;
                return Ok(json!({ "file": f.filename, "live": true }));
            }
            let k = match kind {
                "resourcepack" => Kind::Resourcepack,
                "shader" => Kind::Shader,
                _ => Kind::Mod,
            };
            let ctx = InstallCtx {
                http: &state.http,
                cf_key: None,
                instance_id: &inst_id,
                instance_dir: dir.clone(),
                game_dir: game.clone(),
                mc_version: inst.mc_version.clone(),
                loader: loader_of(&inst),
                progress: std::sync::Arc::new(|_| {}),
            };
            let rep = install(&ctx, Source::Modrinth, &pid, k).await?;
            if k == Kind::Mod {
                let ids: Vec<String> = rep.installed.iter().map(|i| format!("mods/{}", i.file)).collect();
                let label = format!("{} {}", rep.installed.first().map(|i| i.title.clone()).unwrap_or_default(), crate::i18n::t("eklendi (yeniden başlatınca yüklenir)"));
                push_op(&dir, "install", ids, &label)?;
            }
            Ok(json!({ "report": rep, "pending": load_pending(&dir) }))
        }
        ("POST", "/mods/add") => {
            // Oyun penceresine sürüklenip bırakılan dosyalar
            let paths: Vec<String> = body["paths"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
            let added = manage::add_files(&game, &paths)?;
            let mods: Vec<String> = added.iter().filter(|i| is_mod(i)).cloned().collect();
            let label = format!("{} {}", mods.iter().map(|m| m.rsplit('/').next().unwrap_or(m)).collect::<Vec<_>>().join(", "), crate::i18n::t("eklendi (yeniden başlatınca yüklenir)"));
            push_op(&dir, "install", mods, &label)?;
            Ok(json!({ "added": added, "pending": load_pending(&dir) }))
        }
        // Mod setleri (launcher'daki "oyun modları"): listele, şu anki düzeni kaydet, oyun açıkken geç
        ("GET", "/mods/sets") => {
            let mut m = crate::instance::modes::load(&dir);
            m.active = crate::instance::modes::matching(&dir, &game);
            Ok(serde_json::to_value(m)?)
        }
        ("POST", "/mods/sets/save") => {
            let name = body["name"].as_str().unwrap_or_default();
            let icon = body["icon"].as_str().unwrap_or("🎮");
            let m = crate::instance::modes::capture(&dir, &game, None, name, icon, true)?;
            Ok(serde_json::to_value(m)?)
        }
        ("POST", "/mods/sets/switch") => {
            let mode_id = body["modeId"].as_str().unwrap_or_default().to_string();
            let (enable, disable) = crate::instance::modes::plan_switch(&dir, &game, &mode_id)?;
            // Paketler ve shader'lar hemen (oyun yeniden yükler); modlar bekleyen değişiklik olur
            let (mods_on, live_on): (Vec<String>, Vec<String>) = enable.into_iter().partition(|i| is_mod(i));
            let (mods_off, live_off): (Vec<String>, Vec<String>) = disable.into_iter().partition(|i| is_mod(i));
            if !live_on.is_empty() {
                manage::set_enabled(&game, &live_on, true)?;
            }
            // Kapatılacak paketler oyunda açık olabilir (Windows kilidi): onları oyun bırakınca kapatır
            let list = manage::list(&dir, &game);
            let name = crate::instance::modes::load(&dir).modes.into_iter().find(|m| m.id == mode_id).map(|m| m.name).unwrap_or_default();
            if !mods_on.is_empty() {
                push_toggle(&dir, &game, &mods_on, true, &crate::i18n::tf("{0}: {1} açılacak", &[&name, &titles(&list, &mods_on)]))?;
            }
            if !mods_off.is_empty() {
                push_toggle(&dir, &game, &mods_off, false, &crate::i18n::tf("{0}: {1} kapanacak", &[&name, &titles(&list, &mods_off)]))?;
            }
            crate::instance::modes::set_active(&dir, &mode_id)?;
            Ok(json!({ "liveOn": live_on, "liveOff": live_off, "mods": mods_on.len() + mods_off.len(), "pending": load_pending(&dir) }))
        }
        // Geri dönüş noktaları
        ("GET", "/mods/points") => Ok(json!({ "points": points_brief(&dir) })),
        ("POST", "/mods/points/restore") => {
            let point = body["id"].as_str().unwrap_or_default().to_string();
            Ok(json!({ "pending": queue_restore(&dir, &game, &point)? }))
        }
        // Set paylaşımı (kodla)
        ("POST", "/mods/sets/export") => {
            let (code, skipped) = export_set(&dir, &game, &inst, body["modeId"].as_str().unwrap_or_default())?;
            Ok(json!({ "code": code, "skipped": skipped }))
        }
        ("POST", "/mods/sets/import") => {
            let r = import_set(&state, &inst_id, body["code"].as_str().unwrap_or_default(), true).await?;
            Ok(json!({ "name": r.name, "installed": r.installed, "missing": r.missing, "otherVersion": r.other_version, "pending": load_pending(&dir) }))
        }
        ("POST", "/mods/retry") => Ok(json!({ "pending": clear_failed(&dir, &game) })),
        ("GET", "/mods/pending") => Ok(json!({ "pending": load_pending(&dir) })),
        ("POST", "/mods/undo") => {
            let idx = body["index"].as_u64().unwrap_or(u64::MAX) as usize;
            Ok(json!({ "pending": undo_op(&dir, &game, idx)? }))
        }
        ("POST", "/mods/restart") => {
            let join = body["join"].as_str().map(String::from).filter(|s| !s.is_empty() && s.len() < 300);
            // Tercihen devralma: oyun kapanmadan yeni mod düzeni arka planda açılır
            if body["handoff"].as_bool().unwrap_or(true) {
                let running = handoffs().lock().ok().and_then(|m| m.get(&inst_id).cloned()).filter(|h| !h.promoted() && !h.failed());
                if running.is_some() {
                    return Ok(json!({ "mode": "handoff" }));
                }
                let prepared = last().lock().ok().and_then(|m| m.get(&inst_id).cloned());
                if let Some(p) = prepared.filter(room_for_second_game) {
                    match start_handoff(&state, &inst_id, &p, join.clone()).await {
                        Ok(()) => return Ok(json!({ "mode": "handoff" })),
                        Err(e) => tracing::warn!("devralma başlatılamadı, klasik yeniden başlatmaya geçiliyor: {e}"),
                    }
                }
            }
            restarts().lock().map_err(|_| AppError::msg("kilit"))?.insert(inst_id.clone(), join);
            Ok(json!({ "mode": "restart" }))
        }
        // Eski oyun: devralma ne durumda (hazırsa kapanır, çöktüyse açık kalır)
        ("GET", "/mods/restart-status") => {
            let h = handoffs().lock().ok().and_then(|m| m.get(&inst_id).cloned());
            Ok(match h {
                Some(h) => json!({ "state": h.state(), "error": h.error.lock().ok().and_then(|e| e.clone()), "secs": h.started.elapsed().as_secs() }),
                None => json!({ "state": "none" }),
            })
        }
        ("POST", "/mods/handoff/cancel") => {
            if let Some(h) = handoffs().lock().ok().and_then(|m| m.get(&inst_id).cloned()).filter(|h| !h.promoted()) {
                if let Ok(mut e) = h.error.lock() {
                    *e = Some(crate::i18n::t("İptal edildi"));
                }
                h.cancelled.store(true, Ordering::SeqCst);
                h.set_state("failed");
                h.cancel();
            }
            Ok(json!({ "ok": true }))
        }
        // Yeni oyun: ana menüye ulaştım (modlar sorunsuz yüklendi)
        ("POST", "/mods/handoff/ready") => {
            let h = handoffs().lock().ok().and_then(|m| m.get(&inst_id).cloned());
            if let Some(h) = h {
                if h.state() == "starting" {
                    h.set_state(if h.promoted() { "go" } else { "ready" });
                }
                tracing::info!("devralma: yeni oturum hazır ({} ms)", h.started.elapsed().as_millis());
            }
            Ok(json!({ "ok": true }))
        }
        // Yeni oyun: eski oyun kapandı mı, nereye gireyim
        ("GET", "/mods/handoff/status") => {
            let h = handoffs().lock().ok().and_then(|m| m.get(&inst_id).cloned());
            Ok(match h {
                Some(h) => json!({ "state": h.state(), "join": h.join }),
                None => json!({ "state": "none" }),
            })
        }
        ("GET", "/mods/icon") => {
            let url = param(query, "url").unwrap_or_default();
            if !url.starts_with("https://") {
                return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
            }
            if let Some(hit) = ICONS.get_or_init(Default::default).lock().ok().and_then(|m| m.get(&url).cloned()) {
                return Ok(json!({ "png": hit }));
            }
            let bytes = state.http.client.get(&url).timeout(std::time::Duration::from_secs(15)).send().await?.error_for_status()?.bytes().await?;
            let png = tokio::task::spawn_blocking(move || -> Result<String> {
                use base64::Engine;
                let img = image::load_from_memory(&bytes).map_err(|e| AppError::msg(e.to_string()))?;
                let thumb = img.resize_to_fill(64, 64, image::imageops::FilterType::Triangle);
                let mut out = std::io::Cursor::new(Vec::new());
                thumb.write_to(&mut out, image::ImageFormat::Png).map_err(|e| AppError::msg(e.to_string()))?;
                Ok(base64::engine::general_purpose::STANDARD.encode(out.into_inner()))
            })
            .await
            .map_err(|e| AppError::msg(e.to_string()))??;
            if let Ok(mut m) = ICONS.get_or_init(Default::default).lock() {
                if m.len() > 400 {
                    m.clear();
                }
                m.insert(url, png.clone());
            }
            Ok(json!({ "png": png }))
        }
        _ => Err(AppError::msg("bilinmeyen istek")),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn staged_plan_applies_pending_ops() {
        let tmp = std::env::temp_dir().join(format!("west-staged-{}", std::process::id()));
        let mods = tmp.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        for f in ["sodium.jar", "lithium.jar", "modmenu.jar.disabled", "iris.jar", "old.jar", "readme.txt"] {
            std::fs::write(mods.join(f), b"x").unwrap();
        }
        let op = |kind: &str, ids: &[&str]| Op { kind: kind.into(), ids: ids.iter().map(|s| s.to_string()).collect(), label: String::new(), at: 0, failed: None };
        let ops = vec![op("enable", &["mods/modmenu.jar"]), op("disable", &["mods/iris.jar"]), op("delete", &["mods/old.jar"]), op("update", &["mods/lithium.jar"])];
        let (files, updates) = staged_plan(&tmp, &tmp, &ops);
        let names: Vec<&str> = files.iter().map(|f| f.1.as_str()).collect();
        assert_eq!(names, vec!["modmenu.jar", "sodium.jar"]);
        assert!(files[0].0.ends_with("modmenu.jar.disabled"));
        assert_eq!(updates, vec!["mods/lithium.jar".to_string()]);
        // Kapatma geri alınırsa (op yok) dosya olduğu gibi kalır
        let (files, _) = staged_plan(&tmp, &tmp, &[]);
        assert_eq!(files.len(), 4);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn failed_ops_are_kept_and_skipped() {
        let tmp = std::env::temp_dir().join(format!("west-failed-{}", std::process::id()));
        let (dir, game) = (tmp.clone(), tmp.join("minecraft"));
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods/bad.jar"), b"x").unwrap();
        std::fs::write(game.join("mods/good.jar"), b"x").unwrap();
        push_op(&dir, "install", vec!["mods/bad.jar".into()], "bad").unwrap();
        mark_failed(&dir, &game, "\"bad\" modu bu oyun sürümüyle açılamıyor");
        assert!(game.join("mods/bad.jar.disabled").exists() && !game.join("mods/bad.jar").exists());
        let ops = load_pending(&dir);
        assert_eq!(ops[0].failed.as_deref(), Some("\"bad\" modu bu oyun sürümüyle açılamıyor"));
        // Başarısız değişiklik devralmaya katılmaz
        let (files, _) = staged_plan(&dir, &game, &ops);
        assert_eq!(files.iter().map(|f| f.1.as_str()).collect::<Vec<_>>(), vec!["good.jar"]);
        // Tekrar dene: işaret kalkar, dosya geri açılır
        let ops = clear_failed(&dir, &game);
        assert!(ops[0].failed.is_none() && game.join("mods/bad.jar").exists());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn failure_reason_finds_meaningful_line() {
        let l = |s: &str| s.to_string();
        // Suçlu mod adıyla (çevrimdışı hesabın zararsız 401'i atlanır)
        let tail = vec![
            l("com.mojang.authlib.exceptions.InvalidCredentialsException: Status: 401"),
            l("---- Minecraft Crash Report ----"),
            l("java.lang.RuntimeException: Could not execute entrypoint stage 'client' due to errors, provided by 'modmenu' at 'com.terraformersmc.modmenu.ModMenu'!"),
        ];
        assert_eq!(failure_reason(&tail).unwrap(), "\"modmenu\" modu bu oyun sürümüyle açılamıyor");
        // Fabric uyumsuzluk açıklaması
        let tail = vec![l("[12:00:03] [main/ERROR]: Incompatible mods found!"), l(" - Mod 'Mod Menu' (modmenu) 11.0.5 requires minecraft 1.21.1"), l("")];
        assert_eq!(failure_reason(&tail).unwrap(), "Uyumsuz modlar var: - Mod 'Mod Menu' (modmenu) 11.0.5 requires minecraft 1.21.1");
        // Çökme raporundaki ilk gerçek hata
        let tail = vec![l("[main/WARN]: Exception in thing that is fine"), l("---- Minecraft Crash Report ----"), l("java.lang.IllegalStateException: boom")];
        assert_eq!(failure_reason(&tail).unwrap(), "java.lang.IllegalStateException: boom");
        assert!(failure_reason(&[l("hepsi yolunda")]).is_none());
    }

    use super::*;

    #[test]
    fn toggles_collapse_and_skip_noops() {
        let root = std::env::temp_dir().join(format!("west-live-{}", uuid::Uuid::new_v4()));
        let game = root.join("minecraft");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        std::fs::write(game.join("mods/a.jar"), b"x").unwrap();
        // Açık modu kapat → bekleyen; sonra geri aç → bekleyen kalmaz (dosya zaten açık)
        push_toggle(&root, &game, &["mods/a.jar".into()], false, "a").unwrap();
        assert_eq!(load_pending(&root).len(), 1);
        push_toggle(&root, &game, &["mods/a.jar".into()], true, "a").unwrap();
        assert!(load_pending(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
