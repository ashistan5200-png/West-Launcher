//! Modpack kurulumu: Modrinth `.mrpack` ve CurseForge `manifest.json` paketleri
//! yeni ve tamamen izole bir instance olarak kurulur.

use super::{curseforge, modrinth, safe_rel, save_index, InstalledContent, Kind, Source};
use crate::core::http::{DownloadTask, Http};
use crate::core::{report, ProgressFn};
use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, Loader, LoaderKind, NewInstance};
use crate::paths::Paths;
use serde::Deserialize;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

pub struct PackCtx<'a> {
    pub http: &'a Http,
    pub paths: &'a Paths,
    pub cf_key: Option<&'a str>,
    pub concurrency: usize,
    pub progress: ProgressFn,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MrIndex {
    name: String,
    files: Vec<MrFile>,
    dependencies: HashMap<String, String>,
}

#[derive(Deserialize)]
struct MrFile {
    path: String,
    hashes: HashMap<String, String>,
    downloads: Vec<String>,
    #[serde(rename = "fileSize")]
    file_size: Option<u64>,
    env: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfManifest {
    name: String,
    minecraft: CfMinecraft,
    files: Vec<CfFileRef>,
    #[serde(default = "default_overrides")]
    overrides: String,
}
fn default_overrides() -> String {
    "overrides".into()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfMinecraft {
    version: String,
    mod_loaders: Vec<CfLoader>,
}
#[derive(Deserialize)]
struct CfLoader {
    id: String,
    #[serde(default)]
    primary: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CfFileRef {
    #[serde(rename = "projectID")]
    project_id: u64,
    #[serde(rename = "fileID")]
    file_id: u64,
    #[serde(default = "yes")]
    required: bool,
}
fn yes() -> bool {
    true
}

fn read_zip_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    let mut b = Vec::new();
    f.read_to_end(&mut b).ok()?;
    Some(b)
}

/// `overrides/` (ve mrpack'te `client-overrides/`) içeriğini oyun klasörüne açar.
fn extract_overrides(zip: &mut zip::ZipArchive<std::fs::File>, prefixes: &[&str], game_dir: &Path) -> Result<()> {
    for i in 0..zip.len() {
        let mut e = zip.by_index(i)?;
        if e.is_dir() {
            continue;
        }
        let name = e.name().to_string();
        let Some(rel) = prefixes.iter().find_map(|p| name.strip_prefix(&format!("{p}/"))) else { continue };
        let Some(rel) = safe_rel(rel) else { continue };
        let dest = game_dir.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(dest)?;
        std::io::copy(&mut e, &mut out)?;
    }
    Ok(())
}

fn mr_loader(deps: &HashMap<String, String>) -> Loader {
    for (key, kind) in [("neoforge", LoaderKind::NeoForge), ("forge", LoaderKind::Forge), ("quilt-loader", LoaderKind::Quilt), ("fabric-loader", LoaderKind::Fabric)] {
        if let Some(v) = deps.get(key) {
            return Loader { kind, version: Some(v.clone()) };
        }
    }
    Loader { kind: LoaderKind::Vanilla, version: None }
}

fn cf_loader(loaders: &[CfLoader]) -> Loader {
    let l = loaders.iter().find(|l| l.primary).or_else(|| loaders.first());
    let Some(l) = l else { return Loader { kind: LoaderKind::Vanilla, version: None } };
    let (name, ver) = l.id.split_once('-').unwrap_or((l.id.as_str(), ""));
    let kind = match name {
        "neoforge" => LoaderKind::NeoForge,
        "forge" => LoaderKind::Forge,
        "fabric" => LoaderKind::Fabric,
        "quilt" => LoaderKind::Quilt,
        _ => LoaderKind::Vanilla,
    };
    Loader { kind, version: (!ver.is_empty()).then(|| ver.to_string()) }
}

/// Modpack'i bulur, indirir ve kurulu instance'ı döndürür.
pub async fn install(ctx: &PackCtx<'_>, source: Source, project_id: &str) -> Result<Instance> {
    let task = format!("pack-{project_id}");
    report(&ctx.progress, &task, "manifest", 0, 1);
    let archive = ctx.paths.cache().join(format!("{task}.zip"));

    // 1) Paket dosyasını indir
    let title = match source {
        Source::Modrinth => {
            let p = modrinth::project(ctx.http, project_id).await?;
            let versions: Vec<modrinth::Version> = ctx.http.json(&format!("{}/project/{}/version", modrinth::API, p.id)).await?;
            let v = versions.iter().find(|v| v.version_type == "release").or_else(|| versions.first()).ok_or_else(|| AppError::NotFound(crate::i18n::t("modpack sürümü").into()))?;
            let f = v.primary_file().ok_or_else(|| AppError::NotFound(crate::i18n::t("mrpack dosyası").into()))?;
            ctx.http.download(&DownloadTask { url: f.url.clone(), path: archive.clone(), sha1: f.hashes.get("sha1").cloned(), size: Some(f.size) }).await?;
            p.title
        }
        Source::Curseforge => {
            let key = ctx.cf_key.ok_or_else(|| AppError::msg(crate::i18n::t("CurseForge için API anahtarı gerekli")))?;
            let id: u64 = project_id.parse().map_err(|_| AppError::msg(crate::i18n::t("geçersiz kimlik")))?;
            let m = curseforge::get_mod(ctx.http, key, id).await?;
            let (files, _) = cf_latest_files(ctx.http, key, id).await?;
            let f = files.into_iter().next().ok_or_else(|| AppError::NotFound(crate::i18n::t("modpack dosyası").into()))?;
            ctx.http.download(&DownloadTask { url: f.url(), path: archive.clone(), sha1: f.sha1(), size: None }).await?;
            m.name
        }
    };

    let mut zip = zip::ZipArchive::new(std::fs::File::open(&archive)?)?;
    let mgr = InstanceManager::new(ctx.paths);
    let result = if let Some(bytes) = read_zip_entry(&mut zip, "modrinth.index.json") {
        // 2a) Modrinth
        let idx: MrIndex = serde_json::from_slice(&bytes)?;
        let mc = idx.dependencies.get("minecraft").cloned().ok_or_else(|| AppError::msg(crate::i18n::t("paket MC sürümü belirtmiyor")))?;
        let mut inst = mgr.create(NewInstance { name: if idx.name.is_empty() { title.clone() } else { idx.name }, mc_version: mc, loader: mr_loader(&idx.dependencies), icon: None, group: Some("Modpack".into()) })?;
        let game = ctx.paths.instance_game_dir(&inst.id);
        let mut tasks = Vec::new();
        for f in idx.files {
            if f.env.as_ref().and_then(|e| e.get("client")).map(|c| c == "unsupported").unwrap_or(false) {
                continue;
            }
            let (Some(rel), Some(url)) = (safe_rel(&f.path), f.downloads.first()) else { continue };
            tasks.push(DownloadTask { url: url.clone(), path: game.join(rel), sha1: f.hashes.get("sha1").cloned(), size: f.file_size });
        }
        let p = ctx.progress.clone();
        let t = inst.id.clone();
        ctx.http.download_all(tasks, ctx.concurrency, move |d, n| report(&p, &t, "files", d, n)).await?;
        extract_overrides(&mut zip, &["overrides", "client-overrides"], &game)?;
        inst.imported_from = Some("modrinth".into());
        inst
    } else if let Some(bytes) = read_zip_entry(&mut zip, "manifest.json") {
        // 2b) CurseForge
        let key = ctx.cf_key.ok_or_else(|| AppError::msg(crate::i18n::t("Bu CurseForge paketi için API anahtarı gerekli")))?;
        let man: CfManifest = serde_json::from_slice(&bytes)?;
        let mut inst = mgr.create(NewInstance { name: man.name.clone(), mc_version: man.minecraft.version.clone(), loader: cf_loader(&man.minecraft.mod_loaders), icon: None, group: Some("Modpack".into()) })?;
        let game = ctx.paths.instance_game_dir(&inst.id);
        let refs: Vec<&CfFileRef> = man.files.iter().filter(|f| f.required).collect();
        let file_ids: Vec<u64> = refs.iter().map(|f| f.file_id).collect();
        let mod_ids: Vec<u64> = refs.iter().map(|f| f.project_id).collect();
        let (files, mods) = tokio::try_join!(curseforge::get_files(ctx.http, key, &file_ids), curseforge::get_mods(ctx.http, key, &mod_ids))?;
        let class: HashMap<u64, Kind> = mods.iter().map(|m| (m.id, curseforge::kind_of(m.class_id))).collect();
        let tasks = files
            .iter()
            .map(|f| {
                let folder = class.get(&f.mod_id).copied().unwrap_or(Kind::Mod).folder();
                DownloadTask { url: f.url(), path: game.join(folder).join(&f.file_name), sha1: f.sha1(), size: (f.file_length > 0).then_some(f.file_length) }
            })
            .collect();
        let p = ctx.progress.clone();
        let t = inst.id.clone();
        ctx.http.download_all(tasks, ctx.concurrency, move |d, n| report(&p, &t, "files", d, n)).await?;
        let prefix = man.overrides.clone();
        extract_overrides(&mut zip, &[prefix.as_str()], &game)?;
        // Sonraki güncellemeler için içerik dizini
        let index: Vec<InstalledContent> = files
            .iter()
            .map(|f| InstalledContent {
                source: Source::Curseforge,
                project_id: f.mod_id.to_string(),
                version_id: f.id.to_string(),
                title: f.display_name.clone(),
                file: f.file_name.clone(),
                kind: class.get(&f.mod_id).copied().unwrap_or(Kind::Mod),
                dependency_of: None,
            })
            .collect();
        save_index(&ctx.paths.instance_dir(&inst.id), &index)?;
        inst.imported_from = Some("curseforge".into());
        inst
    } else {
        return Err(AppError::msg(crate::i18n::t("Tanınmayan modpack biçimi")));
    };

    let _ = std::fs::remove_file(&archive);
    let inst = result;
    mgr.save(&inst)?;
    report(&ctx.progress, &task, "done", 1, 1);
    Ok(inst)
}

async fn cf_latest_files(http: &Http, key: &str, mod_id: u64) -> Result<(Vec<curseforge::File>, ())> {
    #[derive(Deserialize)]
    struct Env {
        data: Vec<curseforge::File>,
    }
    let env: Env = http
        .client
        .get(format!("{}/mods/{mod_id}/files", curseforge::API))
        .header("x-api-key", key)
        .query(&[("pageSize", "20")])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let mut files = env.data;
    files.sort_by_key(|f| std::cmp::Reverse((f.release_type == 1, f.id)));
    Ok((files, ()))
}
