//! Haberler sekmesi:
//!   - Minecraft sürüm notları (Mojang'ın launcher içerik servisi)
//!   - Bilinen modların son güncellemeleri (Modrinth, en çok indirilenler)
//!   - Yeni içerik gezgini: iki sürüm arasında eklenen blok/eşya dokuları ve sesler

use crate::content::modrinth;
use crate::core::http::{DownloadTask, Http};
use crate::core::manifest::{ensure_vanilla_json, fetch_manifest, AssetIndex, RESOURCES_URL};
use crate::error::{AppError, Result};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;

const MOJANG_CONTENT: &str = "https://launchercontent.mojang.com";

// ───────── Minecraft sürüm notları ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchNote {
    pub id: String,
    pub title: String,
    pub version: String,
    /// "release" | "snapshot"
    pub kind: String,
    pub date: String,
    pub image: Option<String>,
    pub summary: String,
    pub content_path: String,
}

pub async fn patch_notes(http: &Http, paths: &Paths, limit: usize) -> Result<Vec<PatchNote>> {
    let v: serde_json::Value = http
        .json_cached(&format!("{MOJANG_CONTENT}/v2/javaPatchNotes.json"), &paths.cache().join("news/javaPatchNotes.json"), None)
        .await?;
    let mut out: Vec<PatchNote> = v["entries"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| {
            Some(PatchNote {
                id: e["id"].as_str()?.into(),
                title: e["title"].as_str().unwrap_or_default().into(),
                version: e["version"].as_str().unwrap_or_default().into(),
                kind: e["type"].as_str().unwrap_or("release").into(),
                date: e["date"].as_str().unwrap_or_default().into(),
                image: e["image"]["url"].as_str().map(|u| format!("{MOJANG_CONTENT}{u}")),
                summary: e["shortText"].as_str().unwrap_or_default().into(),
                content_path: e["contentPath"].as_str()?.into(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    out.truncate(limit);
    Ok(out)
}

/// Notun tam HTML gövdesi (UI tarafında temizlenerek gösterilir).
pub async fn patch_note_body(http: &Http, content_path: &str) -> Result<String> {
    if content_path.contains("..") || !content_path.starts_with("javaPatchNotes/") {
        return Err(AppError::msg(crate::i18n::t("geçersiz not yolu")));
    }
    let v: serde_json::Value = http.json(&format!("{MOJANG_CONTENT}/v2/{content_path}")).await?;
    Ok(v["body"].as_str().unwrap_or_default().to_string())
}

// ───────── Bilinen modların güncellemeleri ─────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModUpdate {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub icon: Option<String>,
    pub downloads: u64,
    pub version_name: String,
    pub version_number: String,
    pub date: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub changelog: String,
    pub url: String,
}

#[derive(Deserialize)]
struct SearchHit {
    project_id: String,
    slug: String,
    title: String,
    icon_url: Option<String>,
    downloads: u64,
    latest_version: Option<String>,
}

#[derive(Deserialize)]
struct VersionLite {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    date_published: String,
    #[serde(default)]
    changelog: Option<String>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
}

/// En çok indirilen modların son sürümleri, yeniden eskiye.
pub async fn mod_updates(http: &Http, count: usize) -> Result<Vec<ModUpdate>> {
    #[derive(Deserialize)]
    struct Resp {
        hits: Vec<SearchHit>,
    }
    let facets = r#"[["project_type:mod"]]"#;
    let resp: Resp = http
        .client
        .get(format!("{}/search", modrinth::API))
        .query(&[("facets", facets), ("index", "downloads"), ("limit", &count.min(100).to_string())])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let ids: Vec<String> = resp.hits.iter().filter_map(|h| h.latest_version.clone()).collect();
    let versions: Vec<VersionLite> = http
        .client
        .get(format!("{}/versions", modrinth::API))
        .query(&[("ids", serde_json::to_string(&ids)?)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let by_project: HashMap<&str, &SearchHit> = resp.hits.iter().map(|h| (h.project_id.as_str(), h)).collect();
    let mut out: Vec<ModUpdate> = versions
        .iter()
        .filter_map(|v| {
            let h = by_project.get(v.project_id.as_str())?;
            let _ = &v.id;
            Some(ModUpdate {
                project_id: h.project_id.clone(),
                slug: h.slug.clone(),
                title: h.title.clone(),
                icon: h.icon_url.clone().filter(|s| !s.is_empty()),
                downloads: h.downloads,
                version_name: v.name.clone(),
                version_number: v.version_number.clone(),
                date: v.date_published.clone(),
                game_versions: v.game_versions.iter().rev().take(4).cloned().collect(),
                loaders: v.loaders.clone(),
                changelog: v.changelog.clone().unwrap_or_default().chars().take(900).collect(),
                url: format!("https://modrinth.com/mod/{}", h.slug),
            })
        })
        .collect();
    out.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(out)
}

// ───────── Yeni içerik gezgini ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTexture {
    /// jar içindeki yol, örn. assets/minecraft/textures/block/copper_bulb.png
    pub path: String,
    pub name: String,
    /// "block" | "item" | "entity" …
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSound {
    /// minecraft/sounds/block/copper_bulb/turn_on1.ogg
    pub path: String,
    pub name: String,
    pub group: String,
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDiff {
    pub version: String,
    pub base: String,
    pub textures: Vec<NewTexture>,
    pub sounds: Vec<NewSound>,
}

/// Karşılaştırma için varsayılan "önceki sürüm": tam sürümde bir önceki tam sürüm,
/// snapshot'ta listedeki bir önceki sürüm.
pub async fn default_base(http: &Http, paths: &Paths, version: &str) -> Result<String> {
    let m = fetch_manifest(http, paths).await?;
    let idx = m.versions.iter().position(|v| v.id == version).ok_or_else(|| AppError::NotFound(format!("Minecraft {version}")))?;
    let is_release = m.versions[idx].kind == "release";
    m.versions[idx + 1..]
        .iter()
        .find(|v| !is_release || v.kind == "release")
        .map(|v| v.id.clone())
        .ok_or_else(|| AppError::msg(crate::i18n::t("karşılaştırılacak önceki sürüm yok")))
}

async fn ensure_client_jar(http: &Http, paths: &Paths, version: &str) -> Result<PathBuf> {
    let v = ensure_vanilla_json(http, paths, version).await?;
    let client = v.downloads.and_then(|d| d.client).ok_or_else(|| AppError::msg(crate::i18n::t("sürümde client jar yok")))?;
    let path = paths.version_jar(version);
    let task = DownloadTask { url: client.url, path: path.clone(), sha1: client.sha1, size: client.size };
    if !Http::is_valid(&task, false) {
        http.download(&task).await?;
    }
    Ok(path)
}

const TEXTURE_DIRS: &[&str] = &["block", "item", "entity", "particle", "painting", "mob_effect", "environment"];

fn textures_in(jar: &std::path::Path) -> Result<HashSet<String>> {
    let zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
    Ok(zip
        .file_names()
        .filter(|n| n.starts_with("assets/minecraft/textures/") && n.ends_with(".png"))
        .filter(|n| TEXTURE_DIRS.iter().any(|d| n.starts_with(&format!("assets/minecraft/textures/{d}/"))))
        .map(String::from)
        .collect())
}

async fn asset_index(http: &Http, paths: &Paths, version: &str) -> Result<AssetIndex> {
    let v = ensure_vanilla_json(http, paths, version).await?;
    let idx = v.asset_index.ok_or_else(|| AppError::msg(crate::i18n::t("sürümde asset index yok")))?;
    http.json_cached(&idx.url, &paths.assets().join("indexes").join(format!("{}.json", idx.id)), Some(&idx.sha1)).await
}

pub async fn diff_assets(http: &Http, paths: &Paths, version: &str, base: Option<String>) -> Result<AssetDiff> {
    let base = match base {
        Some(b) => b,
        None => default_base(http, paths, version).await?,
    };
    let cache = paths.cache().join("news").join(format!("diff-{version}-{base}.json"));
    if let Ok(b) = std::fs::read(&cache) {
        if let Ok(d) = serde_json::from_slice::<AssetDiff>(&b) {
            return Ok(d);
        }
    }
    let (new_jar, old_jar) = tokio::try_join!(ensure_client_jar(http, paths, version), ensure_client_jar(http, paths, &base))?;
    let (new_idx, old_idx) = tokio::try_join!(asset_index(http, paths, version), asset_index(http, paths, &base))?;

    let (new_tex, old_tex) = tokio::task::spawn_blocking(move || Ok::<_, AppError>((textures_in(&new_jar)?, textures_in(&old_jar)?)))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    let mut textures: Vec<NewTexture> = new_tex
        .difference(&old_tex)
        .map(|p| {
            let rest = p.trim_start_matches("assets/minecraft/textures/");
            NewTexture {
                category: rest.split('/').next().unwrap_or("").into(),
                name: rest.rsplit('/').next().unwrap_or(rest).trim_end_matches(".png").into(),
                path: p.clone(),
            }
        })
        .collect();
    textures.sort_by(|a, b| a.category.cmp(&b.category).then(a.name.cmp(&b.name)));

    let mut sounds: Vec<NewSound> = new_idx
        .objects
        .iter()
        .filter(|(k, _)| k.starts_with("minecraft/sounds/") && k.ends_with(".ogg") && !old_idx.objects.contains_key(*k))
        .map(|(k, o)| {
            let rest = k.trim_start_matches("minecraft/sounds/");
            NewSound {
                group: rest.rsplit_once('/').map(|(g, _)| g.to_string()).unwrap_or_default(),
                name: rest.rsplit('/').next().unwrap_or(rest).trim_end_matches(".ogg").into(),
                path: k.clone(),
                hash: o.hash.clone(),
                size: o.size,
            }
        })
        .collect();
    sounds.sort_by(|a, b| a.group.cmp(&b.group).then(a.name.cmp(&b.name)));

    let d = AssetDiff { version: version.into(), base, textures, sounds };
    let _ = crate::util::write_json_atomic(&cache, &d);
    Ok(d)
}

/// Doku PNG baytları (jar içinden).
pub fn read_texture(paths: &Paths, version: &str, path: &str) -> Result<Vec<u8>> {
    if !path.starts_with("assets/minecraft/textures/") || path.contains("..") {
        return Err(AppError::msg(crate::i18n::t("geçersiz doku yolu")));
    }
    let mut zip = zip::ZipArchive::new(std::fs::File::open(paths.version_jar(version))?)?;
    let mut f = zip.by_name(path).map_err(|_| AppError::NotFound(path.into()))?;
    let mut buf = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

/// Ses (.ogg) baytları; launcher'ın ortak asset deposundan, yoksa Mojang'dan indirerek.
pub async fn read_sound(http: &Http, paths: &Paths, hash: &str) -> Result<Vec<u8>> {
    if hash.len() != 40 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::msg(crate::i18n::t("geçersiz ses kimliği")));
    }
    let path = paths.assets().join("objects").join(&hash[..2]).join(hash);
    let task = DownloadTask { url: format!("{RESOURCES_URL}/{}/{hash}", &hash[..2]), path: path.clone(), sha1: Some(hash.into()), size: None };
    if !path.exists() {
        http.download(&task).await?;
    }
    Ok(tokio::fs::read(&path).await?)
}
