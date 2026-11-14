//! Tek tıkla kurulum + akıllı bağımlılık çözücü.
//! Zorunlu bağımlılıklar (Fabric API, Architectury, …) özyinelemeli kurulur;
//! zaten kurulu olanlar (dizin kaydı veya jar içindeki mod kimliği) atlanır.

use super::{curseforge, load_index, modrinth, save_index, InstalledContent, Kind, Source};
use crate::core::http::{DownloadTask, Http};
use crate::core::{report, ProgressFn};
use crate::error::{AppError, Result};
use serde::Serialize;
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;

pub struct InstallCtx<'a> {
    pub http: &'a Http,
    pub cf_key: Option<&'a str>,
    pub instance_id: &'a str,
    pub instance_dir: PathBuf,
    pub game_dir: PathBuf,
    pub mc_version: String,
    /// Vanilla için None
    pub loader: Option<String>,
    pub progress: ProgressFn,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledBrief {
    pub title: String,
    pub file: String,
    pub dependency_of: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReport {
    pub installed: Vec<InstalledBrief>,
    pub skipped: Vec<String>,
    pub warnings: Vec<String>,
}

struct Job {
    source: Source,
    project_id: String,
    kind: Kind,
    dependency_of: Option<String>,
}

pub async fn install(ctx: &InstallCtx<'_>, source: Source, project_id: &str, kind: Kind) -> Result<InstallReport> {
    if kind == Kind::Modpack {
        return Err(AppError::msg("Modpack'ler yeni bir instance olarak kurulur"));
    }
    if kind == Kind::Mod && ctx.loader.is_none() {
        return Err(AppError::msg("Vanilla bir instance'a mod kurulamaz; Fabric, Quilt, Forge veya NeoForge instance'ı seçin"));
    }
    let mut index = load_index(&ctx.instance_dir);
    // Elle eklenmiş jar'ların sağladığı mod kimlikleri (slug eşleşmesiyle atlamak için)
    let provided: HashSet<String> = crate::crash::modinfo::scan(&ctx.game_dir.join("mods"))
        .unwrap_or_default()
        .into_iter()
        .flat_map(|m| m.provides)
        .collect();

    let mut rep = InstallReport::default();
    let mut seen = HashSet::new();
    let mut queue = VecDeque::from([Job { source, project_id: project_id.to_string(), kind, dependency_of: None }]);
    let mut done = 0u64;

    while let Some(job) = queue.pop_front() {
        if !seen.insert((job.source, job.project_id.clone())) {
            continue;
        }
        if let Some(existing) = index.iter().find(|c| c.source == job.source && c.project_id == job.project_id) {
            if job.dependency_of.is_none() {
                rep.skipped.push(format!("{} zaten kurulu", existing.title));
            }
            continue;
        }
        report(&ctx.progress, ctx.instance_id, "content", done, done + 1 + queue.len() as u64);
        let res = match job.source {
            Source::Modrinth => install_modrinth(ctx, &job, &provided, &mut queue).await,
            Source::Curseforge => install_curseforge(ctx, &job, &provided, &mut queue).await,
        };
        match res {
            Ok(Some(item)) => {
                rep.installed.push(InstalledBrief { title: item.title.clone(), file: item.file.clone(), dependency_of: item.dependency_of.clone() });
                index.push(item);
                save_index(&ctx.instance_dir, &index)?;
            }
            Ok(None) => {}
            // Ana projenin hatası kurulumu durdurur; bağımlılık hatası uyarı olur
            Err(e) if job.dependency_of.is_none() => return Err(e),
            Err(e) => rep.warnings.push(format!("{} için bağımlılık kurulamadı: {e}", job.dependency_of.as_deref().unwrap_or("?"))),
        }
        done += 1;
    }
    report(&ctx.progress, ctx.instance_id, "done", 1, 1);
    Ok(rep)
}

fn target(ctx: &InstallCtx<'_>, kind: Kind, file: &str) -> Result<PathBuf> {
    let name = std::path::Path::new(file).file_name().and_then(|n| n.to_str()).ok_or_else(|| AppError::msg("geçersiz dosya adı"))?;
    Ok(ctx.game_dir.join(kind.folder()).join(name))
}

async fn install_modrinth(ctx: &InstallCtx<'_>, job: &Job, provided: &HashSet<String>, queue: &mut VecDeque<Job>) -> Result<Option<InstalledContent>> {
    let project = modrinth::project(ctx.http, &job.project_id).await?;
    if job.dependency_of.is_some() && provided.contains(&project.slug) {
        return Ok(None); // jar zaten mods/ içinde
    }
    let loader = if job.kind == Kind::Mod { ctx.loader.as_deref() } else { None };
    let v = modrinth::best_version(ctx.http, &project.id, &ctx.mc_version, loader).await?;
    let file = v.primary_file().cloned().ok_or_else(|| AppError::NotFound(format!("{} dosyası", project.title)))?;
    let dest = target(ctx, job.kind, &file.filename)?;
    ctx.http
        .download(&DownloadTask { url: file.url.clone(), path: dest, sha1: file.hashes.get("sha1").cloned(), size: Some(file.size) })
        .await?;

    for d in v.dependencies.iter().filter(|d| d.dependency_type == "required") {
        let pid = match (&d.project_id, &d.version_id) {
            (Some(p), _) => p.clone(),
            (None, Some(vid)) => modrinth::version(ctx.http, vid).await?.project_id,
            _ => continue,
        };
        queue.push_back(Job { source: Source::Modrinth, project_id: pid, kind: Kind::Mod, dependency_of: Some(project.title.clone()) });
    }
    Ok(Some(InstalledContent {
        source: Source::Modrinth,
        project_id: project.id,
        version_id: v.id,
        title: project.title,
        file: file.filename,
        kind: job.kind,
        dependency_of: job.dependency_of.clone(),
    }))
}

async fn install_curseforge(ctx: &InstallCtx<'_>, job: &Job, provided: &HashSet<String>, queue: &mut VecDeque<Job>) -> Result<Option<InstalledContent>> {
    let key = ctx.cf_key.ok_or_else(|| AppError::msg("CurseForge için API anahtarı gerekli"))?;
    let id: u64 = job.project_id.parse().map_err(|_| AppError::msg("geçersiz CurseForge kimliği"))?;
    let m = curseforge::get_mod(ctx.http, key, id).await?;
    if job.dependency_of.is_some() && provided.contains(&m.slug) {
        return Ok(None);
    }
    let loader = if job.kind == Kind::Mod { ctx.loader.as_deref() } else { None };
    let f = curseforge::best_file(ctx.http, key, id, &ctx.mc_version, loader).await?;
    let dest = target(ctx, job.kind, &f.file_name)?;
    ctx.http
        .download(&DownloadTask { url: f.url(), path: dest, sha1: f.sha1(), size: (f.file_length > 0).then_some(f.file_length) })
        .await
        .map_err(|e| AppError::msg(format!("{} indirilemedi (yazar üçüncü taraf indirmeyi kapatmış olabilir): {e}", m.name)))?;
    for d in f.dependencies.iter().filter(|d| d.relation_type == 3) {
        queue.push_back(Job { source: Source::Curseforge, project_id: d.mod_id.to_string(), kind: Kind::Mod, dependency_of: Some(m.name.clone()) });
    }
    Ok(Some(InstalledContent {
        source: Source::Curseforge,
        project_id: m.id.to_string(),
        version_id: f.id.to_string(),
        title: m.name,
        file: f.file_name,
        kind: job.kind,
        dependency_of: job.dependency_of.clone(),
    }))
}
