//! West Companion oyun içi modunun launcher tarafı:
//! - uyumlu instance'lara (26.2 / 1.21.11 Fabric, 1.21.1 Fabric/NeoForge) doğru sürümü kurar, uyumsuzlardan kaldırır
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

pub const JAR_PREFIX: &str = "west-companion";

/// Minecraft sürümü + yükleyici → paketlenmiş mod dosyası. Her sürüm ayrı derlenir.
pub fn jar_name(mc: &str, kind: LoaderKind) -> Option<&'static str> {
    Some(match (kind, mc) {
        (LoaderKind::Fabric, "26.2") => "west-companion-fabric-26.2.jar",
        (LoaderKind::Fabric, "1.21.11") => "west-companion-fabric-1.21.11.jar",
        (LoaderKind::Fabric, "1.21.1") => "west-companion-fabric.jar",
        (LoaderKind::NeoForge, "1.21.1") => "west-companion-neoforge.jar",
        _ => return None,
    })
}

pub fn bundled_jar(resource_dir: &Path, inst: &Instance) -> Option<PathBuf> {
    let name = jar_name(&inst.mc_version, inst.loader.kind)?;
    [resource_dir.join("companion").join(name), resource_dir.join("resources/companion").join(name)].into_iter().find(|p| p.exists())
}

pub fn compatible(inst: &Instance) -> bool {
    jar_name(&inst.mc_version, inst.loader.kind).is_some()
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
    let Some(src) = bundled_jar(resource_dir, inst).filter(|_| enabled && compatible(inst)) else {
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

/// Yalnızca launcher'ın bildiği alanları değiştirir; mod tarafındaki HUD düzeni,
/// tema ve diğer ayarlar korunur.
pub fn write_config(game_dir: &Path, cfg: &CompanionConfig) -> Result<()> {
    let p = config_path(game_dir);
    let mut v: serde_json::Value = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| serde_json::json!({}));
    if !v.is_object() {
        v = serde_json::json!({});
    }
    if let (Some(o), serde_json::Value::Object(patch)) = (v.as_object_mut(), serde_json::to_value(cfg)?) {
        o.extend(patch);
    }
    write_json_atomic(&p, &v)
}

/// Launcher ayarlarını (müzik, performans modu, West menüleri …) oyunun West Companion ayarına işler.
/// Yalnızca bu alanlar değişir; HUD düzeni ve oyunda yapılan diğer ayarlar korunur.
pub fn apply_prefs(game_dir: &Path, s: &crate::settings::Settings) -> Result<()> {
    let p = config_path(game_dir);
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut v: serde_json::Value = std::fs::read(&p).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| serde_json::json!({}));
    if !v.is_object() {
        v = serde_json::json!({});
    }
    let a = &s.accessibility;
    let o = v.as_object_mut().unwrap();
    o.insert("music".into(), s.music.into());
    o.insert("musicInGame".into(), s.music_in_game.into());
    o.insert("performanceMode".into(), a.performance_mode.into());
    o.insert("customTitle".into(), a.west_menus.into());
    o.insert("hudEnabled".into(), a.west_hud.into());
    o.insert("animations".into(), a.game_animations.into());
    o.insert("smoothFont".into(), a.smooth_font.into());
    // West shader kaldırıldı; eski ayar dosyalarında kalmasın
    o.remove("westShader");
    write_json_atomic(&p, &v)
}

/// Oyunun grafik ayarlarını hafifletir (options.txt). Var olan değerler yalnızca daha ağırsa düşürülür.
pub fn apply_low_graphics(game_dir: &Path) -> Result<()> {
    let p = game_dir.join("options.txt");
    let text = std::fs::read_to_string(&p).unwrap_or_default();
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let mut set = |key: &str, val: &str, only_if_higher: Option<u32>| {
        let prefix = format!("{key}:");
        if let Some(l) = lines.iter_mut().find(|l| l.starts_with(&prefix)) {
            if let Some(max) = only_if_higher {
                let cur: u32 = l[prefix.len()..].trim().parse().unwrap_or(u32::MAX);
                if cur <= max {
                    return;
                }
            }
            *l = format!("{prefix}{val}");
        } else {
            lines.push(format!("{prefix}{val}"));
        }
    };
    set("renderDistance", "8", Some(8));
    set("simulationDistance", "6", Some(6));
    set("particles", "2", None); // en az
    set("renderClouds", "\"false\"", None);
    set("entityShadows", "false", None);
    set("biomeBlendRadius", "0", None);
    set("graphicsMode", "0", None); // hızlı
    set("enableVsync", "false", None);
    set("entityDistanceScaling", "0.75", None);
    std::fs::write(&p, lines.join("\n") + "\n")?;
    Ok(())
}

/// Performans modunda kurulan optimizasyon modları (Modrinth). Sürüme uymayanlar sessizce atlanır.
pub const PERF_MODS: &[&str] = &["sodium", "lithium", "ferrite-core", "entityculling", "immediatelyfast", "modernfix"];

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

    #[test]
    fn launcher_write_keeps_hud_layout() {
        let dir = std::env::temp_dir().join(format!("west-comp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(dir.join("config/west-companion.json"), r#"{"fullbright":false,"theme":"pixel-night","elements":{"fps":{"x":0.5}}}"#).unwrap();
        write_config(&dir, &CompanionConfig { fullbright: true, fps_overlay: true }).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("config/west-companion.json")).unwrap()).unwrap();
        assert_eq!(v["fullbright"], true);
        assert_eq!(v["theme"], "pixel-night");
        assert_eq!(v["elements"]["fps"]["x"], 0.5);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefs_keep_hud_and_low_graphics_lowers_only() {
        let dir = std::env::temp_dir().join(format!("west-prefs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(dir.join("config/west-companion.json"), r#"{"elements":{"fps":{"x":0.5}},"music":true}"#).unwrap();
        let mut s = crate::settings::Settings::default();
        s.music = false;
        s.accessibility.performance_mode = true;
        apply_prefs(&dir, &s).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("config/west-companion.json")).unwrap()).unwrap();
        assert_eq!(v["music"], false);
        assert_eq!(v["performanceMode"], true);
        assert_eq!(v["elements"]["fps"]["x"], 0.5);

        std::fs::write(dir.join("options.txt"), "renderDistance:4\nparticles:0\nfov:0.0\n").unwrap();
        apply_low_graphics(&dir).unwrap();
        let o = std::fs::read_to_string(dir.join("options.txt")).unwrap();
        assert!(o.contains("renderDistance:4"), "düşük değer korunmalı");
        assert!(o.contains("particles:2"));
        assert!(o.contains("fov:0.0"));
        assert!(o.contains("simulationDistance:6"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn jars_per_version() {
        assert_eq!(jar_name("26.2", LoaderKind::Fabric), Some("west-companion-fabric-26.2.jar"));
        assert_eq!(jar_name("1.21.11", LoaderKind::Fabric), Some("west-companion-fabric-1.21.11.jar"));
        assert!(jar_name("26.2", LoaderKind::NeoForge).is_none());
        assert!(jar_name("1.20.1", LoaderKind::Fabric).is_none());
    }
}