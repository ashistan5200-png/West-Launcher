//! Birleşik içerik motoru: Modrinth + CurseForge araması, kurulum,
//! bağımlılık çözümü ve modpack kurulumu. Tauri'den bağımsızdır.

pub mod curseforge;
pub mod install;
pub mod modpack;
pub mod manage;
pub mod modrinth;

use crate::error::Result;
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Modrinth,
    Curseforge,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Mod,
    Modpack,
    Shader,
    Resourcepack,
}

impl Kind {
    /// Instance oyun klasörü içindeki hedef dizin
    pub fn folder(self) -> &'static str {
        match self {
            Kind::Mod => "mods",
            Kind::Shader => "shaderpacks",
            Kind::Resourcepack => "resourcepacks",
            Kind::Modpack => "",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentHit {
    pub source: Source,
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub icon: Option<String>,
    pub downloads: u64,
    pub kind: Kind,
    pub categories: Vec<String>,
    pub url: String,
    /// Aynı proje diğer kaynakta da varsa
    pub also_on: Option<Source>,
    /// "required" | "optional" | "unsupported" | "unknown"
    #[serde(default)]
    pub client_side: Option<String>,
    #[serde(default)]
    pub server_side: Option<String>,
    /// Desteklenen Minecraft sürümleri (yeniden eskiye değil, Modrinth sırasıyla)
    #[serde(default)]
    pub versions: Vec<String>,
    /// Desteklenen yükleyiciler (fabric, forge…)
    #[serde(default)]
    pub loaders: Vec<String>,
    #[serde(default)]
    pub updated: Option<String>,
    /// Galeri görselleri (önce öne çıkan)
    #[serde(default)]
    pub gallery: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub query: String,
    pub kind: Option<Kind>,
    pub game_version: Option<String>,
    /// "fabric" | "quilt" | "forge" | "neoforge"
    pub loader: Option<String>,
    /// "relevance" | "downloads" | "updated"
    pub sort: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    /// Boşsa iki kaynak birden
    pub sources: Option<Vec<Source>>,
    /// Modrinth kategori adları (hepsi eşleşmeli)
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    /// "client" (yalnız istemci) | "server" (yalnız sunucu) | "both" (ikisinde de gerekli)
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<ContentHit>,
    pub total: u64,
    /// Kaynak başına hata/uyarı (örn. CurseForge anahtarı yok)
    pub notices: Vec<String>,
}

fn norm(s: &str) -> String {
    s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Kaynakları sıralı karıştırır (round-robin) ve aynı projeyi teke indirir;
/// Modrinth doğrudan indirme sağladığı için çakışmada tercih edilir.
pub fn merge(modrinth: Vec<ContentHit>, curseforge: Vec<ContentHit>) -> Vec<ContentHit> {
    let cf_keys: HashSet<String> = curseforge.iter().map(|h| norm(&h.title)).collect();
    let mr_keys: HashSet<String> = modrinth.iter().map(|h| norm(&h.title)).collect();
    let mut a = modrinth.into_iter().map(|mut h| {
        if cf_keys.contains(&norm(&h.title)) {
            h.also_on = Some(Source::Curseforge);
        }
        h
    });
    let mut b = curseforge.into_iter().filter(|h| !mr_keys.contains(&norm(&h.title)));
    let mut out = Vec::new();
    loop {
        let (x, y) = (a.next(), b.next());
        if x.is_none() && y.is_none() {
            break;
        }
        out.extend(x);
        out.extend(y);
    }
    out
}

/// Keşfet araması: yalnızca Modrinth (CurseForge kaldırıldı).
pub async fn search(http: &crate::core::http::Http, _cf_key: Option<&str>, q: &SearchQuery) -> Result<SearchResult> {
    let (hits, total) = modrinth::search(http, q).await?;
    Ok(SearchResult { hits, total, notices: vec![] })
}

// ───────── Instance içerik dizini ─────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledContent {
    pub source: Source,
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub file: String,
    pub kind: Kind,
    /// Bağımlılık olarak otomatik kurulduysa, onu isteyen projenin adı
    pub dependency_of: Option<String>,
}

pub fn index_path(instance_dir: &Path) -> std::path::PathBuf {
    instance_dir.join("content.json")
}

pub fn load_index(instance_dir: &Path) -> Vec<InstalledContent> {
    std::fs::read(index_path(instance_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_index(instance_dir: &Path, items: &[InstalledContent]) -> Result<()> {
    write_json_atomic(&index_path(instance_dir), items)
}

/// Yol güvenliği: modpack/indirme yollarının oyun klasöründen kaçmasını engeller.
pub fn safe_rel(path: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(path);
    if p.is_absolute() || path.contains('\\') {
        return None;
    }
    let mut out = std::path::PathBuf::new();
    for c in p.components() {
        match c {
            std::path::Component::Normal(s) => out.push(s),
            std::path::Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hit(src: Source, title: &str) -> ContentHit {
        ContentHit {
            source: src, id: title.into(), slug: title.into(), title: title.into(), description: String::new(), author: String::new(),
            icon: None, downloads: 0, kind: Kind::Mod, categories: vec![], url: String::new(), also_on: None,
            client_side: None, server_side: None, versions: vec![], loaders: vec![], updated: None, gallery: vec![],
        }
    }
    #[test]
    fn merge_dedupes_and_interleaves() {
        let m = merge(vec![hit(Source::Modrinth, "Sodium"), hit(Source::Modrinth, "Lithium")], vec![hit(Source::Curseforge, "sodium"), hit(Source::Curseforge, "JEI")]);
        let titles: Vec<_> = m.iter().map(|h| h.title.as_str()).collect();
        assert_eq!(titles, ["Sodium", "JEI", "Lithium"]);
        assert_eq!(m[0].also_on, Some(Source::Curseforge));
    }
    #[test]
    fn path_safety() {
        assert!(safe_rel("mods/a.jar").is_some());
        assert!(safe_rel("../evil").is_none());
        assert!(safe_rel("/etc/passwd").is_none());
        assert!(safe_rel("config/../../x").is_none());
        assert!(safe_rel("a\\..\\b").is_none());
    }
}
