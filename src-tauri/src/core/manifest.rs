use super::http::Http;
use super::rules::Rule;
use crate::error::{AppError, Result};
use crate::paths::Paths;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const VERSION_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net";
pub const LIBRARIES_URL: &str = "https://libraries.minecraft.net/";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: Latest,
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub release_time: String,
    pub sha1: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ArgValue {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Argument {
    Plain(String),
    Ruled { rules: Vec<Rule>, value: ArgValue },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Arguments {
    #[serde(default)]
    pub game: Vec<Argument>,
    #[serde(default)]
    pub jvm: Vec<Argument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexRef {
    pub id: String,
    pub sha1: String,
    pub size: u64,
    pub total_size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub path: Option<String>,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<Artifact>,
    pub classifiers: Option<HashMap<String, Artifact>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Extract {
    #[serde(default)]
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    #[serde(default)]
    pub downloads: Option<LibraryDownloads>,
    /// Fabric/Quilt/Forge: maven taban URL'si
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub rules: Option<Vec<Rule>>,
    #[serde(default)]
    pub natives: Option<HashMap<String, String>>,
    #[serde(default)]
    pub extract: Option<Extract>,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
}

impl Library {
    /// Çakışma tespiti için `group:artifact[:classifier]` anahtarı.
    pub fn dedupe_key(&self) -> String {
        let parts: Vec<&str> = self.name.split('@').next().unwrap_or("").split(':').collect();
        match parts.as_slice() {
            [g, a, _v, c, ..] => format!("{g}:{a}:{c}"),
            [g, a, ..] => format!("{g}:{a}"),
            _ => self.name.clone(),
        }
    }

    pub fn is_native_classifier(&self) -> bool {
        self.name.split(':').nth(3).map(|c| c.starts_with("natives-")).unwrap_or(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaVersionReq {
    pub component: Option<String>,
    pub major_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientDownloads {
    pub client: Option<Artifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionJson {
    pub id: String,
    #[serde(default)]
    pub inherits_from: Option<String>,
    #[serde(rename = "type", default)]
    pub kind: Option<String>,
    pub main_class: Option<String>,
    #[serde(default)]
    pub minecraft_arguments: Option<String>,
    #[serde(default)]
    pub arguments: Option<Arguments>,
    #[serde(default)]
    pub asset_index: Option<AssetIndexRef>,
    #[serde(default)]
    pub assets: Option<String>,
    #[serde(default)]
    pub downloads: Option<ClientDownloads>,
    #[serde(default)]
    pub libraries: Vec<Library>,
    #[serde(default)]
    pub java_version: Option<JavaVersionReq>,
    /// Hangi jar'ın client olarak kullanılacağı (inheritsFrom zincirinin kökü)
    #[serde(default, skip_serializing)]
    pub jar: Option<String>,
}

impl VersionJson {
    /// Mod yükleyici profilini vanilla ebeveyniyle birleştirir.
    pub fn merge_onto(self, parent: VersionJson) -> VersionJson {
        let mut seen = HashSet::new();
        let mut libraries = Vec::with_capacity(self.libraries.len() + parent.libraries.len());
        for lib in self.libraries.into_iter().chain(parent.libraries) {
            if seen.insert(lib.dedupe_key()) {
                libraries.push(lib);
            }
        }
        let arguments = match (parent.arguments, self.arguments) {
            (Some(mut p), Some(c)) => {
                p.game.extend(c.game);
                p.jvm.extend(c.jvm);
                Some(p)
            }
            (p, c) => c.or(p),
        };
        VersionJson {
            id: self.id,
            inherits_from: None,
            kind: self.kind.or(parent.kind),
            main_class: self.main_class.or(parent.main_class),
            minecraft_arguments: self.minecraft_arguments.or(parent.minecraft_arguments),
            arguments,
            asset_index: self.asset_index.or(parent.asset_index),
            assets: self.assets.or(parent.assets),
            downloads: self.downloads.or(parent.downloads),
            libraries,
            java_version: self.java_version.or(parent.java_version),
            jar: parent.jar.or(Some(parent.id)),
        }
    }

    pub fn client_jar_id(&self) -> &str {
        self.jar.as_deref().unwrap_or(&self.id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
    #[serde(default)]
    pub map_to_resources: bool,
    #[serde(rename = "virtual", default)]
    pub is_virtual: bool,
}

pub async fn fetch_manifest(http: &Http, paths: &Paths) -> Result<VersionManifest> {
    http.json_cached(VERSION_MANIFEST, &paths.cache().join("version_manifest_v2.json"), None).await
}

/// Vanilla sürüm json'unu indirir (yoksa) ve diskten okur.
pub async fn ensure_vanilla_json(http: &Http, paths: &Paths, id: &str) -> Result<VersionJson> {
    let path = paths.version_json(id);
    if path.exists() {
        return Ok(serde_json::from_slice(&tokio::fs::read(&path).await?)?);
    }
    let manifest = fetch_manifest(http, paths).await?;
    let entry = manifest
        .versions
        .iter()
        .find(|v| v.id == id)
        .ok_or_else(|| AppError::NotFound(format!("Minecraft sürümü {id}")))?;
    http.json_cached(&entry.url, &path, entry.sha1.as_deref()).await
}

/// `inheritsFrom` zincirini çözerek tamamen birleşik bir sürüm döndürür.
pub async fn resolve_version(http: &Http, paths: &Paths, id: &str) -> Result<VersionJson> {
    let mut chain = Vec::new();
    let mut current = id.to_string();
    for _ in 0..8 {
        let path = paths.version_json(&current);
        let v: VersionJson = if path.exists() {
            serde_json::from_slice(&tokio::fs::read(&path).await?)?
        } else {
            ensure_vanilla_json(http, paths, &current).await?
        };
        let next = v.inherits_from.clone();
        chain.push(v);
        match next {
            Some(p) => current = p,
            None => break,
        }
    }
    let mut merged = chain.pop().ok_or_else(|| AppError::NotFound(id.into()))?;
    while let Some(child) = chain.pop() {
        merged = child.merge_onto(merged);
    }
    Ok(merged)
}
