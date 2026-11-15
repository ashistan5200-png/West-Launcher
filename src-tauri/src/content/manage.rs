//! Instance içerik yöneticisi: mods/, resourcepacks/, shaderpacks/ klasörlerindeki
//! dosyaları listeler, Modrinth'te SHA-1 ile eşleştirir (ad, simge, yazar, sürüm),
//! güncellemeleri bulur, yedek alarak günceller, açar/kapatır ve dışa aktarır.

use super::{load_index, save_index, Kind, Source};
use crate::core::http::{DownloadTask, Http};
use crate::error::{AppError, Result};
use crate::util::{sha1_file, write_json_atomic};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

const MODRINTH: &str = "https://api.modrinth.com/v2";
pub const FOLDERS: &[(&str, Kind)] = &[("mods", Kind::Mod), ("resourcepacks", Kind::Resourcepack), ("shaderpacks", Kind::Shader)];
const DISABLED: &str = ".disabled";
const ICON_MAX: u64 = 96 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version_id: String,
    pub version_number: String,
    pub file_name: String,
    pub url: String,
    pub sha1: String,
    pub size: u64,
}

/// SHA-1'e göre önbelleğe alınan bilgiler (yerel jar okuması + Modrinth eşleşmesi)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Meta {
    size: u64,
    mtime: i64,
    file_key: String,
    title: String,
    version: Option<String>,
    author: Option<String>,
    author_avatar: Option<String>,
    icon: Option<String>,
    project_id: Option<String>,
    version_id: Option<String>,
    url: Option<String>,
    download_url: Option<String>,
    sha512: Option<String>,
    remote_checked: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Cache {
    /// "mods/sodium.jar" → sha1 (boyut + mtime değişmedikçe yeniden hesaplanmaz)
    by_file: HashMap<String, Meta>,
    by_sha1: HashMap<String, Meta>,
    updates: HashMap<String, UpdateInfo>,
}

fn cache_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join("content-meta.json")
}
fn load_cache(instance_dir: &Path) -> Cache {
    std::fs::read(cache_path(instance_dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn save_cache(instance_dir: &Path, c: &Cache) {
    let _ = write_json_atomic(&cache_path(instance_dir), c);
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentFile {
    /// "mods/sodium.jar" — .disabled eki olmadan; işlemlerde kimlik olarak kullanılır
    pub id: String,
    pub file: String,
    pub kind: Kind,
    pub enabled: bool,
    pub size: u64,
    pub sha1: String,
    pub title: String,
    pub version: Option<String>,
    pub author: Option<String>,
    pub author_avatar: Option<String>,
    pub icon: Option<String>,
    pub project_id: Option<String>,
    pub source: Option<Source>,
    pub url: Option<String>,
    pub update: Option<UpdateInfo>,
    pub dependency_of: Option<String>,
    /// West Companion gibi launcher'ın kendisinin yönettiği dosyalar
    pub managed: bool,
}

fn data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn zip_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str, max: u64) -> Option<Vec<u8>> {
    let name = name.trim_start_matches("./").trim_start_matches('/');
    let mut f = zip.by_name(name).ok()?;
    if f.size() > max {
        return None;
    }
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn authors_of(v: &serde_json::Value) -> Option<String> {
    let arr = v.as_array()?;
    let names: Vec<String> = arr
        .iter()
        .filter_map(|a| a.as_str().map(String::from).or_else(|| a["name"].as_str().map(String::from)))
        .take(2)
        .collect();
    (!names.is_empty()).then(|| names.join(", "))
}

fn clean_version(v: Option<&str>) -> Option<String> {
    v.filter(|s| !s.is_empty() && !s.contains("${")).map(String::from)
}

/// Jar/zip içinden ad, sürüm, yazar ve simgeyi okur (ağ gerekmez).
fn local_meta(path: &Path, kind: Kind, fallback: &str) -> Meta {
    let mut m = Meta { title: fallback.to_string(), ..Default::default() };
    let Ok(file) = std::fs::File::open(path) else { return m };
    let Ok(mut zip) = zip::ZipArchive::new(file) else { return m };
    match kind {
        Kind::Mod => {
            if let Some(v) = zip_entry(&mut zip, "fabric.mod.json", 1 << 20).and_then(|b| lenient(&b)) {
                m.title = v["name"].as_str().unwrap_or(fallback).to_string();
                m.version = clean_version(v["version"].as_str());
                m.author = authors_of(&v["authors"]);
                let icon = v["icon"].as_str().map(String::from).or_else(|| v["icon"].as_object().and_then(|o| o.values().last()).and_then(|x| x.as_str()).map(String::from));
                m.icon = icon.and_then(|i| zip_entry(&mut zip, &i, ICON_MAX)).map(|b| data_url(&b));
            } else if let Some(v) = zip_entry(&mut zip, "quilt.mod.json", 1 << 20).and_then(|b| lenient(&b)) {
                let q = &v["quilt_loader"];
                m.title = q["metadata"]["name"].as_str().unwrap_or(fallback).to_string();
                m.version = clean_version(q["version"].as_str());
                m.author = q["metadata"]["contributors"].as_object().and_then(|o| o.keys().next().cloned());
                m.icon = q["metadata"]["icon"].as_str().map(String::from).and_then(|i| zip_entry(&mut zip, &i, ICON_MAX)).map(|b| data_url(&b));
            } else {
                let toml_bytes = zip_entry(&mut zip, "META-INF/neoforge.mods.toml", 1 << 20).or_else(|| zip_entry(&mut zip, "META-INF/mods.toml", 1 << 20));
                if let Some(t) = toml_bytes.and_then(|b| toml::from_str::<toml::Value>(&String::from_utf8_lossy(&b)).ok()) {
                    let first = t.get("mods").and_then(|x| x.as_array()).and_then(|a| a.first());
                    if let Some(md) = first {
                        m.title = md.get("displayName").and_then(|x| x.as_str()).unwrap_or(fallback).to_string();
                        m.version = clean_version(md.get("version").and_then(|x| x.as_str()));
                        m.author = md.get("authors").and_then(|x| x.as_str()).map(|s| s.split(',').next().unwrap_or(s).trim().to_string());
                        let logo = md.get("logoFile").or_else(|| t.get("logoFile")).and_then(|x| x.as_str()).map(String::from);
                        m.icon = logo.and_then(|l| zip_entry(&mut zip, &l, ICON_MAX)).map(|b| data_url(&b));
                    }
                    if m.version.is_none() {
                        m.version = zip_entry(&mut zip, "META-INF/MANIFEST.MF", 64 * 1024).and_then(|b| {
                            String::from_utf8_lossy(&b).lines().find_map(|l| l.strip_prefix("Implementation-Version:").map(|v| v.trim().to_string()))
                        });
                    }
                }
            }
        }
        Kind::Resourcepack | Kind::Shader => {
            m.icon = zip_entry(&mut zip, "pack.png", ICON_MAX).map(|b| data_url(&b));
        }
        _ => {}
    }
    m
}

fn lenient(bytes: &[u8]) -> Option<serde_json::Value> {
    serde_json::from_slice(bytes).ok().or_else(|| {
        let s: String = String::from_utf8_lossy(bytes).chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
        serde_json::from_str(&s).ok()
    })
}

fn mtime(meta: &std::fs::Metadata) -> i64 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Diskteki içerik + önbellek. Ağ kullanmaz; hızlıdır.
pub fn list(instance_dir: &Path, game_dir: &Path) -> Vec<ContentFile> {
    let mut cache = load_cache(instance_dir);
    let index = load_index(instance_dir);
    let mut out = Vec::new();
    let mut dirty = false;
    for (folder, kind) in FOLDERS {
        let Ok(rd) = std::fs::read_dir(game_dir.join(folder)) else { continue };
        for e in rd.flatten() {
            let Ok(md) = e.metadata() else { continue };
            if !md.is_file() {
                continue;
            }
            let file = e.file_name().to_string_lossy().to_string();
            let enabled = !file.ends_with(DISABLED);
            let base = file.trim_end_matches(DISABLED).to_string();
            let ok_ext = match kind {
                Kind::Mod => base.ends_with(".jar"),
                _ => base.ends_with(".zip"),
            };
            if !ok_ext {
                continue;
            }
            let id = format!("{folder}/{base}");
            let (size, mt) = (md.len(), mtime(&md));
            let sha1 = match cache.by_file.get(&id) {
                Some(c) if c.size == size && c.mtime == mt => c.file_key.clone(),
                _ => {
                    let Ok(h) = sha1_file(&e.path()) else { continue };
                    cache.by_file.insert(id.clone(), Meta { size, mtime: mt, file_key: h.clone(), ..Default::default() });
                    dirty = true;
                    h
                }
            };
            if !cache.by_sha1.contains_key(&sha1) {
                let pretty = base.trim_end_matches(".jar").trim_end_matches(".zip").to_string();
                cache.by_sha1.insert(sha1.clone(), local_meta(&e.path(), *kind, &pretty));
                dirty = true;
            }
            let m = &cache.by_sha1[&sha1];
            let idx = index.iter().find(|i| i.file == base);
            out.push(ContentFile {
                id,
                file,
                kind: *kind,
                enabled,
                size,
                sha1: sha1.clone(),
                title: m.title.clone(),
                version: m.version.clone(),
                author: m.author.clone(),
                author_avatar: m.author_avatar.clone(),
                icon: m.icon.clone(),
                project_id: m.project_id.clone().or_else(|| idx.map(|i| i.project_id.clone())),
                source: if m.project_id.is_some() { Some(Source::Modrinth) } else { idx.map(|i| i.source) },
                url: m.url.clone(),
                update: cache.updates.get(&sha1).cloned(),
                dependency_of: idx.and_then(|i| i.dependency_of.clone()),
                managed: base.starts_with(crate::companion::JAR_PREFIX),
            });
        }
    }
    if dirty {
        save_cache(instance_dir, &cache);
    }
    out.sort_by_key(|c| c.title.to_lowercase());
    out
}

#[derive(Deserialize)]
struct MrFile {
    hashes: HashMap<String, String>,
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    size: u64,
}
#[derive(Deserialize)]
struct MrVersion {
    id: String,
    project_id: String,
    version_number: String,
    files: Vec<MrFile>,
}
#[derive(Deserialize)]
struct MrProject {
    id: String,
    slug: String,
    title: String,
    project_type: String,
    icon_url: Option<String>,
    team: String,
}
#[derive(Deserialize)]
struct MrMember {
    team_id: String,
    role: String,
    user: MrUser,
}
#[derive(Deserialize)]
struct MrUser {
    username: String,
    avatar_url: Option<String>,
}

fn loaders_for(kind: Kind, loader: Option<&str>) -> Vec<String> {
    match kind {
        Kind::Mod => loader.map(|l| vec![l.to_string()]).unwrap_or_default(),
        Kind::Resourcepack => vec!["minecraft".into()],
        Kind::Shader => vec!["iris".into(), "optifine".into(), "canvas".into(), "vanilla".into()],
        _ => vec![],
    }
}

/// Modrinth eşleşmesi + güncelleme kontrolü. Ağ hatasında yerel bilgiyle devam eder.
pub async fn refresh(http: &Http, instance_dir: &Path, game_dir: &Path, mc: &str, loader: Option<&str>) -> Result<Vec<ContentFile>> {
    let items = {
        let (a, b) = (instance_dir.to_path_buf(), game_dir.to_path_buf());
        tokio::task::spawn_blocking(move || list(&a, &b)).await.map_err(|e| AppError::msg(e.to_string()))?
    };
    let mut cache = load_cache(instance_dir);

    // 1) Henüz Modrinth'e sorulmamış dosyalar
    let unknown: Vec<String> = items.iter().filter(|c| !cache.by_sha1.get(&c.sha1).map(|m| m.remote_checked).unwrap_or(false)).map(|c| c.sha1.clone()).collect();
    if !unknown.is_empty() {
        let versions: HashMap<String, MrVersion> = http
            .client
            .post(format!("{MODRINTH}/version_files"))
            .json(&serde_json::json!({ "hashes": unknown, "algorithm": "sha1" }))
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let ids: Vec<String> = versions.values().map(|v| v.project_id.clone()).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
        let mut projects: HashMap<String, MrProject> = HashMap::new();
        let mut owners: HashMap<String, MrUser> = HashMap::new();
        for chunk in ids.chunks(100) {
            let url = format!("{MODRINTH}/projects?ids={}", urlencode(&serde_json::to_string(chunk)?));
            let ps: Vec<MrProject> = http.json(&url).await?;
            let teams: Vec<String> = ps.iter().map(|p| p.team.clone()).collect();
            let url = format!("{MODRINTH}/teams?ids={}", urlencode(&serde_json::to_string(&teams)?));
            // Yanıt sırası istek sırasıyla aynı değil: takım kimliğiyle eşleştir
            if let Ok(ts) = http.json::<Vec<Vec<MrMember>>>(&url).await {
                for mut members in ts {
                    let Some(team) = members.first().map(|m| m.team_id.clone()) else { continue };
                    let Some(p) = ps.iter().find(|p| p.team == team) else { continue };
                    let pos = members.iter().position(|m| m.role.eq_ignore_ascii_case("owner")).unwrap_or(0);
                    owners.insert(p.id.clone(), members.swap_remove(pos).user);
                }
            }
            projects.extend(ps.into_iter().map(|p| (p.id.clone(), p)));
        }
        for sha in &unknown {
            let m = cache.by_sha1.entry(sha.clone()).or_default();
            m.remote_checked = true;
            let Some(v) = versions.get(sha) else { continue };
            let file = v.files.iter().find(|f| f.hashes.get("sha1").map(|h| h.eq_ignore_ascii_case(sha)).unwrap_or(false));
            m.project_id = Some(v.project_id.clone());
            m.version_id = Some(v.id.clone());
            m.version = Some(v.version_number.clone());
            if let Some(f) = file {
                m.download_url = Some(f.url.clone());
                m.sha512 = f.hashes.get("sha512").cloned();
            }
            if let Some(p) = projects.get(&v.project_id) {
                m.title = p.title.clone();
                m.url = Some(format!("https://modrinth.com/{}/{}", p.project_type, p.slug));
                if p.icon_url.is_some() {
                    m.icon = p.icon_url.clone();
                }
            }
            if let Some(u) = owners.get(&v.project_id) {
                m.author = Some(u.username.clone());
                m.author_avatar = u.avatar_url.clone();
            }
        }
    }

    // 2) Güncellemeler (klasör türüne göre farklı loader filtresi)
    cache.updates.clear();
    for (_, kind) in FOLDERS {
        let hashes: Vec<String> = items.iter().filter(|c| c.kind == *kind && !c.managed && cache.by_sha1.get(&c.sha1).and_then(|m| m.project_id.as_ref()).is_some()).map(|c| c.sha1.clone()).collect();
        if hashes.is_empty() {
            continue;
        }
        let body = serde_json::json!({ "hashes": hashes, "algorithm": "sha1", "loaders": loaders_for(*kind, loader), "game_versions": [mc] });
        let resp = http.client.post(format!("{MODRINTH}/version_files/update")).json(&body).send().await?;
        let Ok(latest) = resp.error_for_status()?.json::<HashMap<String, MrVersion>>().await else { continue };
        for (sha, v) in latest {
            if cache.by_sha1.get(&sha).and_then(|m| m.version_id.as_deref()) == Some(v.id.as_str()) {
                continue;
            }
            let Some(f) = v.files.iter().find(|f| f.primary).or_else(|| v.files.first()) else { continue };
            let Some(fsha) = f.hashes.get("sha1") else { continue };
            if fsha.eq_ignore_ascii_case(&sha) {
                continue;
            }
            cache.updates.insert(sha, UpdateInfo { version_id: v.id.clone(), version_number: v.version_number.clone(), file_name: f.filename.clone(), url: f.url.clone(), sha1: fsha.clone(), size: f.size });
        }
    }
    save_cache(instance_dir, &cache);
    let (a, b) = (instance_dir.to_path_buf(), game_dir.to_path_buf());
    tokio::task::spawn_blocking(move || list(&a, &b)).await.map_err(|e| AppError::msg(e.to_string()))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// "mods/x.jar" kimliğini güvenli bir yola çevirir; gerçek dosya (.disabled olabilir) döner.
pub fn resolve(game_dir: &Path, id: &str) -> Result<(PathBuf, bool)> {
    let (folder, name) = id.split_once('/').ok_or_else(|| AppError::msg("Geçersiz içerik"))?;
    if !FOLDERS.iter().any(|(f, _)| *f == folder) || name.contains('/') || name.contains('\\') || name.contains("..") || name.is_empty() {
        return Err(AppError::msg("Geçersiz içerik yolu"));
    }
    let on = game_dir.join(folder).join(name);
    if on.exists() {
        return Ok((on, true));
    }
    let off = game_dir.join(folder).join(format!("{name}{DISABLED}"));
    if off.exists() {
        return Ok((off, false));
    }
    Err(AppError::msg(format!("{name} bulunamadı")))
}

pub fn set_enabled(game_dir: &Path, ids: &[String], enabled: bool) -> Result<()> {
    for id in ids {
        let (path, is_on) = resolve(game_dir, id)?;
        if is_on == enabled {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        let target = if enabled { name.trim_end_matches(DISABLED).to_string() } else { format!("{name}{DISABLED}") };
        std::fs::rename(&path, path.with_file_name(target))?;
    }
    Ok(())
}

pub fn delete(instance_dir: &Path, game_dir: &Path, ids: &[String]) -> Result<()> {
    let mut index = load_index(instance_dir);
    for id in ids {
        let (path, _) = resolve(game_dir, id)?;
        if trash::delete(&path).is_err() {
            std::fs::remove_file(&path)?;
        }
        let base = id.split_once('/').map(|x| x.1).unwrap_or(id);
        index.retain(|i| i.file != base);
    }
    save_index(instance_dir, &index)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReport {
    pub updated: Vec<String>,
    pub failed: Vec<String>,
    pub backup_dir: Option<String>,
}

/// Seçilen içerikleri günceller. Eskiler önce yedek klasörüne kopyalanır;
/// yeni dosya SHA-1 ile doğrulanmadan eski silinmez.
pub async fn update(http: &Http, instance_dir: &Path, game_dir: &Path, backups: &Path, ids: &[String], mut on_step: impl FnMut(usize, usize)) -> Result<UpdateReport> {
    let cache = load_cache(instance_dir);
    let items = list(instance_dir, game_dir);
    let todo: Vec<&ContentFile> = items.iter().filter(|c| ids.contains(&c.id) && c.update.is_some()).collect();
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let backup_dir = backups.join(format!("content-{stamp}"));
    let mut rep = UpdateReport { updated: vec![], failed: vec![], backup_dir: None };
    let mut index = load_index(instance_dir);
    for (n, c) in todo.iter().enumerate() {
        on_step(n, todo.len());
        let u = c.update.as_ref().unwrap();
        let folder = c.id.split_once('/').unwrap().0;
        let result: Result<()> = async {
            if u.file_name.contains('/') || u.file_name.contains('\\') || u.file_name.contains("..") {
                return Err(AppError::msg("Geçersiz dosya adı"));
            }
            let (old, enabled) = resolve(game_dir, &c.id)?;
            std::fs::create_dir_all(backup_dir.join(folder))?;
            std::fs::copy(&old, backup_dir.join(folder).join(old.file_name().unwrap()))?;
            let new_name = if enabled { u.file_name.clone() } else { format!("{}{DISABLED}", u.file_name) };
            let target = game_dir.join(folder).join(&new_name);
            http.download(&DownloadTask { url: u.url.clone(), path: target.clone(), sha1: Some(u.sha1.clone()), size: Some(u.size) }).await?;
            if old != target {
                std::fs::remove_file(&old)?;
            }
            let base = c.id.split_once('/').unwrap().1;
            if let Some(i) = index.iter_mut().find(|i| i.file == base) {
                i.file = u.file_name.clone();
                i.version_id = u.version_id.clone();
            }
            Ok(())
        }
        .await;
        match result {
            Ok(()) => rep.updated.push(c.title.clone()),
            Err(e) => rep.failed.push(format!("{}: {e}", c.title)),
        }
    }
    on_step(todo.len(), todo.len());
    let _ = save_index(instance_dir, &index);
    if !rep.updated.is_empty() {
        rep.backup_dir = Some(backup_dir.display().to_string());
    }
    drop(cache);
    Ok(rep)
}

/// Kullanıcının seçtiği dosyaları doğru klasöre kopyalar.
pub fn add_files(game_dir: &Path, paths: &[String]) -> Result<Vec<String>> {
    let mut added = vec![];
    for p in paths {
        let src = PathBuf::from(p);
        let name = src.file_name().ok_or_else(|| AppError::msg("Geçersiz dosya"))?.to_string_lossy().to_string();
        let lower = name.to_lowercase();
        let folder = if lower.ends_with(".jar") {
            "mods"
        } else if lower.ends_with(".zip") {
            let is_shader = std::fs::File::open(&src).ok().and_then(|f| zip::ZipArchive::new(f).ok()).map(|z| z.file_names().any(|n| n.starts_with("shaders/"))).unwrap_or(false);
            if is_shader { "shaderpacks" } else { "resourcepacks" }
        } else {
            return Err(AppError::msg(format!("{name}: yalnızca .jar (mod) veya .zip (paket) eklenebilir")));
        };
        let dir = game_dir.join(folder);
        std::fs::create_dir_all(&dir)?;
        std::fs::copy(&src, dir.join(&name))?;
        added.push(format!("{folder}/{name}"));
    }
    Ok(added)
}

// ───────── Dünyalar ─────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub folder: String,
    pub size: u64,
    pub last_played: Option<i64>,
    pub icon: Option<String>,
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p).into_iter().flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum()
}

pub fn worlds(game_dir: &Path) -> Vec<World> {
    let mut out: Vec<World> = std::fs::read_dir(game_dir.join("saves"))
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().join("level.dat").exists())
                .map(|e| {
                    let p = e.path();
                    World {
                        folder: e.file_name().to_string_lossy().to_string(),
                        size: dir_size(&p),
                        last_played: std::fs::metadata(p.join("level.dat")).ok().map(|m| mtime(&m)),
                        icon: std::fs::read(p.join("icon.png")).ok().filter(|b| b.len() < 256 * 1024).map(|b| data_url(&b)),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    out
}

fn world_dir(game_dir: &Path, folder: &str) -> Result<PathBuf> {
    if folder.is_empty() || folder.contains('/') || folder.contains('\\') || folder.contains("..") {
        return Err(AppError::msg("Geçersiz dünya"));
    }
    let p = game_dir.join("saves").join(folder);
    p.join("level.dat").exists().then_some(p).ok_or_else(|| AppError::msg("Dünya bulunamadı"))
}

/// Dünyayı zip olarak yedekler; en yeni `keep` yedek tutulur.
pub fn backup_world(game_dir: &Path, backups: &Path, folder: &str, keep: usize) -> Result<String> {
    let src = world_dir(game_dir, folder)?;
    let dir = backups.join("worlds");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("{}_{}.zip", crate::util::slugify(folder), chrono::Local::now().format("%Y-%m-%d_%H-%M-%S")));
    let mut zw = zip::ZipWriter::new(std::fs::File::create(&dest)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for e in walkdir::WalkDir::new(&src).into_iter().flatten() {
        let rel = e.path().strip_prefix(&src).unwrap();
        if rel.as_os_str().is_empty() || rel.file_name().map(|n| n == "session.lock").unwrap_or(false) {
            continue;
        }
        let name = format!("{folder}/{}", rel.to_string_lossy().replace('\\', "/"));
        if e.file_type().is_dir() {
            zw.add_directory(name, opts)?;
        } else {
            zw.start_file(name, opts)?;
            std::io::copy(&mut std::fs::File::open(e.path())?, &mut zw)?;
        }
    }
    zw.finish()?;
    // eski yedekleri buda
    let prefix = format!("{}_", crate::util::slugify(folder));
    let mut olds: Vec<PathBuf> = std::fs::read_dir(&dir)?.flatten().map(|e| e.path()).filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with(&prefix)).unwrap_or(false)).collect();
    olds.sort();
    while olds.len() > keep.max(1) {
        let _ = std::fs::remove_file(olds.remove(0));
    }
    Ok(dest.display().to_string())
}

pub fn delete_world(game_dir: &Path, folder: &str) -> Result<()> {
    let p = world_dir(game_dir, folder)?;
    trash::delete(&p).map_err(|e| AppError::msg(format!("Çöp kutusuna taşınamadı: {e}")))
}

// ───────── Loglar ─────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFile {
    pub path: String,
    pub size: u64,
    pub modified: i64,
    pub crash: bool,
}

pub fn logs(game_dir: &Path) -> Vec<LogFile> {
    let mut out = vec![];
    for (dir, crash) in [("logs", false), ("crash-reports", true)] {
        if let Ok(rd) = std::fs::read_dir(game_dir.join(dir)) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                let Ok(md) = e.metadata() else { continue };
                if md.is_file() && (name.ends_with(".log") || name.ends_with(".log.gz") || name.ends_with(".txt")) {
                    out.push(LogFile { path: format!("{dir}/{name}"), size: md.len(), modified: mtime(&md), crash });
                }
            }
        }
    }
    out.sort_by_key(|l| std::cmp::Reverse(l.modified));
    out
}

/// Log dosyasının son ~1.5 MB'ını okur (.gz açılır).
pub fn read_log(game_dir: &Path, rel: &str) -> Result<String> {
    let (dir, name) = rel.split_once('/').ok_or_else(|| AppError::msg("Geçersiz log"))?;
    if !matches!(dir, "logs" | "crash-reports") || name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err(AppError::msg("Geçersiz log"));
    }
    let p = game_dir.join(dir).join(name);
    let mut bytes = Vec::new();
    if name.ends_with(".gz") {
        flate2::read::GzDecoder::new(std::fs::File::open(&p)?).take(32 << 20).read_to_end(&mut bytes)?;
    } else {
        bytes = std::fs::read(&p)?;
    }
    const MAX: usize = 1_500_000;
    if bytes.len() > MAX {
        bytes.drain(..bytes.len() - MAX);
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

// ───────── Dosyalar ─────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub modified: i64,
}

pub fn list_dir(game_dir: &Path, rel: &str) -> Result<Vec<FileEntry>> {
    let dir = if rel.is_empty() { game_dir.to_path_buf() } else { game_dir.join(super::safe_rel(rel).ok_or_else(|| AppError::msg("Geçersiz yol"))?) };
    let mut out: Vec<FileEntry> = std::fs::read_dir(&dir)?
        .flatten()
        .filter_map(|e| {
            let md = e.metadata().ok()?;
            Some(FileEntry { name: e.file_name().to_string_lossy().to_string(), dir: md.is_dir(), size: if md.is_dir() { 0 } else { md.len() }, modified: mtime(&md) })
        })
        .collect();
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

// ───────── Paylaş: .mrpack dışa aktarma ─────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub path: String,
    /// Modrinth bağlantısıyla eklenen (paket küçük kalır)
    pub linked: usize,
    /// Pakete gömülen dosyalar (Modrinth'te bulunamayanlar + ayarlar)
    pub embedded: usize,
}

pub struct ExportOpts<'a> {
    pub name: &'a str,
    pub version: &'a str,
    pub mc: &'a str,
    pub loader: Option<(&'a str, &'a str)>,
    /// Pakete eklenecek ek klasör/dosyalar (config, options.txt …)
    pub extras: &'a [String],
}

pub fn export_mrpack(instance_dir: &Path, game_dir: &Path, dest: &Path, o: &ExportOpts) -> Result<ExportReport> {
    let cache = load_cache(instance_dir);
    let items = list(instance_dir, game_dir);
    let mut files = vec![];
    let mut zw = zip::ZipWriter::new(std::fs::File::create(dest)?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let (mut linked, mut embedded) = (0, 0);
    for c in items.iter().filter(|c| c.enabled && !c.managed) {
        let folder = c.id.split_once('/').unwrap().0;
        let m = cache.by_sha1.get(&c.sha1);
        match m.and_then(|m| Some((m.download_url.clone()?, m.sha512.clone()?))) {
            Some((url, sha512)) => {
                files.push(serde_json::json!({
                    "path": c.id, "hashes": { "sha1": c.sha1, "sha512": sha512 },
                    "env": { "client": "required", "server": if folder == "mods" { "required" } else { "unsupported" } },
                    "downloads": [url], "fileSize": c.size,
                }));
                linked += 1;
            }
            None => {
                zw.start_file(format!("overrides/{}", c.id), opts)?;
                std::io::copy(&mut std::fs::File::open(game_dir.join(&c.id))?, &mut zw)?;
                embedded += 1;
            }
        }
    }
    for extra in o.extras {
        let Some(rel) = super::safe_rel(extra) else { continue };
        let src = game_dir.join(&rel);
        for e in walkdir::WalkDir::new(&src).into_iter().flatten().filter(|e| e.file_type().is_file()) {
            let r = e.path().strip_prefix(game_dir).unwrap().to_string_lossy().replace('\\', "/");
            zw.start_file(format!("overrides/{r}"), opts)?;
            std::io::copy(&mut std::fs::File::open(e.path())?, &mut zw)?;
            embedded += 1;
        }
    }
    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), o.mc.into());
    if let Some((k, v)) = o.loader {
        let key = match k {
            "fabric" => "fabric-loader",
            "quilt" => "quilt-loader",
            "forge" => "forge",
            "neoforge" => "neoforge",
            _ => "",
        };
        if !key.is_empty() {
            deps.insert(key.into(), v.into());
        }
    }
    let index = serde_json::json!({ "formatVersion": 1, "game": "minecraft", "versionId": o.version, "name": o.name, "summary": "West Client ile paylaşıldı", "files": files, "dependencies": deps });
    zw.start_file("modrinth.index.json", opts)?;
    std::io::Write::write_all(&mut zw, serde_json::to_vec_pretty(&index)?.as_slice())?;
    zw.finish()?;
    Ok(ExportReport { path: dest.display().to_string(), linked, embedded })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggle_delete_and_list() {
        let root = std::env::temp_dir().join(format!("west-manage-{}", uuid::Uuid::new_v4()));
        let game = root.join("minecraft");
        std::fs::create_dir_all(game.join("mods")).unwrap();
        // fabric.mod.json içeren sahte jar
        let mut zw = zip::ZipWriter::new(std::fs::File::create(game.join("mods/demo.jar")).unwrap());
        zw.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut zw, br#"{"id":"demo","name":"Demo Mod","version":"1.2.3","authors":["Ashi"]}"#).unwrap();
        zw.finish().unwrap();

        let l = list(&root, &game);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].title, "Demo Mod");
        assert_eq!(l[0].version.as_deref(), Some("1.2.3"));
        assert_eq!(l[0].author.as_deref(), Some("Ashi"));
        assert!(l[0].enabled);

        set_enabled(&game, &["mods/demo.jar".into()], false).unwrap();
        assert!(game.join("mods/demo.jar.disabled").exists());
        let l = list(&root, &game);
        assert!(!l[0].enabled && l[0].id == "mods/demo.jar");
        set_enabled(&game, &["mods/demo.jar".into()], true).unwrap();
        assert!(game.join("mods/demo.jar").exists());

        assert!(resolve(&game, "mods/../x.jar").is_err());
        assert!(resolve(&game, "config/a.jar").is_err());

        let dest = root.join("out.mrpack");
        let r = export_mrpack(&root, &game, &dest, &ExportOpts { name: "T", version: "1", mc: "1.21.1", loader: Some(("fabric", "0.16.9")), extras: &[] }).unwrap();
        assert_eq!((r.linked, r.embedded), (0, 1));
        let z = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        assert!(z.file_names().any(|n| n == "overrides/mods/demo.jar"));
        let _ = std::fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod live {
    use super::*;
    /// cargo test --lib live_refresh -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_refresh() {
        let http = Http::new();
        let root = std::env::temp_dir().join("west-live-manage");
        let _ = std::fs::remove_dir_all(&root);
        let game = root.join("minecraft");
        // eski AppleSkin + Sodium sürümleri (1.21.1 fabric)
        for slug in ["appleskin", "sodium"] {
            let vs: Vec<serde_json::Value> = http.json(&format!("{MODRINTH}/project/{slug}/version?loaders=%5B%22fabric%22%5D&game_versions=%5B%221.21.1%22%5D")).await.unwrap();
            let old = vs.last().unwrap();
            let f = &old["files"][0];
            http.download(&DownloadTask { url: f["url"].as_str().unwrap().into(), path: game.join("mods").join(f["filename"].as_str().unwrap()), sha1: None, size: None }).await.unwrap();
        }
        let items = refresh(&http, &root, &game, "1.21.1", Some("fabric")).await.unwrap();
        for c in &items {
            println!("{} | {:?} | {:?} | icon={} | upd={:?}", c.title, c.version, c.author, c.icon.is_some(), c.update.as_ref().map(|u| &u.version_number));
        }
        assert!(items.iter().all(|c| c.project_id.is_some() && c.update.is_some()));
        let ids: Vec<String> = items.iter().map(|c| c.id.clone()).collect();
        let rep = update(&http, &root, &game, &root.join("bk"), &ids[..1], |_, _| {}).await.unwrap();
        println!("{rep:?}");
        assert_eq!(rep.updated.len(), 1);
        let after = refresh(&http, &root, &game, "1.21.1", Some("fabric")).await.unwrap();
        assert_eq!(after.iter().filter(|c| c.update.is_some()).count(), 1);
        let r = export_mrpack(&root, &game, &root.join("p.mrpack"), &ExportOpts { name: "T", version: "1", mc: "1.21.1", loader: Some(("fabric", "0.16.9")), extras: &[] }).unwrap();
        println!("{r:?}");
        assert_eq!(r.linked, 2);
    }
}
