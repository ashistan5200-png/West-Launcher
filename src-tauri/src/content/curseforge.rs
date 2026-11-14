//! CurseForge Core API (resmi, anahtar gerektirir: https://console.curseforge.com).

use super::{ContentHit, Kind, SearchQuery, Source};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use serde::de::DeserializeOwned;
use serde::Deserialize;

pub const API: &str = "https://api.curseforge.com/v1";
const MINECRAFT: u32 = 432;

pub fn class_id(k: Kind) -> u32 {
    match k {
        Kind::Mod => 6,
        Kind::Modpack => 4471,
        Kind::Resourcepack => 12,
        Kind::Shader => 6552,
    }
}

pub fn kind_of(class_id: Option<u32>) -> Kind {
    match class_id {
        Some(4471) => Kind::Modpack,
        Some(12) => Kind::Resourcepack,
        Some(6552) => Kind::Shader,
        _ => Kind::Mod,
    }
}

pub fn loader_type(l: &str) -> Option<u32> {
    match l {
        "forge" => Some(1),
        "fabric" => Some(4),
        "quilt" => Some(5),
        "neoforge" => Some(6),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Envelope<T> {
    data: T,
    pagination: Option<Pagination>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pagination {
    total_count: u64,
}

async fn get<T: DeserializeOwned>(http: &Http, key: &str, path: &str, query: &[(&str, String)]) -> Result<(T, Option<u64>)> {
    let resp = http.client.get(format!("{API}{path}")).header("x-api-key", key).query(query).send().await?;
    if resp.status() == reqwest::StatusCode::FORBIDDEN || resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::msg("CurseForge API anahtarı geçersiz"));
    }
    let env: Envelope<T> = resp.error_for_status()?.json().await?;
    Ok((env.data, env.pagination.map(|p| p.total_count)))
}

async fn post<T: DeserializeOwned>(http: &Http, key: &str, path: &str, body: serde_json::Value) -> Result<T> {
    let env: Envelope<T> = http.client.post(format!("{API}{path}")).header("x-api-key", key).json(&body).send().await?.error_for_status()?.json().await?;
    Ok(env.data)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mod {
    pub id: u64,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub download_count: f64,
    pub logo: Option<Logo>,
    #[serde(default)]
    pub authors: Vec<Author>,
    pub class_id: Option<u32>,
    pub links: Option<Links>,
    #[serde(default)]
    pub categories: Vec<Category>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Logo {
    pub thumbnail_url: Option<String>,
}
#[derive(Deserialize)]
pub struct Author {
    pub name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Links {
    pub website_url: Option<String>,
}
#[derive(Deserialize)]
pub struct Category {
    pub name: String,
}

impl Mod {
    pub fn to_hit(self) -> ContentHit {
        let kind = kind_of(self.class_id);
        ContentHit {
            source: Source::Curseforge,
            id: self.id.to_string(),
            url: self.links.and_then(|l| l.website_url).unwrap_or_else(|| format!("https://www.curseforge.com/minecraft/mc-mods/{}", self.slug)),
            slug: self.slug,
            title: self.name,
            description: self.summary,
            author: self.authors.into_iter().next().map(|a| a.name).unwrap_or_default(),
            icon: self.logo.and_then(|l| l.thumbnail_url),
            downloads: self.download_count as u64,
            kind,
            categories: self.categories.into_iter().take(3).map(|c| c.name).collect(),
            also_on: None,
        }
    }
}

pub async fn search(http: &Http, key: &str, q: &SearchQuery) -> Result<(Vec<ContentHit>, u64)> {
    let kind = q.kind.unwrap_or(Kind::Mod);
    let mut query = vec![
        ("gameId", MINECRAFT.to_string()),
        ("classId", class_id(kind).to_string()),
        ("searchFilter", q.query.clone()),
        // 1=featured 2=popularity 3=lastUpdated 6=totalDownloads
        ("sortField", match q.sort.as_deref() { Some("downloads") => "6", Some("updated") => "3", _ => "2" }.to_string()),
        ("sortOrder", "desc".into()),
        ("pageSize", q.limit.unwrap_or(20).min(50).to_string()),
        ("index", q.offset.unwrap_or(0).to_string()),
    ];
    if let Some(v) = q.game_version.as_deref().filter(|v| !v.is_empty()) {
        query.push(("gameVersion", v.to_string()));
    }
    if matches!(kind, Kind::Mod | Kind::Modpack) {
        if let Some(t) = q.loader.as_deref().and_then(loader_type) {
            query.push(("modLoaderType", t.to_string()));
        }
    }
    let (mods, total): (Vec<Mod>, _) = get(http, key, "/mods/search", &query).await?;
    Ok((mods.into_iter().map(Mod::to_hit).collect(), total.unwrap_or(0)))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHash {
    pub value: String,
    pub algo: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDep {
    pub mod_id: u64,
    pub relation_type: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: u64,
    pub mod_id: u64,
    pub display_name: String,
    pub file_name: String,
    pub download_url: Option<String>,
    #[serde(default)]
    pub hashes: Vec<FileHash>,
    #[serde(default)]
    pub dependencies: Vec<FileDep>,
    #[serde(default)]
    pub file_length: u64,
    /// 1=release 2=beta 3=alpha
    #[serde(default)]
    pub release_type: u32,
}

impl File {
    pub fn sha1(&self) -> Option<String> {
        self.hashes.iter().find(|h| h.algo == 1).map(|h| h.value.clone())
    }

    /// Yazar üçüncü taraf indirmeyi kapattıysa API URL vermez; CDN kalıbı denenir.
    pub fn url(&self) -> String {
        self.download_url.clone().unwrap_or_else(|| {
            format!("https://edge.forgecdn.net/files/{}/{}/{}", self.id / 1000, self.id % 1000, self.file_name)
        })
    }
}

pub async fn get_mod(http: &Http, key: &str, id: u64) -> Result<Mod> {
    Ok(get(http, key, &format!("/mods/{id}"), &[]).await?.0)
}

pub async fn get_mods(http: &Http, key: &str, ids: &[u64]) -> Result<Vec<Mod>> {
    post(http, key, "/mods", serde_json::json!({ "modIds": ids })).await
}

pub async fn get_files(http: &Http, key: &str, ids: &[u64]) -> Result<Vec<File>> {
    post(http, key, "/mods/files", serde_json::json!({ "fileIds": ids })).await
}

pub async fn get_file(http: &Http, key: &str, mod_id: u64, file_id: u64) -> Result<File> {
    Ok(get(http, key, &format!("/mods/{mod_id}/files/{file_id}"), &[]).await?.0)
}

/// Sürüm + loader'a uyan en yeni dosya (önce release).
pub async fn best_file(http: &Http, key: &str, mod_id: u64, game_version: &str, loader: Option<&str>) -> Result<File> {
    let mut q = vec![("gameVersion", game_version.to_string()), ("pageSize", "50".into())];
    if let Some(t) = loader.and_then(loader_type) {
        q.push(("modLoaderType", t.to_string()));
    }
    let (files, _): (Vec<File>, _) = get(http, key, &format!("/mods/{mod_id}/files"), &q).await?;
    files
        .iter()
        .find(|f| f.release_type == 1)
        .or_else(|| files.first())
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("{game_version} için uyumlu CurseForge dosyası")))
}
