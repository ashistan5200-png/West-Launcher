use super::{ContentHit, Kind, SearchQuery, Source};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use serde::Deserialize;

pub const API: &str = "https://api.modrinth.com/v2";

const LOADERS: &[&str] = &["fabric", "forge", "neoforge", "quilt", "liteloader", "modloader", "rift", "iris", "optifine", "canvas", "vanilla", "minecraft", "datapack", "bukkit", "paper", "spigot", "purpur", "folia", "sponge", "velocity", "bungeecord", "waterfall"];

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub name: String,
    pub project_type: String,
    pub header: String,
    #[serde(default)]
    pub icon: String,
}

#[derive(Debug, Clone, serde::Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub version: String,
    pub version_type: String,
    #[serde(default)]
    pub major: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tags {
    pub categories: Vec<Category>,
    pub game_versions: Vec<GameVersion>,
}

/// Keşfet filtreleri için Modrinth kategori ve sürüm listeleri (diskte önbelleklenir).
pub async fn tags(http: &Http, cache: &std::path::Path) -> Result<Tags> {
    let categories: Vec<Category> = http.json_cached(&format!("{API}/tag/category"), &cache.join("modrinth-categories.json"), None).await?;
    let game_versions: Vec<GameVersion> = http.json_cached(&format!("{API}/tag/game_version"), &cache.join("modrinth-game-versions.json"), None).await?;
    Ok(Tags { categories, game_versions })
}

fn project_type(k: Kind) -> &'static str {
    match k {
        Kind::Mod => "mod",
        Kind::Modpack => "modpack",
        Kind::Shader => "shader",
        Kind::Resourcepack => "resourcepack",
    }
}

fn kind_of(pt: &str) -> Kind {
    match pt {
        "modpack" => Kind::Modpack,
        "shader" => Kind::Shader,
        "resourcepack" => Kind::Resourcepack,
        _ => Kind::Mod,
    }
}

#[derive(Deserialize)]
struct SearchResp {
    hits: Vec<Hit>,
    total_hits: u64,
}

#[derive(Deserialize)]
struct Hit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    icon_url: Option<String>,
    downloads: u64,
    project_type: String,
    #[serde(default)]
    categories: Vec<String>,
    #[serde(default)]
    versions: Vec<String>,
    client_side: Option<String>,
    server_side: Option<String>,
    date_modified: Option<String>,
    #[serde(default)]
    gallery: Vec<String>,
    featured_gallery: Option<String>,
    #[serde(default)]
    display_categories: Vec<String>,
}

pub async fn search(http: &Http, q: &SearchQuery) -> Result<(Vec<ContentHit>, u64)> {
    let mut facets: Vec<Vec<String>> = vec![vec![format!("project_type:{}", project_type(q.kind.unwrap_or(Kind::Mod)))]];
    if let Some(v) = q.game_version.as_deref().filter(|v| !v.is_empty()) {
        facets.push(vec![format!("versions:{v}")]);
    }
    for c in q.categories.iter().flatten().filter(|c| !c.is_empty()) {
        facets.push(vec![format!("categories:{c}")]);
    }
    match q.environment.as_deref() {
        Some("client") => {
            facets.push(vec!["client_side:required".into(), "client_side:optional".into()]);
            facets.push(vec!["server_side:unsupported".into()]);
        }
        Some("server") => {
            facets.push(vec!["server_side:required".into(), "server_side:optional".into()]);
            facets.push(vec!["client_side:unsupported".into()]);
        }
        Some("both") => {
            facets.push(vec!["client_side:required".into()]);
            facets.push(vec!["server_side:required".into()]);
        }
        _ => {}
    }
    // Loader yalnızca mod ve modpack için anlamlı
    if matches!(q.kind.unwrap_or(Kind::Mod), Kind::Mod | Kind::Modpack) {
        if let Some(l) = q.loader.as_deref().filter(|l| !l.is_empty() && *l != "vanilla") {
            facets.push(vec![format!("categories:{l}")]);
        }
    }
    let index = match q.sort.as_deref() {
        Some("downloads") => "downloads",
        Some("updated") => "updated",
        Some("newest") => "newest",
        Some("follows") => "follows",
        _ => "relevance",
    };
    let resp: SearchResp = http
        .client
        .get(format!("{API}/search"))
        .query(&[
            ("query", q.query.as_str()),
            ("facets", &serde_json::to_string(&facets)?),
            ("index", index),
            ("limit", &q.limit.unwrap_or(20).min(50).to_string()),
            ("offset", &q.offset.unwrap_or(0).to_string()),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let hits = resp
        .hits
        .into_iter()
        .map(|h| {
            let kind = kind_of(&h.project_type);
            ContentHit {
                url: format!("https://modrinth.com/{}/{}", h.project_type, h.slug),
                source: Source::Modrinth,
                id: h.project_id,
                slug: h.slug,
                title: h.title,
                description: h.description,
                author: h.author,
                icon: h.icon_url.filter(|s| !s.is_empty()),
                downloads: h.downloads,
                kind,
                loaders: h.categories.iter().filter(|c| LOADERS.contains(&c.as_str())).cloned().collect(),
                categories: h.display_categories.into_iter().filter(|c| !LOADERS.contains(&c.as_str())).collect(),
                also_on: None,
                client_side: h.client_side,
                server_side: h.server_side,
                versions: h.versions,
                updated: h.date_modified,
                gallery: h.featured_gallery.iter().cloned().chain(h.gallery.into_iter().filter(|g| Some(g) != h.featured_gallery.as_ref())).take(6).collect(),
            }
        })
        .collect();
    Ok((hits, resp.total_hits))
}

#[derive(Debug, Clone, Deserialize)]
pub struct File {
    pub url: String,
    pub filename: String,
    #[serde(default)]
    pub primary: bool,
    pub hashes: std::collections::HashMap<String, String>,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Dependency {
    pub project_id: Option<String>,
    pub version_id: Option<String>,
    pub dependency_type: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Version {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub version_number: String,
    pub version_type: String,
    pub files: Vec<File>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub game_versions: Vec<String>,
    #[serde(default)]
    pub loaders: Vec<String>,
}

impl Version {
    pub fn primary_file(&self) -> Option<&File> {
        self.files.iter().find(|f| f.primary).or_else(|| self.files.first())
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Project {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub project_type: String,
}

pub async fn project(http: &Http, id: &str) -> Result<Project> {
    http.json(&format!("{API}/project/{id}")).await
}

pub async fn version(http: &Http, id: &str) -> Result<Version> {
    http.json(&format!("{API}/version/{id}")).await
}

/// Instance'a uyan en yeni sürüm (önce release, yoksa beta/alpha).
pub async fn best_version(http: &Http, project_id: &str, game_version: &str, loader: Option<&str>) -> Result<Version> {
    let mut req = http.client.get(format!("{API}/project/{project_id}/version")).query(&[("game_versions", serde_json::to_string(&[game_version])?)]);
    if let Some(l) = loader {
        req = req.query(&[("loaders", serde_json::to_string(&[l])?)]);
    }
    let versions: Vec<Version> = req.send().await?.error_for_status()?.json().await?;
    versions
        .iter()
        .find(|v| v.version_type == "release")
        .or_else(|| versions.first())
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("{game_version}{} için uyumlu sürüm", loader.map(|l| format!(" / {l}")).unwrap_or_default())))
}


/// Keşfet ayrıntı sayfası: proje (açıklama, galeri, bağlantılar) ve sahip bilgisi.
pub async fn project_detail(http: &Http, id: &str) -> Result<serde_json::Value> {
    if id.is_empty() || id.contains(['/', '?', '#', '.']) {
        return Err(AppError::msg("Geçersiz proje"));
    }
    let mut p: serde_json::Value = http.json(&format!("{API}/project/{id}")).await?;
    if let Some(team) = p["team"].as_str().map(String::from) {
        if let Ok(members) = http.json::<Vec<serde_json::Value>>(&format!("{API}/team/{team}/members")).await {
            let owner = members.iter().find(|m| m["role"].as_str().map(|r| r.eq_ignore_ascii_case("owner")).unwrap_or(false)).or(members.first());
            if let Some(o) = owner {
                p["ownerName"] = o["user"]["username"].clone();
                p["ownerAvatar"] = o["user"]["avatar_url"].clone();
            }
        }
    }
    Ok(p)
}

/// Sürüm geçmişi (en yeniden eskiye), her sürümün değişiklik notlarıyla.
pub async fn project_versions(http: &Http, id: &str) -> Result<serde_json::Value> {
    if id.is_empty() || id.contains(['/', '?', '#', '.']) {
        return Err(AppError::msg("Geçersiz proje"));
    }
    http.json(&format!("{API}/project/{id}/version")).await
}
