//! Diğer launcher'lardan aktarım: Modrinth App, CurseForge, Prism Launcher,
//! MultiMC ve resmi Minecraft Launcher. Kaynak dosyalara asla yazılmaz;
//! seçilen içerik yeni bir West instance'ına kopyalanır.

use crate::error::{AppError, Result};
use crate::instance::{Instance, InstanceManager, Loader, LoaderKind, NewInstance};
use crate::paths::Paths;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Launcher {
    Modrinth,
    Curseforge,
    Prism,
    Multimc,
    Official,
}

impl Launcher {
    pub fn label(self) -> &'static str {
        match self {
            Launcher::Modrinth => "Modrinth App",
            Launcher::Curseforge => "CurseForge",
            Launcher::Prism => "Prism Launcher",
            Launcher::Multimc => "MultiMC",
            Launcher::Official => "Minecraft Launcher",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub launcher: Launcher,
    pub name: String,
    /// Oyun klasörü (.minecraft eşdeğeri)
    pub game_dir: String,
    pub mc_version: Option<String>,
    pub loader: Loader,
    pub mod_count: usize,
    pub world_count: usize,
    pub has_shaders: bool,
}

/// Aktarılan öğeler — yalnızca oyuncuya ait içerik; önbellek/log/kütüphane yok.
const ITEMS: &[&str] = &[
    "mods", "config", "defaultconfigs", "kubejs", "scripts", "resourcepacks", "shaderpacks", "options.txt",
    "optionsof.txt", "optionsshaders.txt", "servers.dat", "screenshots", "schematics", "journeymap", "xaero",
];

fn count(dir: &Path, ext: Option<&str>) -> usize {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().filter(|e| ext.map(|x| e.path().extension().map(|y| y == x).unwrap_or(false)).unwrap_or_else(|| e.path().is_dir())).count())
        .unwrap_or(0)
}

fn found(launcher: Launcher, name: String, game: &Path, mc: Option<String>, loader: Loader) -> Option<Found> {
    if !game.is_dir() {
        return None;
    }
    let (mc, loader) = if mc.is_none() || loader.kind == LoaderKind::Vanilla && game.join("mods").is_dir() {
        let (m2, l2) = sniff(game);
        (mc.or(m2), if loader.kind == LoaderKind::Vanilla { l2.unwrap_or(loader) } else { loader })
    } else {
        (mc, loader)
    };
    Some(Found {
        launcher,
        name,
        game_dir: game.display().to_string(),
        mc_version: mc,
        loader,
        mod_count: count(&game.join("mods"), Some("jar")),
        world_count: count(&game.join("saves"), None),
        has_shaders: count(&game.join("shaderpacks"), None) + count(&game.join("shaderpacks"), Some("zip")) > 0,
    })
}

static LOG_FABRIC: Lazy<Regex> = Lazy::new(|| Regex::new(r"Loading Minecraft ([\w.\-]+) with (Fabric|Quilt) Loader ([\w.\-+]+)").unwrap());
static LOG_FML_MC: Lazy<Regex> = Lazy::new(|| Regex::new(r"--fml\.mcVersion,? ([\w.\-]+)").unwrap());
static LOG_FORGE: Lazy<Regex> = Lazy::new(|| Regex::new(r"--fml\.forgeVersion,? ([\w.\-]+)").unwrap());
static LOG_NEO: Lazy<Regex> = Lazy::new(|| Regex::new(r"--fml\.neoForgeVersion,? ([\w.\-]+)").unwrap());
static LOG_MC: Lazy<Regex> = Lazy::new(|| Regex::new(r"Minecraft (?:Version:? )?(1\.\d+(?:\.\d+)?)").unwrap());

/// Meta veri yoksa son oyun logundan sürüm ve loader tahmini.
pub fn sniff(game: &Path) -> (Option<String>, Option<Loader>) {
    let Ok(text) = std::fs::read_to_string(game.join("logs").join("latest.log")) else { return (None, None) };
    let head: String = text.lines().take(400).collect::<Vec<_>>().join("\n");
    if let Some(c) = LOG_FABRIC.captures(&head) {
        let kind = if &c[2] == "Quilt" { LoaderKind::Quilt } else { LoaderKind::Fabric };
        return (Some(c[1].to_string()), Some(Loader { kind, version: Some(c[3].to_string()) }));
    }
    let mc = LOG_FML_MC.captures(&head).map(|c| c[1].to_string());
    if let Some(c) = LOG_NEO.captures(&head) {
        return (mc, Some(Loader { kind: LoaderKind::NeoForge, version: Some(c[1].to_string()) }));
    }
    if let Some(c) = LOG_FORGE.captures(&head) {
        return (mc, Some(Loader { kind: LoaderKind::Forge, version: Some(c[1].to_string()) }));
    }
    (mc.or_else(|| LOG_MC.captures(&head).map(|c| c[1].to_string())), None)
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

fn data_dirs(name: &str) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = dirs::data_dir() {
        v.push(d.join(name));
    }
    if let Some(d) = dirs::config_dir() {
        v.push(d.join(name));
    }
    v
}

// ───────── Prism / MultiMC ─────────

#[derive(Deserialize)]
struct MmcPack {
    components: Vec<MmcComponent>,
}
#[derive(Deserialize)]
struct MmcComponent {
    uid: String,
    version: Option<String>,
}

fn scan_mmc(root: &Path, launcher: Launcher, out: &mut Vec<Found>) {
    let Ok(rd) = std::fs::read_dir(root.join("instances")) else { return };
    for e in rd.flatten() {
        let dir = e.path();
        let Ok(pack) = std::fs::read(dir.join("mmc-pack.json")).map_err(|_| ()).and_then(|b| serde_json::from_slice::<MmcPack>(&b).map_err(|_| ())) else { continue };
        let name = std::fs::read_to_string(dir.join("instance.cfg"))
            .ok()
            .and_then(|cfg| cfg.lines().find_map(|l| l.strip_prefix("name=").map(|s| s.trim().to_string())))
            .unwrap_or_else(|| e.file_name().to_string_lossy().into_owned());
        let mut mc = None;
        let mut loader = Loader { kind: LoaderKind::Vanilla, version: None };
        for c in pack.components {
            let kind = match c.uid.as_str() {
                "net.minecraft" => {
                    mc = c.version;
                    continue;
                }
                "net.fabricmc.fabric-loader" => LoaderKind::Fabric,
                "org.quiltmc.quilt-loader" => LoaderKind::Quilt,
                "net.minecraftforge" => LoaderKind::Forge,
                "net.neoforged" => LoaderKind::NeoForge,
                _ => continue,
            };
            loader = Loader { kind, version: c.version };
        }
        let game = [".minecraft", "minecraft"].iter().map(|d| dir.join(d)).find(|p| p.is_dir()).unwrap_or(dir.join(".minecraft"));
        out.extend(found(launcher, name, &game, mc, loader));
    }
}

// ───────── CurseForge ─────────

fn scan_curseforge(root: &Path, out: &mut Vec<Found>) {
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let dir = e.path();
        let Ok(bytes) = std::fs::read(dir.join("minecraftinstance.json")) else { continue };
        let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or_default();
        let name = v["name"].as_str().map(String::from).unwrap_or_else(|| e.file_name().to_string_lossy().into_owned());
        let mc = v["gameVersion"].as_str().or(v["baseModLoader"]["minecraftVersion"].as_str()).map(String::from);
        // "forge-47.2.0", "neoforge-21.1.77", "fabric-0.16.9-1.21.1"
        let raw = v["baseModLoader"]["name"].as_str().unwrap_or("");
        let mut parts = raw.splitn(2, '-');
        let (kind_s, ver) = (parts.next().unwrap_or(""), parts.next().map(String::from));
        let kind = match kind_s {
            "forge" => LoaderKind::Forge,
            "neoforge" => LoaderKind::NeoForge,
            "fabric" => LoaderKind::Fabric,
            "quilt" => LoaderKind::Quilt,
            _ => LoaderKind::Vanilla,
        };
        let ver = ver.map(|v| if matches!(kind, LoaderKind::Fabric | LoaderKind::Quilt) { v.split('-').next().unwrap_or(&v).to_string() } else { v });
        out.extend(found(Launcher::Curseforge, name, &dir, mc, Loader { kind, version: ver.filter(|_| kind != LoaderKind::Vanilla) }));
    }
}

// ───────── Modrinth App ─────────

fn scan_modrinth(root: &Path, out: &mut Vec<Found>) {
    let Ok(rd) = std::fs::read_dir(root.join("profiles")) else { return };
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        // Eski sürümler profile.json tutar; yenileri SQLite kullanır → logdan tahmin
        let (mut mc, mut loader) = (None, Loader { kind: LoaderKind::Vanilla, version: None });
        if let Ok(b) = std::fs::read(dir.join("profile.json")) {
            let v: serde_json::Value = serde_json::from_slice(&b).unwrap_or_default();
            let meta = &v["metadata"];
            mc = meta["game_version"].as_str().map(String::from);
            loader.kind = match meta["loader"].as_str() {
                Some("fabric") => LoaderKind::Fabric,
                Some("quilt") => LoaderKind::Quilt,
                Some("forge") => LoaderKind::Forge,
                Some("neoforge") => LoaderKind::NeoForge,
                _ => LoaderKind::Vanilla,
            };
            loader.version = meta["loader_version"]["id"].as_str().map(String::from);
        }
        out.extend(found(Launcher::Modrinth, e.file_name().to_string_lossy().into_owned(), &dir, mc, loader));
    }
}

// ───────── Resmi launcher ─────────

fn scan_official(mc_dir: &Path, out: &mut Vec<Found>) {
    let Ok(b) = std::fs::read(mc_dir.join("launcher_profiles.json")) else { return };
    let v: serde_json::Value = serde_json::from_slice(&b).unwrap_or_default();
    let Some(profiles) = v["profiles"].as_object() else { return };
    let fab = Regex::new(r"^(fabric|quilt)-loader-([\w.\-+]+)-([\w.\-]+)$").unwrap();
    for (_, p) in profiles {
        let game = p["gameDir"].as_str().map(PathBuf::from).unwrap_or_else(|| mc_dir.to_path_buf());
        let last = p["lastVersionId"].as_str().unwrap_or("");
        let name = p["name"].as_str().filter(|s| !s.is_empty()).map(String::from).unwrap_or_else(|| match p["type"].as_str() {
            Some("latest-release") => "Son sürüm".into(),
            Some("latest-snapshot") => "Son snapshot".into(),
            _ => last.to_string(),
        });
        let (mc, loader) = if let Some(c) = fab.captures(last) {
            let kind = if &c[1] == "quilt" { LoaderKind::Quilt } else { LoaderKind::Fabric };
            (Some(c[3].to_string()), Loader { kind, version: Some(c[2].to_string()) })
        } else if let Some((m, f)) = last.split_once("-forge-") {
            (Some(m.to_string()), Loader { kind: LoaderKind::Forge, version: Some(f.to_string()) })
        } else if let Some(n) = last.strip_prefix("neoforge-") {
            (crate::instance::loaders::neoforge_mc_version(n), Loader { kind: LoaderKind::NeoForge, version: Some(n.to_string()) })
        } else if last.starts_with("latest") || last.is_empty() {
            (None, Loader { kind: LoaderKind::Vanilla, version: None })
        } else {
            (Some(last.to_string()), Loader { kind: LoaderKind::Vanilla, version: None })
        };
        out.extend(found(Launcher::Official, name, &game, mc, loader));
    }
}

/// Bilinen konumları tarar. Hızlıdır: yalnızca meta veri dosyaları okunur.
pub fn detect() -> Vec<Found> {
    let mut out = Vec::new();
    let h = home();
    for d in data_dirs("ModrinthApp").into_iter().chain(data_dirs("com.modrinth.theseus")) {
        scan_modrinth(&d, &mut out);
    }
    for d in [h.join("curseforge/minecraft/Instances"), h.join("Documents/curseforge/minecraft/Instances")] {
        scan_curseforge(&d, &mut out);
    }
    let mut prism = data_dirs("PrismLauncher");
    prism.push(h.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher"));
    for d in prism {
        scan_mmc(&d, Launcher::Prism, &mut out);
    }
    for d in [h.join("MultiMC"), h.join("Downloads/MultiMC"), h.join("Desktop/MultiMC")] {
        scan_mmc(&d, Launcher::Multimc, &mut out);
    }
    let official = if cfg!(target_os = "macos") {
        h.join("Library/Application Support/minecraft")
    } else if cfg!(windows) {
        dirs::data_dir().unwrap_or_default().join(".minecraft")
    } else {
        h.join(".minecraft")
    };
    scan_official(&official, &mut out);
    out.dedup_by(|a, b| a.game_dir == b.game_dir && a.name == b.name);
    out
}

/// Kullanıcının seçtiği bir klasörü tanır (taşınabilir MultiMC/Prism veya .minecraft).
pub fn detect_folder(path: &Path) -> Vec<Found> {
    let mut out = Vec::new();
    scan_mmc(path, if path.to_string_lossy().to_lowercase().contains("prism") { Launcher::Prism } else { Launcher::Multimc }, &mut out);
    scan_official(path, &mut out);
    scan_curseforge(path, &mut out);
    scan_modrinth(path, &mut out);
    out
}

fn copy_into(src: &Path, dst: &Path, on_file: &mut dyn FnMut(u64)) -> Result<u64> {
    let mut n = 0;
    if src.is_file() {
        if let Some(p) = dst.parent() {
            std::fs::create_dir_all(p)?;
        }
        std::fs::copy(src, dst)?;
        on_file(1);
        return Ok(1);
    }
    for e in walkdir::WalkDir::new(src).into_iter().flatten() {
        let rel = e.path().strip_prefix(src).unwrap();
        let t = dst.join(rel);
        if e.file_type().is_dir() {
            std::fs::create_dir_all(&t)?;
        } else if e.file_type().is_file() {
            std::fs::copy(e.path(), &t)?;
            n += 1;
            on_file(n);
        }
    }
    Ok(n)
}

/// Bulunan bir instance'ı West'e kopyalar. `mc_version` kullanıcı tarafından
/// düzeltilebilir (meta veri yoksa).
pub fn import(paths: &Paths, f: &Found, mc_version: Option<String>, include_worlds: bool, mut progress: impl FnMut(u64)) -> Result<Instance> {
    let mc = mc_version.or(f.mc_version.clone()).ok_or_else(|| AppError::msg(format!("\"{}\" için Minecraft sürümü belirlenemedi; listeden seç", f.name)))?;
    let src = PathBuf::from(&f.game_dir);
    if !src.is_dir() {
        return Err(AppError::NotFound(f.game_dir.clone()));
    }
    let mgr = InstanceManager::new(paths);
    let mut inst = mgr.create(NewInstance { name: f.name.clone(), mc_version: mc, loader: f.loader.clone(), icon: None, group: Some(f.launcher.label().into()) })?;
    let game = paths.instance_game_dir(&inst.id);
    let mut done = 0;
    let mut items: Vec<&str> = ITEMS.to_vec();
    if include_worlds {
        items.push("saves");
    }
    for item in items {
        let s = src.join(item);
        if s.exists() {
            copy_into(&s, &game.join(item), &mut |_| {
                done += 1;
                progress(done);
            })?;
        }
    }
    inst.imported_from = Some(f.launcher.label().into());
    mgr.save(&inst)?;
    Ok(inst)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prism_instance_is_detected_and_imported() {
        let root = std::env::temp_dir().join(format!("imp-{}", uuid::Uuid::new_v4()));
        let inst = root.join("prism/instances/My Pack");
        std::fs::create_dir_all(inst.join(".minecraft/mods")).unwrap();
        std::fs::create_dir_all(inst.join(".minecraft/saves/World 1")).unwrap();
        std::fs::create_dir_all(inst.join(".minecraft/logs")).unwrap();
        std::fs::write(inst.join(".minecraft/mods/sodium.jar"), b"jar").unwrap();
        std::fs::write(inst.join(".minecraft/options.txt"), b"fov:0.5").unwrap();
        std::fs::write(inst.join(".minecraft/saves/World 1/level.dat"), b"lvl").unwrap();
        std::fs::write(inst.join(".minecraft/logs/latest.log"), b"log").unwrap();
        std::fs::write(inst.join("instance.cfg"), "InstanceType=OneSix\nname=Benim Paketim\n").unwrap();
        std::fs::write(inst.join("mmc-pack.json"), r#"{"components":[{"uid":"net.minecraft","version":"1.21.1"},{"uid":"net.fabricmc.fabric-loader","version":"0.16.9"}],"formatVersion":1}"#).unwrap();

        let found = detect_folder(&root.join("prism"));
        assert_eq!(found.len(), 1);
        let f = &found[0];
        assert_eq!((f.name.as_str(), f.mc_version.as_deref(), f.loader.kind, f.mod_count, f.world_count), ("Benim Paketim", Some("1.21.1"), LoaderKind::Fabric, 1, 1));

        let paths = Paths::new(root.join("west"));
        paths.ensure().unwrap();
        let i = import(&paths, f, None, false, |_| {}).unwrap();
        let g = paths.instance_game_dir(&i.id);
        assert!(g.join("mods/sodium.jar").exists() && g.join("options.txt").exists());
        assert!(!g.join("saves/World 1").exists(), "dünyalar istenmedikçe kopyalanmaz");
        assert!(!g.join("logs/latest.log").exists(), "loglar kopyalanmaz");
        let i2 = import(&paths, f, None, true, |_| {}).unwrap();
        assert!(paths.instance_game_dir(&i2.id).join("saves/World 1/level.dat").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn log_sniffing() {
        let d = std::env::temp_dir().join(format!("sniff-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(d.join("logs")).unwrap();
        std::fs::write(d.join("logs/latest.log"), "[12:00:00] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.15.11\n").unwrap();
        let (mc, l) = sniff(&d);
        assert_eq!(mc.as_deref(), Some("1.20.1"));
        assert_eq!(l.unwrap().kind, LoaderKind::Fabric);
        std::fs::write(d.join("logs/latest.log"), "args [--fml.forgeVersion, 47.2.0, --fml.mcVersion, 1.20.1]\n").unwrap();
        let (mc, l) = sniff(&d);
        assert_eq!((mc.as_deref(), l.unwrap().kind), (Some("1.20.1"), LoaderKind::Forge));
        std::fs::remove_dir_all(d).unwrap();
    }
}
