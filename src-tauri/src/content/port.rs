//! Ashi Taşıyıcı: bir instance'ı başka bir Minecraft sürümüne taşır.
//!
//! Eski instance'a dokunulmaz; yeni sürümde ayrı bir kopya oluşturulur. Her içerik için
//! Modrinth'te hedef sürüme uyan en son sürüm SHA-1 ile toplu olarak bulunur:
//!   - bulunan     → yeni sürümü indirilir, eskisi kaldırılır
//!   - bulunamayan → kullanıcının seçimine göre silinir ya da kapalı olarak tutulur
//! Son olarak yeni sürümlerin istediği, pakette olmayan zorunlu bağımlılıklar kurulur.

use super::install::{install, InstallCtx};
use super::manage::{list, resolve, ContentFile};
use super::{load_index, save_index, Kind, Source};
use crate::core::http::{DownloadTask, Http};
use crate::core::{report, ProgressFn};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const MODRINTH: &str = "https://api.modrinth.com/v2";
const DISABLED: &str = ".disabled";

#[derive(Deserialize, Clone)]
struct MrFile {
    hashes: HashMap<String, String>,
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    size: u64,
}
#[derive(Deserialize, Clone)]
struct MrDep {
    project_id: Option<String>,
    dependency_type: String,
}
#[derive(Deserialize, Clone)]
struct MrVersion {
    id: String,
    project_id: String,
    version_number: String,
    files: Vec<MrFile>,
    #[serde(default)]
    dependencies: Vec<MrDep>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortItem {
    pub id: String,
    pub title: String,
    pub kind: Kind,
    pub icon: Option<String>,
    pub enabled: bool,
    pub from_version: Option<String>,
    /// "ok": hedef sürümde uyumlu sürüm var · "same": dosya zaten uyumlu · "missing": uyumlu sürüm yok
    /// · "unknown": Modrinth'te tanınmayan (elle eklenmiş) dosya
    pub status: &'static str,
    pub to_version: Option<String>,
}

fn loaders_for(kind: Kind, loader: Option<&str>) -> Vec<String> {
    match kind {
        Kind::Mod => loader.map(|l| {
            // Quilt, Fabric modlarını da çalıştırır
            if l == "quilt" { vec!["quilt".into(), "fabric".into()] } else { vec![l.to_string()] }
        }).unwrap_or_default(),
        Kind::Resourcepack => vec!["minecraft".into()],
        Kind::Shader => vec!["iris".into(), "optifine".into(), "canvas".into(), "vanilla".into()],
        Kind::Modpack => vec![],
    }
}

/// Hedef sürüm için her içeriğin karşılığını bulur: sha1 → Modrinth sürümü.
async fn lookup(http: &Http, items: &[ContentFile], mc: &str, loader: Option<&str>) -> Result<HashMap<String, MrVersion>> {
    let mut out = HashMap::new();
    for kind in [Kind::Mod, Kind::Resourcepack, Kind::Shader] {
        let hashes: Vec<&str> = items.iter().filter(|c| c.kind == kind).map(|c| c.sha1.as_str()).collect();
        if hashes.is_empty() || (kind == Kind::Mod && loader.is_none()) {
            continue;
        }
        let body = serde_json::json!({ "hashes": hashes, "algorithm": "sha1", "loaders": loaders_for(kind, loader), "game_versions": [mc] });
        let resp = http
            .client
            .post(format!("{MODRINTH}/version_files/update"))
            .json(&body)
            .send()
            .await
            .map_err(|_| AppError::msg("Modrinth'e ulaşılamadı; internet bağlantını kontrol et"))?
            .error_for_status()?;
        out.extend(resp.json::<HashMap<String, MrVersion>>().await.unwrap_or_default());
    }
    Ok(out)
}

fn primary(v: &MrVersion) -> Option<&MrFile> {
    v.files.iter().find(|f| f.primary).or_else(|| v.files.first())
}

/// Taşıma planı: hangi içerik yeni sürüme gelebilir, hangisi gelemez.
pub async fn plan(http: &Http, instance_dir: &Path, game_dir: &Path, mc: &str, loader: Option<&str>) -> Result<Vec<PortItem>> {
    let items: Vec<ContentFile> = list(instance_dir, game_dir).into_iter().filter(|c| !c.managed).collect();
    let found = lookup(http, &items, mc, loader).await?;
    let mut out: Vec<PortItem> = items
        .iter()
        .map(|c| {
            let v = found.get(&c.sha1);
            let status = match v {
                Some(v) if primary(v).and_then(|f| f.hashes.get("sha1")).map(|h| h.eq_ignore_ascii_case(&c.sha1)).unwrap_or(false) => "same",
                Some(_) => "ok",
                None if c.project_id.is_none() => "unknown",
                None => "missing",
            };
            PortItem {
                id: c.id.clone(),
                title: c.title.clone(),
                kind: c.kind,
                icon: c.icon.clone(),
                enabled: c.enabled,
                from_version: c.version.clone(),
                status,
                to_version: v.map(|v| v.version_number.clone()),
            }
        })
        .collect();
    // Önce sorunlular, sonra ada göre
    let rank = |s: &str| match s { "missing" => 0, "unknown" => 1, "ok" => 2, _ => 3 };
    out.sort_by(|a, b| rank(a.status).cmp(&rank(b.status)).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(out)
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortReport {
    pub ported: Vec<String>,
    pub removed: Vec<String>,
    pub kept_disabled: Vec<String>,
    pub dependencies: Vec<String>,
    pub failed: Vec<String>,
}

/// Yeni (kopyalanmış) instance'ın içeriklerini hedef sürüme çevirir.
/// `keep_disabled`: uyumlu sürümü olmayan ama silinmesi istenmeyen içerikler (kapalı tutulur).
#[allow(clippy::too_many_arguments)]
pub async fn apply(
    http: &Http,
    cf_key: Option<&str>,
    new_id: &str,
    instance_dir: &Path,
    game_dir: &Path,
    mc: &str,
    loader: Option<String>,
    keep_disabled: &HashSet<String>,
    progress: ProgressFn,
) -> Result<PortReport> {
    let task = format!("port:{new_id}");
    let items: Vec<ContentFile> = list(instance_dir, game_dir).into_iter().filter(|c| !c.managed).collect();
    let found = lookup(http, &items, mc, loader.as_deref()).await?;
    let mut index = load_index(instance_dir);
    let mut rep = PortReport::default();
    let mut present: HashSet<String> = HashSet::new();
    let mut deps: HashSet<String> = HashSet::new();

    let total = items.len() as u64;
    for (n, c) in items.iter().enumerate() {
        p(&progress, &task, "port", n as u64, total, &c.title);
        let base = c.id.split_once('/').map(|x| x.1).unwrap_or(&c.id).to_string();
        let folder = c.id.split_once('/').map(|x| x.0).unwrap_or("mods").to_string();
        match found.get(&c.sha1) {
            Some(v) => {
                present.insert(v.project_id.clone());
                for d in v.dependencies.iter().filter(|d| d.dependency_type == "required") {
                    if let Some(pid) = &d.project_id {
                        deps.insert(pid.clone());
                    }
                }
                let Some(f) = primary(v) else { continue };
                let same = f.hashes.get("sha1").map(|h| h.eq_ignore_ascii_case(&c.sha1)).unwrap_or(false);
                if same {
                    rep.ported.push(c.title.clone());
                    continue;
                }
                let r: Result<()> = async {
                    if f.filename.contains(['/', '\\']) || f.filename.contains("..") || !f.url.starts_with("https://") {
                        return Err(AppError::msg("Geçersiz dosya"));
                    }
                    let (old, enabled) = resolve(game_dir, &c.id)?;
                    let target = game_dir.join(&folder).join(if enabled { f.filename.clone() } else { format!("{}{DISABLED}", f.filename) });
                    http.download(&DownloadTask { url: f.url.clone(), path: target.clone(), sha1: f.hashes.get("sha1").cloned(), size: Some(f.size) }).await?;
                    if old != target {
                        std::fs::remove_file(&old)?;
                    }
                    match index.iter_mut().find(|i| i.file == base) {
                        Some(i) => {
                            i.file = f.filename.clone();
                            i.version_id = v.id.clone();
                            i.project_id = v.project_id.clone();
                        }
                        None => index.push(super::InstalledContent {
                            source: Source::Modrinth,
                            project_id: v.project_id.clone(),
                            version_id: v.id.clone(),
                            title: c.title.clone(),
                            file: f.filename.clone(),
                            kind: c.kind,
                            dependency_of: None,
                        }),
                    }
                    Ok(())
                }
                .await;
                match r {
                    Ok(()) => rep.ported.push(format!("{} → {}", c.title, v.version_number)),
                    Err(e) => rep.failed.push(format!("{}: {e}", c.title)),
                }
            }
            None => {
                let Ok((path, enabled)) = resolve(game_dir, &c.id) else { continue };
                if keep_disabled.contains(&c.id) {
                    if enabled {
                        let off = path.with_file_name(format!("{}{DISABLED}", path.file_name().unwrap().to_string_lossy()));
                        std::fs::rename(&path, off)?;
                    }
                    rep.kept_disabled.push(c.title.clone());
                } else {
                    std::fs::remove_file(&path)?;
                    index.retain(|i| i.file != base);
                    rep.removed.push(c.title.clone());
                }
            }
        }
    }
    save_index(instance_dir, &index)?;

    // Yeni sürümlerin istediği ama pakette olmayan zorunlu bağımlılıkları kur
    let missing_deps: Vec<String> = deps.into_iter().filter(|d| !present.contains(d)).collect();
    if !missing_deps.is_empty() {
        let ctx = InstallCtx {
            http,
            cf_key,
            instance_id: new_id,
            instance_dir: instance_dir.to_path_buf(),
            game_dir: game_dir.to_path_buf(),
            mc_version: mc.to_string(),
            loader: loader.clone(),
            progress: progress.clone(),
        };
        for (n, pid) in missing_deps.iter().enumerate() {
            p(&progress, &task, "deps", n as u64, missing_deps.len() as u64, "Bağımlılıklar");
            match install(&ctx, Source::Modrinth, pid, Kind::Mod).await {
                Ok(r) => rep.dependencies.extend(r.installed.into_iter().map(|i| i.title)),
                Err(e) => rep.failed.push(format!("Bağımlılık {pid}: {e}")),
            }
        }
    }
    report(&progress, &task, "done", total, total);
    Ok(rep)
}

fn p(progress: &ProgressFn, task: &str, stage: &str, cur: u64, total: u64, msg: &str) {
    progress(crate::core::Progress { task: task.into(), stage: stage.into(), current: cur, total, message: Some(format!("Ashi Taşıyıcı: {msg}")) });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Gerçek Modrinth'e karşı: 1.21.1 Fabric'teki Lithium'u 1.21.4'e taşır; elle eklenmiş
    /// (tanınmayan) bir jar kapalı tutulur. Ağ gerektirdiği için elle çalıştırılır.
    #[tokio::test]
    #[ignore]
    async fn ports_real_mod_to_new_version() {
        let http = Http::new();
        let root = std::env::temp_dir().join(format!("west-port-{}", uuid::Uuid::new_v4()));
        let (inst, game) = (root.clone(), root.join("minecraft"));
        std::fs::create_dir_all(game.join("mods")).unwrap();
        let vs: Vec<MrVersion> = http.json(&format!("{MODRINTH}/project/lithium/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%221.21.1%22%5D")).await.unwrap();
        let f = primary(&vs[0]).unwrap().clone();
        http.download(&DownloadTask { url: f.url.clone(), path: game.join("mods").join(&f.filename), sha1: f.hashes.get("sha1").cloned(), size: Some(f.size) }).await.unwrap();
        std::fs::write(game.join("mods/benim-modum.jar"), b"PK\x05\x06\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0").unwrap();

        let plan = plan(&http, &inst, &game, "1.21.4", Some("fabric")).await.unwrap();
        let lith = plan.iter().find(|p| p.id.contains("lithium")).unwrap();
        assert_eq!(lith.status, "ok", "{plan:?}");
        assert_eq!(plan.iter().find(|p| p.id == "mods/benim-modum.jar").unwrap().status, "unknown");

        let keep: HashSet<String> = ["mods/benim-modum.jar".to_string()].into();
        let rep = apply(&http, None, "test", &inst, &game, "1.21.4", Some("fabric".into()), &keep, crate::core::noop_progress()).await.unwrap();
        assert_eq!(rep.ported.len(), 1, "{rep:?}");
        assert!(rep.failed.is_empty(), "{rep:?}");
        assert!(game.join("mods/benim-modum.jar.disabled").exists());
        assert!(!game.join("mods").join(&f.filename).exists(), "eski sürüm kalmamalı");
        let after = plan_names(&game);
        assert!(after.iter().any(|n| n.contains("lithium")), "{after:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    fn plan_names(game: &Path) -> Vec<String> {
        std::fs::read_dir(game.join("mods")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect()
    }
}
