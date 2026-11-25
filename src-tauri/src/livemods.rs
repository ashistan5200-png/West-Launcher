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
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

static APP: OnceLock<AppHandle> = OnceLock::new();
/// instance → yeniden başlatma planı (Some(katılma hedefi) / None: ana menü)
static RESTART: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
static ICONS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

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
    for op in &ops {
        let r = match op.kind.as_str() {
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
    let _ = save_pending(&dir, &[]);
    errors
}

/// Oyun kapanırken çağrılır: yeniden başlatma istendi mi (katılma hedefiyle)
pub fn take_restart(id: &str) -> Option<Option<String>> {
    restarts().lock().ok()?.remove(id)
}

/// Oyun kapandıktan sonra: bekleyenleri uygula, istenmişse launcher arayüzüne yeniden başlatma olayı gönder.
pub fn on_game_exit(id: &str) {
    let Some(app) = APP.get().cloned() else { return };
    let id = id.to_string();
    let restart = take_restart(&id);
    tauri::async_runtime::spawn(async move {
        let st = app.state::<AppState>();
        let errors = apply_pending(&st, &id).await;
        if let Some(join) = restart {
            let _ = app.emit(EV_RELAUNCH, json!({ "instanceId": id, "join": join, "errors": errors }));
        }
    });
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
        ops.push(Op { kind: if enabled { "enable".into() } else { "disable".into() }, ids: need, label: label.to_string(), at: chrono::Utc::now().timestamp() });
    }
    save_pending(dir, &ops)
}

fn push_op(dir: &Path, kind: &str, ids: Vec<String>, label: &str) -> Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut ops = load_pending(dir);
    ops.push(Op { kind: kind.into(), ids, label: label.to_string(), at: chrono::Utc::now().timestamp() });
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
        ("GET", "/mods/pending") => Ok(json!({ "pending": load_pending(&dir) })),
        ("POST", "/mods/undo") => {
            let idx = body["index"].as_u64().unwrap_or(u64::MAX) as usize;
            let mut ops = load_pending(&dir);
            if idx < ops.len() {
                let op = ops.remove(idx);
                if op.kind == "install" {
                    // Henüz yüklenmedi: dosyaları sil
                    let _ = manage::delete(&dir, &game, &op.ids);
                }
                save_pending(&dir, &ops)?;
            }
            Ok(json!({ "pending": ops }))
        }
        ("POST", "/mods/restart") => {
            let join = body["join"].as_str().map(String::from).filter(|s| !s.is_empty() && s.len() < 300);
            restarts().lock().map_err(|_| AppError::msg("kilit"))?.insert(inst_id.clone(), join);
            Ok(json!({ "ok": true }))
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
