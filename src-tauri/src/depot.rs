//! West Depo: West hesabına sahip Onaylı oyuncuların paylaştığı modlar, kaynak paketleri, shader'lar,
//! dünyalar, şematikler… Dosyalar Supabase Storage'da ("depot" deposu) durur; kim yükleyebilir, kim
//! kaldırabilir veritabanı kurallarıyla (supabase/depot.sql) belirlenir.
//!
//! Yüklemeden önce dosyanın türü içeriğinden doğrulanır (ör. bir .jar gerçekten mod mu); çalıştırılabilir
//! dosyalar hiç kabul edilmez. İndirilen dosyanın SHA-256 özeti yüklenenle karşılaştırılır; dünya
//! arşivleri klasör dışına dosya yazamayacak şekilde açılır.

use crate::error::{AppError, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// Supabase ücretsiz planının dosya başına sınırı
pub const MAX_SIZE: u64 = 50 * 1024 * 1024;
/// Bir dünya arşivinin açılmış hâli için üst sınır (zip bombasına karşı)
const MAX_UNPACKED: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;

/// Hiçbir zaman kabul edilmeyen uzantılar (çalıştırılabilir / betik)
const BLOCKED: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "hta", "cpl", "dll", "sys", "lnk",
    "sh", "bash", "command", "app", "dmg", "pkg", "deb", "rpm", "apk", "appimage", "reg", "jnlp",
];

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Inspect {
    pub kind: String,
    pub file_name: String,
    pub size: u64,
    pub sha256: String,
    /// İçerikten okunan öneriler (formu doldurmak için)
    pub title: Option<String>,
    pub version: Option<String>,
    pub mc_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub warnings: Vec<String>,
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Dosya adını güvenli hâle getirir (yalnızca harf, rakam, nokta, tire, alt çizgi)
pub fn safe_name(name: &str) -> String {
    let base = Path::new(name).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut s: String = base.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+') { c } else { '_' }).collect();
    while s.starts_with('.') {
        s.remove(0);
    }
    if s.len() > 100 {
        let ext = ext_of(&s);
        s = format!("{}.{ext}", &s[..90]);
    }
    if s.is_empty() { "dosya".into() } else { s }
}

pub fn sha256_file(p: &Path) -> Result<String> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

fn read_entry(z: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut e = z.by_name(name).ok()?;
    if e.size() > 1024 * 1024 {
        return None;
    }
    let mut s = String::new();
    e.read_to_string(&mut s).ok()?;
    Some(s)
}

/// Arşivde, kökte ya da tek bir üst klasörün içinde `file` var mı; varsa önündeki klasör ("" ya da "Ad/")
fn find_root(names: &[String], file: &str) -> Option<String> {
    names.iter().find_map(|n| {
        if n == file {
            return Some(String::new());
        }
        let (dir, rest) = n.split_once('/')?;
        (rest == file && !dir.is_empty()).then(|| format!("{dir}/"))
    })
}

/// Dosyanın türünü içeriğinden belirler ve doğrular.
pub fn inspect(path: &Path) -> Result<Inspect> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(AppError::msg(crate::i18n::t("Geçersiz dosya")));
    }
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if meta.len() > MAX_SIZE {
        return Err(AppError::msg(crate::i18n::t("Dosya en fazla 50 MB olabilir. Büyük dünyaları küçültmek için gereksiz bölgeleri silip yeniden sıkıştır.")));
    }
    let ext = ext_of(&name);
    if BLOCKED.contains(&ext.as_str()) {
        return Err(AppError::msg(crate::i18n::t("Çalıştırılabilir dosyalar ve betikler Depo'ya yüklenemez.")));
    }
    let mut out = Inspect { file_name: safe_name(&name), size: meta.len(), sha256: sha256_file(path)?, ..Default::default() };
    match ext.as_str() {
        "jar" => inspect_jar(path, &mut out)?,
        "zip" => inspect_zip(path, &mut out)?,
        "mrpack" => {
            let mut z = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| AppError::msg(crate::i18n::t("Arşiv açılamadı")))?;
            let idx = read_entry(&mut z, "modrinth.index.json").ok_or_else(|| AppError::msg(crate::i18n::t("Bu bir Modrinth modpack'i (.mrpack) değil")))?;
            let v: serde_json::Value = serde_json::from_str(&idx).unwrap_or_default();
            out.kind = "modpack".into();
            out.title = v["name"].as_str().map(String::from);
            out.version = v["versionId"].as_str().map(String::from);
            if let Some(d) = v["dependencies"].as_object() {
                if let Some(mc) = d.get("minecraft").and_then(|x| x.as_str()) {
                    out.mc_versions.push(mc.into());
                }
                for (k, l) in [("fabric-loader", "fabric"), ("quilt-loader", "quilt"), ("forge", "forge"), ("neoforge", "neoforge")] {
                    if d.contains_key(k) {
                        out.loaders.push(l.into());
                    }
                }
            }
        }
        "schem" | "schematic" | "litematic" | "nbt" => out.kind = "schematic".into(),
        _ => {
            out.kind = "other".into();
            out.warnings.push(crate::i18n::t("Dosya türü tanınmadı; \"Diğer\" olarak paylaşılır ve İndirilenler klasörüne kaydedilir."));
        }
    }
    if out.title.is_none() {
        out.title = Some(Path::new(&name).file_stem().map(|s| s.to_string_lossy().replace(['_', '-'], " ")).unwrap_or_default());
    }
    Ok(out)
}

fn inspect_jar(path: &Path, out: &mut Inspect) -> Result<()> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| AppError::msg(crate::i18n::t("Arşiv açılamadı")))?;
    out.kind = "mod".into();
    if let Some(s) = read_entry(&mut z, "fabric.mod.json") {
        let v: serde_json::Value = serde_json::from_str(&s).unwrap_or_default();
        out.loaders.push("fabric".into());
        out.title = v["name"].as_str().or(v["id"].as_str()).map(String::from);
        out.version = v["version"].as_str().map(String::from);
        if let Some(mc) = v["depends"]["minecraft"].as_str() {
            out.mc_versions.push(mc.trim_start_matches(['~', '>', '=', '^']).to_string());
        }
    } else if let Some(s) = read_entry(&mut z, "quilt.mod.json") {
        let v: serde_json::Value = serde_json::from_str(&s).unwrap_or_default();
        out.loaders.push("quilt".into());
        out.title = v["quilt_loader"]["metadata"]["name"].as_str().or(v["quilt_loader"]["id"].as_str()).map(String::from);
        out.version = v["quilt_loader"]["version"].as_str().map(String::from);
    } else if let Some(s) = read_entry(&mut z, "META-INF/neoforge.mods.toml").map(|s| ("neoforge", s)).or_else(|| read_entry(&mut z, "META-INF/mods.toml").map(|s| ("forge", s))) {
        out.loaders.push(s.0.into());
        let toml = s.1;
        let field = |k: &str| toml.lines().find_map(|l| {
            let l = l.trim();
            let (a, b) = l.split_once('=')?;
            (a.trim() == k).then(|| b.trim().trim_matches('"').to_string())
        });
        out.title = field("displayName");
        out.version = field("version").filter(|v| !v.contains("${"));
    } else if z.file_names().any(|n| n == "META-INF/MANIFEST.MF") && z.file_names().any(|n| n.ends_with(".class")) {
        return Err(AppError::msg(crate::i18n::t("Bu .jar bir Minecraft modu değil (Fabric, Quilt, Forge ya da NeoForge bilgisi yok). Programlar Depo'ya yüklenemez.")));
    } else {
        return Err(AppError::msg(crate::i18n::t("Bu .jar bir Minecraft modu değil.")));
    }
    Ok(())
}

fn inspect_zip(path: &Path, out: &mut Inspect) -> Result<()> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(path)?).map_err(|_| AppError::msg(crate::i18n::t("Arşiv açılamadı")))?;
    let names: Vec<String> = z.file_names().map(String::from).collect();
    if names.iter().any(|n| BLOCKED.contains(&ext_of(n).as_str())) {
        out.warnings.push(crate::i18n::t("Arşivde çalıştırılabilir dosyalar var; bunlar kurulurken atlanır."));
    }
    if find_root(&names, "level.dat").is_some() {
        out.kind = "world".into();
        out.loaders.push("vanilla".into());
    } else if names.iter().any(|n| n.starts_with("shaders/") || n.split_once('/').is_some_and(|(_, r)| r.starts_with("shaders/"))) {
        out.kind = "shader".into();
    } else if let Some(root) = find_root(&names, "pack.mcmeta") {
        let has_assets = names.iter().any(|n| n.starts_with(&format!("{root}assets/")));
        let has_data = names.iter().any(|n| n.starts_with(&format!("{root}data/")));
        out.kind = if has_data && !has_assets { "datapack" } else { "resourcepack" }.into();
        if let Some(s) = read_entry(&mut z, &format!("{root}pack.mcmeta")) {
            let v: serde_json::Value = serde_json::from_str(&s).unwrap_or_default();
            if let Some(d) = v["pack"]["description"].as_str() {
                out.version = None;
                if out.title.is_none() && !d.is_empty() && d.len() < 60 {
                    out.title = Some(d.to_string());
                }
            }
        }
    } else if names.iter().any(|n| n == "modrinth.index.json") {
        out.kind = "modpack".into();
    } else {
        out.kind = "other".into();
        out.warnings.push(crate::i18n::t("Arşivin türü tanınmadı; \"Diğer\" olarak paylaşılır ve İndirilenler klasörüne kaydedilir."));
    }
    Ok(())
}

// ───────── Kurulum ─────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// Dosyanın yazıldığı yer (Klasörde göster için)
    pub path: String,
    /// Kısa açıklama: "mods/örnek.jar", "saves/Dünya"
    pub place: String,
}

/// Aynı adla bir şey varsa "ad (2)" gibi boş bir ad bulur
fn unique(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let stem = Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let ext = Path::new(name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

/// İndirilmiş (özeti doğrulanmış) dosyayı türüne göre yerleştirir.
/// game_dir yoksa (instance seçilmeden) İndirilenler klasörüne kaydedilir.
pub fn place(file: &Path, file_name: &str, kind: &str, game_dir: Option<&Path>, world: Option<&str>) -> Result<Installed> {
    let name = safe_name(file_name);
    let downloads = dirs::download_dir().unwrap_or_else(std::env::temp_dir);
    let Some(game) = game_dir else {
        std::fs::create_dir_all(&downloads)?;
        let to = unique(&downloads, &name);
        std::fs::copy(file, &to)?;
        return Ok(Installed { place: to.file_name().unwrap().to_string_lossy().to_string(), path: to.display().to_string() });
    };
    let copy_to = |folder: &str| -> Result<Installed> {
        let dir = game.join(folder);
        std::fs::create_dir_all(&dir)?;
        let to = unique(&dir, &name);
        std::fs::copy(file, &to)?;
        Ok(Installed { place: format!("{folder}/{}", to.file_name().unwrap().to_string_lossy()), path: to.display().to_string() })
    };
    match kind {
        "mod" => copy_to("mods"),
        "resourcepack" => copy_to("resourcepacks"),
        "shader" => copy_to("shaderpacks"),
        "schematic" => {
            let r = copy_to("schematics")?;
            // WorldEdit de kendi klasöründen okur
            if matches!(ext_of(&name).as_str(), "schem" | "schematic") {
                let _ = copy_to("config/worldedit/schematics");
            }
            Ok(r)
        }
        "datapack" => {
            let w = world.filter(|w| !w.is_empty() && !w.contains(['/', '\\']) && *w != "." && *w != "..")
                .ok_or_else(|| AppError::msg(crate::i18n::t("Veri paketi için bir dünya seç")))?;
            let saves = game.join("saves").join(w);
            if !saves.join("level.dat").exists() {
                return Err(AppError::msg(crate::i18n::t("Dünya bulunamadı")));
            }
            copy_to(&format!("saves/{w}/datapacks"))
        }
        "world" => unpack_world(file, &name, &game.join("saves")),
        _ => {
            std::fs::create_dir_all(&downloads)?;
            let to = unique(&downloads, &name);
            std::fs::copy(file, &to)?;
            Ok(Installed { place: to.file_name().unwrap().to_string_lossy().to_string(), path: to.display().to_string() })
        }
    }
}

/// Dünya arşivini saves/ içine açar. Arşivin dışına yazan (../), mutlak yollu ya da çalıştırılabilir
/// girdiler atlanır; açılmış boyut ve girdi sayısı sınırlıdır.
pub fn unpack_world(file: &Path, name: &str, saves: &Path) -> Result<Installed> {
    let mut z = zip::ZipArchive::new(std::fs::File::open(file)?).map_err(|_| AppError::msg(crate::i18n::t("Arşiv açılamadı")))?;
    if z.len() > MAX_ENTRIES {
        return Err(AppError::msg(crate::i18n::t("Arşivde çok fazla dosya var")));
    }
    let names: Vec<String> = z.file_names().map(String::from).collect();
    let root = find_root(&names, "level.dat").ok_or_else(|| AppError::msg(crate::i18n::t("Arşivde bir Minecraft dünyası (level.dat) yok")))?;
    let folder = if root.is_empty() { Path::new(name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Dünya".into()) } else { root.trim_end_matches('/').to_string() };
    let folder = safe_name(&folder).replace('.', "_");
    std::fs::create_dir_all(saves)?;
    let target = unique(saves, &folder);
    let mut total = 0u64;
    let tmp = saves.join(format!(".west-depot-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp)?;
    let res = (|| -> Result<()> {
        for i in 0..z.len() {
            let mut e = z.by_index(i).map_err(|_| AppError::msg(crate::i18n::t("Arşiv açılamadı")))?;
            let Some(rel) = e.enclosed_name() else { continue };
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            let Some(inner) = rel_s.strip_prefix(&root) else { continue };
            if inner.is_empty() || BLOCKED.contains(&ext_of(inner).as_str()) {
                continue;
            }
            let out = tmp.join(inner);
            if !out.starts_with(&tmp) {
                continue;
            }
            if e.is_dir() {
                std::fs::create_dir_all(&out)?;
                continue;
            }
            total += e.size();
            if total > MAX_UNPACKED {
                return Err(AppError::msg(crate::i18n::t("Dünya açıldığında çok büyük (2 GB üstü)")));
            }
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut f = std::fs::File::create(&out)?;
            // Bildirilen boyuttan fazlasını yazma (sahte boyutlu girdiye karşı)
            let declared = e.size();
            let n = std::io::copy(&mut (&mut e).take(declared + 1), &mut f)?;
            if n > declared {
                return Err(AppError::msg(crate::i18n::t("Arşiv bozuk")));
            }
        }
        if !tmp.join("level.dat").exists() {
            return Err(AppError::msg(crate::i18n::t("Arşivde bir Minecraft dünyası (level.dat) yok")));
        }
        Ok(())
    })();
    if let Err(e) = res {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    std::fs::rename(&tmp, &target)?;
    Ok(Installed { place: format!("saves/{}", target.file_name().unwrap().to_string_lossy()), path: target.display().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmpdir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("west-depot-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn zip_with(path: &Path, files: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        for (n, b) in files {
            w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn detects_kinds() {
        let d = tmpdir();
        let p = |n: &str| d.as_path().join(n);
        zip_with(&p("m.jar"), &[("fabric.mod.json", r#"{"id":"x","name":"Örnek","version":"1.2","depends":{"minecraft":"~1.21.11"}}"#.as_bytes())]);
        let i = inspect(&p("m.jar")).unwrap();
        assert_eq!((i.kind.as_str(), i.title.as_deref(), i.loaders[0].as_str(), i.mc_versions[0].as_str()), ("mod", Some("Örnek"), "fabric", "1.21.11"));
        zip_with(&p("prog.jar"), &[("META-INF/MANIFEST.MF", b"Main-Class: A"), ("A.class", b"x")]);
        assert!(inspect(&p("prog.jar")).is_err());
        zip_with(&p("rp.zip"), &[("pack.mcmeta", b"{}"), ("assets/minecraft/x.png", b"x")]);
        assert_eq!(inspect(&p("rp.zip")).unwrap().kind, "resourcepack");
        zip_with(&p("dp.zip"), &[("pack.mcmeta", b"{}"), ("data/x/f.json", b"x")]);
        assert_eq!(inspect(&p("dp.zip")).unwrap().kind, "datapack");
        zip_with(&p("sh.zip"), &[("shaders/final.fsh", b"x")]);
        assert_eq!(inspect(&p("sh.zip")).unwrap().kind, "shader");
        zip_with(&p("w.zip"), &[("Dünyam/level.dat", b"x"), ("Dünyam/region/r.0.0.mca", b"y")]);
        assert_eq!(inspect(&p("w.zip")).unwrap().kind, "world");
        std::fs::write(p("a.litematic"), b"x").unwrap();
        assert_eq!(inspect(&p("a.litematic")).unwrap().kind, "schematic");
        std::fs::write(p("kotu.exe"), b"MZ").unwrap();
        assert!(inspect(&p("kotu.exe")).is_err());
    }

    #[test]
    fn world_unpack_is_contained() {
        let d = tmpdir();
        let z = d.as_path().join("w.zip");
        zip_with(&z, &[("Kale/level.dat", b"x"), ("Kale/region/r.0.0.mca", b"y"), ("Kale/../../kacak.txt", b"!"), ("Kale/virus.exe", b"MZ")]);
        let saves = d.as_path().join("game/saves");
        let r = unpack_world(&z, "w.zip", &saves).unwrap();
        assert_eq!(r.place, "saves/Kale");
        assert!(saves.join("Kale/level.dat").exists() && saves.join("Kale/region/r.0.0.mca").exists());
        assert!(!saves.join("Kale/virus.exe").exists());
        assert!(!d.as_path().join("kacak.txt").exists() && !d.as_path().join("game/kacak.txt").exists());
        // Aynı ad: ikinci kopya "Kale (2)"
        assert_eq!(unpack_world(&z, "w.zip", &saves).unwrap().place, "saves/Kale (2)");
    }

    #[test]
    fn names_are_safe() {
        assert_eq!(safe_name("../../etc/passwd"), "passwd");
        assert_eq!(safe_name("..gizli.jar"), "gizli.jar");
        assert_eq!(safe_name("Benim Modum!.jar"), "Benim_Modum_.jar");
    }
}
