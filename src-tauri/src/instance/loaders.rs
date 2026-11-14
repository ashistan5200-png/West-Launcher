//! Mod yükleyici kurulumları. Fabric/Quilt meta API'lerinden profil json'u
//! alınır; Forge/NeoForge resmi kurulumcusu başsız (headless) çalıştırılır.

use super::{Instance, LoaderKind};
use crate::core::http::{DownloadTask, Http};
use crate::core::manifest::{ensure_vanilla_json, VersionJson};
use crate::core::{report, ProgressFn};
use crate::error::{AppError, Result};
use crate::paths::Paths;
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

const FABRIC_META: &str = "https://meta.fabricmc.net/v2";
const QUILT_META: &str = "https://meta.quiltmc.org/v3";
const FORGE_MAVEN: &str = "https://maven.minecraftforge.net/net/minecraftforge/forge";
const FORGE_META: &str = "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json";
const NEOFORGE_MAVEN: &str = "https://maven.neoforged.net/releases/net/neoforged/neoforge";
const NEOFORGE_VERSIONS: &str = "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion {
    pub version: String,
    pub stable: bool,
}

/// Belirli bir MC sürümü için mevcut loader sürümleri (en yeni önce).
pub async fn list_versions(http: &Http, kind: LoaderKind, mc: &str) -> Result<Vec<LoaderVersion>> {
    match kind {
        LoaderKind::Vanilla => Ok(vec![]),
        LoaderKind::Fabric | LoaderKind::Quilt => {
            #[derive(Deserialize)]
            struct L { version: String, #[serde(default)] stable: Option<bool> }
            #[derive(Deserialize)]
            struct E { loader: L }
            let base = if kind == LoaderKind::Fabric { FABRIC_META } else { QUILT_META };
            let list: Vec<E> = http.json(&format!("{base}/versions/loader/{mc}")).await?;
            Ok(list
                .into_iter()
                .map(|e| LoaderVersion {
                    stable: e.loader.stable.unwrap_or(!e.loader.version.contains("beta")),
                    version: e.loader.version,
                })
                .collect())
        }
        LoaderKind::Forge => {
            let meta: std::collections::HashMap<String, Vec<String>> = http.json(FORGE_META).await?;
            let mut v: Vec<LoaderVersion> = meta
                .get(mc)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|full| LoaderVersion {
                    version: full.strip_prefix(&format!("{mc}-")).unwrap_or(&full).to_string(),
                    stable: true,
                })
                .collect();
            v.reverse();
            Ok(v)
        }
        LoaderKind::NeoForge => {
            #[derive(Deserialize)]
            struct R { versions: Vec<String> }
            let r: R = http.json(NEOFORGE_VERSIONS).await?;
            let mut v: Vec<LoaderVersion> = r
                .versions
                .into_iter()
                .filter(|nv| neoforge_mc_version(nv).as_deref() == Some(mc))
                .map(|nv| LoaderVersion { stable: !nv.contains("beta"), version: nv })
                .collect();
            v.reverse();
            Ok(v)
        }
    }
}

/// NeoForge sürüm şeması: "21.1.77" → MC "1.21.1", "21.0.5" → "1.21".
pub fn neoforge_mc_version(nv: &str) -> Option<String> {
    let mut p = nv.split('.');
    let major = p.next()?;
    let minor = p.next()?;
    Some(if minor == "0" { format!("1.{major}") } else { format!("1.{major}.{minor}") })
}

/// Instance'ın loader'ını kurar ve başlatılabilir sürüm kimliğini döndürür.
pub async fn install_loader(http: &Http, paths: &Paths, inst: &Instance, java: Option<&Path>, progress: ProgressFn) -> Result<String> {
    let mc = &inst.mc_version;
    // Her loader vanilla json'una dayanır.
    ensure_vanilla_json(http, paths, mc).await?;
    let task = inst.id.as_str();
    report(&progress, task, "loader", 0, 1);

    let id = match inst.loader.kind {
        LoaderKind::Vanilla => mc.clone(),
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let lv = match &inst.loader.version {
                Some(v) => v.clone(),
                None => list_versions(http, inst.loader.kind, mc)
                    .await?
                    .into_iter()
                    .find(|v| v.stable)
                    .ok_or_else(|| AppError::NotFound("uygun loader sürümü".into()))?
                    .version,
            };
            let base = if inst.loader.kind == LoaderKind::Fabric { FABRIC_META } else { QUILT_META };
            let profile: VersionJson = http.json(&format!("{base}/versions/loader/{mc}/{lv}/profile/json")).await?;
            let id = profile.id.clone();
            write_json_atomic(&paths.version_json(&id), &profile)?;
            id
        }
        LoaderKind::Forge | LoaderKind::NeoForge => {
            let java = java.ok_or_else(|| AppError::msg("Forge kurulumu için Java gerekli"))?;
            let lv = match &inst.loader.version {
                Some(v) => v.clone(),
                None => list_versions(http, inst.loader.kind, mc)
                    .await?
                    .into_iter()
                    .next()
                    .ok_or_else(|| AppError::NotFound("uygun loader sürümü".into()))?
                    .version,
            };
            let url = if inst.loader.kind == LoaderKind::Forge {
                format!("{FORGE_MAVEN}/{mc}-{lv}/forge-{mc}-{lv}-installer.jar")
            } else {
                format!("{NEOFORGE_MAVEN}/{lv}/neoforge-{lv}-installer.jar")
            };
            run_forge_installer(http, paths, &url, java).await?
        }
    };
    report(&progress, task, "loader", 1, 1);
    Ok(id)
}

/// Kurulumcuyu `meta/` (.minecraft düzeninde) üzerinde başsız çalıştırır ve
/// oluşan yeni sürüm klasörünü tespit eder.
async fn run_forge_installer(http: &Http, paths: &Paths, url: &str, java: &Path) -> Result<String> {
    let installer = paths.cache().join(url.rsplit('/').next().unwrap_or("installer.jar"));
    http.download(&DownloadTask { url: url.into(), path: installer.clone(), sha1: None, size: None }).await?;

    // Kurulumcu bir launcher_profiles.json bekler.
    let profiles = paths.meta().join("launcher_profiles.json");
    if !profiles.exists() {
        std::fs::write(&profiles, r#"{"profiles":{},"selectedProfile":null}"#)?;
    }
    let before: HashSet<String> = list_dirs(&paths.versions());

    let java_cli = {
        let p = java.with_file_name(if cfg!(windows) { "java.exe" } else { "java" });
        if p.exists() { p } else { java.to_path_buf() }
    };
    let mut cmd = tokio::process::Command::new(java_cli);
    cmd.arg("-jar").arg(&installer).arg("--installClient").arg(paths.meta()).current_dir(paths.cache());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = cmd.output().await?;
    if !out.status.success() {
        let tail: String = String::from_utf8_lossy(&out.stdout).lines().rev().take(15).collect::<Vec<_>>().join("\n");
        return Err(AppError::msg(format!("Forge/NeoForge kurulumu başarısız:\n{tail}")));
    }
    let after = list_dirs(&paths.versions());
    let new_id = after
        .difference(&before)
        .find(|d| d.contains("forge") || d.contains("neoforge"))
        .cloned()
        .or_else(|| {
            // Zaten kuruluysa: kurulumcu adından tahmin et
            let file = installer.file_name()?.to_string_lossy().replace("-installer.jar", "");
            after.into_iter().find(|d| file.contains(d.as_str()) || d.ends_with(file.rsplit('-').next().unwrap_or("")))
        })
        .ok_or_else(|| AppError::msg("Kurulan Forge sürümü tespit edilemedi"))?;
    let _ = std::fs::remove_file(&installer);
    Ok(new_id)
}

fn list_dirs(p: &Path) -> HashSet<String> {
    std::fs::read_dir(p)
        .map(|rd| rd.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().into_owned()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    #[test]
    fn neo_mapping() {
        assert_eq!(super::neoforge_mc_version("21.1.77").as_deref(), Some("1.21.1"));
        assert_eq!(super::neoforge_mc_version("21.0.5-beta").as_deref(), Some("1.21"));
        assert_eq!(super::neoforge_mc_version("20.4.237").as_deref(), Some("1.20.4"));
    }
}
