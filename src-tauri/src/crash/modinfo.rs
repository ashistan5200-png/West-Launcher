//! Mod jar'larından kimlik ve zorunlu bağımlılıkları okur.
//! Desteklenen: fabric.mod.json, quilt.mod.json, META-INF/mods.toml (Forge),
//! META-INF/neoforge.mods.toml (NeoForge) ve bunların jar-in-jar alt modları.

use crate::error::Result;
use serde::Serialize;
use std::collections::BTreeSet;
use std::io::{Cursor, Read, Seek};
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    /// mods/ içindeki dosya adı (örn. "sodium-0.6.0.jar")
    pub file: String,
    /// Okunabilir ad; metadata yoksa dosya adı
    pub name: String,
    /// Bu jar'ın sağladığı tüm mod kimlikleri (ana + provides + gömülü jar'lar)
    pub provides: BTreeSet<String>,
    /// Zorunlu bağımlılık kimlikleri
    pub depends: BTreeSet<String>,
}

#[derive(Default)]
struct Meta {
    name: Option<String>,
    provides: BTreeSet<String>,
    depends: BTreeSet<String>,
    nested: Vec<String>,
}

fn read_entry<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(name).ok()?;
    let mut buf = Vec::with_capacity(f.size() as usize);
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// Bazı modların json'unda kaçışsız satır sonları olur; serde katı olduğu için temizlenir.
fn lenient_json(bytes: &[u8]) -> Option<serde_json::Value> {
    serde_json::from_slice(bytes).ok().or_else(|| {
        let s: String = String::from_utf8_lossy(bytes).chars().map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c }).collect();
        serde_json::from_str(&s).ok()
    })
}

fn parse_fabric(v: &serde_json::Value, m: &mut Meta) {
    if let Some(id) = v["id"].as_str() {
        m.provides.insert(id.to_string());
    }
    if m.name.is_none() {
        m.name = v["name"].as_str().map(String::from);
    }
    if let Some(p) = v["provides"].as_array() {
        m.provides.extend(p.iter().filter_map(|x| x.as_str().map(String::from)));
    }
    if let Some(d) = v["depends"].as_object() {
        m.depends.extend(d.keys().cloned());
    }
    if let Some(j) = v["jars"].as_array() {
        m.nested.extend(j.iter().filter_map(|x| x["file"].as_str().map(String::from)));
    }
}

fn parse_quilt(v: &serde_json::Value, m: &mut Meta) {
    let q = &v["quilt_loader"];
    if let Some(id) = q["id"].as_str() {
        m.provides.insert(id.to_string());
    }
    if m.name.is_none() {
        m.name = q["metadata"]["name"].as_str().map(String::from);
    }
    let ids = |arr: &serde_json::Value, skip_optional: bool| -> Vec<String> {
        arr.as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| match x {
                        serde_json::Value::String(s) => Some(s.clone()),
                        serde_json::Value::Object(o) => {
                            if skip_optional && o.get("optional").and_then(|b| b.as_bool()).unwrap_or(false) {
                                None
                            } else {
                                o.get("id").and_then(|s| s.as_str()).map(String::from)
                            }
                        }
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    m.provides.extend(ids(&q["provides"], false));
    m.depends.extend(ids(&q["depends"], true));
    if let Some(j) = q["jars"].as_array() {
        m.nested.extend(j.iter().filter_map(|x| x.as_str().map(String::from)));
    }
}

fn parse_mods_toml(text: &str, m: &mut Meta) {
    let Ok(doc) = text.parse::<toml::Table>() else { return };
    if let Some(mods) = doc.get("mods").and_then(|v| v.as_array()) {
        for md in mods {
            if let Some(id) = md.get("modId").and_then(|v| v.as_str()) {
                m.provides.insert(id.to_string());
            }
            if m.name.is_none() {
                m.name = md.get("displayName").and_then(|v| v.as_str()).map(String::from);
            }
        }
    }
    if let Some(deps) = doc.get("dependencies").and_then(|v| v.as_table()) {
        for list in deps.values().filter_map(|v| v.as_array()) {
            for d in list {
                let required = match d.get("type").and_then(|v| v.as_str()) {
                    Some(t) => t.eq_ignore_ascii_case("required"),
                    None => d.get("mandatory").and_then(|v| v.as_bool()).unwrap_or(false),
                };
                let client_ok = d.get("side").and_then(|v| v.as_str()).map(|s| s != "SERVER").unwrap_or(true);
                if required && client_ok {
                    if let Some(id) = d.get("modId").and_then(|v| v.as_str()) {
                        m.depends.insert(id.to_string());
                    }
                }
            }
        }
    }
}

fn parse_archive<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, m: &mut Meta, depth: u8) {
    let mut found = Meta::default();
    if let Some(b) = read_entry(zip, "fabric.mod.json") {
        if let Some(v) = lenient_json(&b) {
            parse_fabric(&v, &mut found);
        }
    }
    if let Some(b) = read_entry(zip, "quilt.mod.json") {
        if let Some(v) = lenient_json(&b) {
            parse_quilt(&v, &mut found);
        }
    }
    for toml_name in ["META-INF/neoforge.mods.toml", "META-INF/mods.toml"] {
        if let Some(b) = read_entry(zip, toml_name) {
            parse_mods_toml(&String::from_utf8_lossy(&b), &mut found);
        }
    }
    // Forge JarInJar dizini
    if found.nested.is_empty() {
        let names: Vec<String> = zip.file_names().filter(|n| n.starts_with("META-INF/jarjar/") && n.ends_with(".jar")).map(String::from).collect();
        found.nested.extend(names);
    }

    if depth == 0 {
        m.name = found.name.take();
        m.depends.extend(std::mem::take(&mut found.depends));
    }
    m.provides.extend(std::mem::take(&mut found.provides));

    if depth < 2 {
        for path in std::mem::take(&mut found.nested) {
            if let Some(bytes) = read_entry(zip, &path) {
                if let Ok(mut inner) = zip::ZipArchive::new(Cursor::new(bytes)) {
                    parse_archive(&mut inner, m, depth + 1);
                }
            }
        }
    }
}

pub fn read_mod(path: &Path) -> Result<ModInfo> {
    let file = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    let mut m = Meta::default();
    parse_archive(&mut zip, &mut m, 0);
    // Kendine bağımlılık (jar-in-jar alt modları) graf döngüsü yaratmasın
    let provides = m.provides;
    let depends = m.depends.into_iter().filter(|d| !provides.contains(d)).collect();
    Ok(ModInfo { name: m.name.unwrap_or_else(|| file.trim_end_matches(".jar").to_string()), file, provides, depends })
}

/// mods/ klasöründeki etkin jar'ları (ve yarım kalmış bir avdan kalan
/// `.ashi-off` dosyalarını) okur. Kullanıcının `.disabled` yaptığı modlara dokunulmaz.
pub fn scan(mods_dir: &Path) -> Result<Vec<ModInfo>> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(mods_dir) else { return Ok(out) };
    for e in rd.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        let real = if let Some(base) = name.strip_suffix(super::bisect::OFF_SUFFIX) {
            base.to_string()
        } else {
            name.clone()
        };
        if !real.ends_with(".jar") || !p.is_file() || real.starts_with(crate::companion::JAR_PREFIX) {
            continue;
        }
        match read_mod(&p) {
            Ok(mut m) => {
                m.file = real;
                out.push(m);
            }
            Err(err) => tracing::warn!("mod okunamadı {}: {err}", p.display()),
        }
    }
    out.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    Ok(out)
}

/// Bir jar'ın (veya içine gömülü jar'ların) verilen sınıfı içerip içermediği.
/// Gizli bağımlılıkları bulmak için: "NoClassDefFoundError: a/b/C" → C'yi hangi mod sağlıyor?
pub fn jar_has_class(path: &Path, class_path: &str) -> bool {
    fn check<R: Read + Seek>(zip: &mut zip::ZipArchive<R>, entry: &str, depth: u8) -> bool {
        if zip.by_name(entry).is_ok() {
            return true;
        }
        if depth >= 1 {
            return false;
        }
        let nested: Vec<String> = zip.file_names().filter(|n| n.ends_with(".jar")).map(String::from).collect();
        nested.iter().any(|n| {
            read_entry(zip, n).and_then(|b| zip::ZipArchive::new(Cursor::new(b)).ok()).map(|mut z| check(&mut z, entry, depth + 1)).unwrap_or(false)
        })
    }
    let entry = format!("{}.class", class_path.trim_start_matches('/'));
    std::fs::File::open(path).ok().and_then(|f| zip::ZipArchive::new(f).ok()).map(|mut z| check(&mut z, &entry, 0)).unwrap_or(false)
}
