//! West Companion oyun içi modunun launcher tarafı:
//! - uyumlu instance'lara (1.21.1 Fabric/NeoForge) modu kurar/günceller, uyumsuzlardan kaldırır
//! - Fabric'te gerekli Fabric API'yi yoksa kurar
//! - offline hesabın skinini `west/skin.png` olarak yazar
//! - `config/west-companion.json`'u launcher'dan okuyup yazar (oyun canlı okur)

use crate::content::install::{install, InstallCtx};
use crate::content::{Kind, Source};
use crate::core::http::Http;
use crate::core::ProgressFn;
use crate::error::Result;
use crate::instance::{Instance, LoaderKind};
use crate::paths::Paths;
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SUPPORTED_MC: &str = "1.21.1";
pub const JAR_PREFIX: &str = "west-companion";

pub fn bundled_jar(resource_dir: &Path, kind: LoaderKind) -> Option<PathBuf> {
    let name = match kind {
        LoaderKind::Fabric => "west-companion-fabric.jar",
        LoaderKind::NeoForge => "west-companion-neoforge.jar",
        _ => return None,
    };
    [resource_dir.join("companion").join(name), resource_dir.join("resources/companion").join(name)].into_iter().find(|p| p.exists())
}

pub fn compatible(inst: &Instance) -> bool {
    inst.mc_version == SUPPORTED_MC && matches!(inst.loader.kind, LoaderKind::Fabric | LoaderKind::NeoForge)
}

fn installed_jars(mods: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(mods)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with(JAR_PREFIX)).unwrap_or(false)).collect())
        .unwrap_or_default()
}

pub fn remove(game_dir: &Path) {
    for j in installed_jars(&game_dir.join("mods")) {
        let _ = std::fs::remove_file(j);
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReport {
    pub installed: bool,
    pub notes: Vec<String>,
}

/// Oyun başlamadan hemen önce çağrılır. Hata olursa oyun yine açılır (mod opsiyoneldir).
pub async fn prepare(http: &Http, paths: &Paths, resource_dir: &Path, inst: &Instance, enabled: bool, progress: ProgressFn) -> PrepareReport {
    let game = paths.instance_game_dir(&inst.id);
    let mods = game.join("mods");
    let mut rep = PrepareReport::default();
    let Some(src) = bundled_jar(resource_dir, inst.loader.kind).filter(|_| enabled && compatible(inst)) else {
        remove(&game);
        return rep;
    };
    let target = mods.join(format!("{JAR_PREFIX}.jar"));
    let same = std::fs::metadata(&target).ok().map(|m| m.len()) == std::fs::metadata(&src).ok().map(|m| m.len());
    if !same {
        remove(&game);
        if let Err(e) = std::fs::create_dir_all(&mods).and_then(|_| std::fs::copy(&src, &target)) {
            rep.notes.push(format!("West Companion kurulamadı: {e}"));
            return rep;
        }
    }
    rep.installed = true;

    if inst.loader.kind == LoaderKind::Fabric {
        let has_api = crate::crash::modinfo::scan(&mods).unwrap_or_default().iter().any(|m| m.provides.contains("fabric-api"));
        if !has_api {
            let ctx = InstallCtx {
                http,
                cf_key: None,
                instance_id: &inst.id,
                instance_dir: paths.instance_dir(&inst.id),
                game_dir: game.clone(),
                mc_version: inst.mc_version.clone(),
                loader: Some("fabric".into()),
                progress,
            };
            match install(&ctx, Source::Modrinth, "fabric-api", Kind::Mod).await {
                Ok(_) => rep.notes.push("West Companion için Fabric API kuruldu".into()),
                Err(e) => {
                    // Fabric API olmadan mod yüklenemez → oyunu bozmamak için kaldır
                    remove(&game);
                    rep.installed = false;
                    rep.notes.push(format!("Fabric API kurulamadığı için West Companion bu açılışta devre dışı: {e}"));
                }
            }
        }
    }
    rep
}

/// Offline hesap skini (yoksa dosyalar silinir → mod normal skini kullanır).
pub fn write_skin(game_dir: &Path, skin: Option<(&[u8], bool)>) -> Result<()> {
    let dir = game_dir.join("west");
    match skin {
        Some((png, slim)) => {
            std::fs::create_dir_all(&dir)?;
            std::fs::write(dir.join("skin.png"), png)?;
            write_json_atomic(&dir.join("skin.json"), &serde_json::json!({ "offline": true, "slim": slim }))
        }
        None => {
            let _ = std::fs::remove_file(dir.join("skin.json"));
            let _ = std::fs::remove_file(dir.join("skin.png"));
            Ok(())
        }
    }
}

/// Modun ayar dosyası — alan adları mod tarafındaki WestConfig ile birebir aynı.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CompanionConfig {
    pub fullbright: bool,
    pub fps_overlay: bool,
}

impl Default for CompanionConfig {
    fn default() -> Self {
        Self { fullbright: false, fps_overlay: false }
    }
}

fn config_path(game_dir: &Path) -> PathBuf {
    game_dir.join("config").join("west-companion.json")
}

pub fn read_config(game_dir: &Path) -> CompanionConfig {
    std::fs::read(config_path(game_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn write_config(game_dir: &Path, cfg: &CompanionConfig) -> Result<()> {
    write_json_atomic(&config_path(game_dir), cfg)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_matches_mod_field_names() {
        let v = serde_json::to_value(CompanionConfig::default()).unwrap();
        for k in ["fullbright", "fpsOverlay"] {
            assert!(v.get(k).is_some(), "{k}");
        }
        // Mod'un Gson ile yazdığı biçim de okunabilmeli
        let from_mod: CompanionConfig = serde_json::from_str(r#"{"fullbright":true,"fpsOverlay":true,"menuMode":"button","pose":"wave"}"#).unwrap();
        assert!(from_mod.fullbright && from_mod.fps_overlay);
    }
}
