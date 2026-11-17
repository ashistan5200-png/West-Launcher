use super::http::{DownloadTask, Http};
use super::manifest::{AssetIndex, Library, VersionJson, LIBRARIES_URL, RESOURCES_URL};
use super::rules::{allowed, Features};
use super::{report, ProgressFn};
use crate::error::Result;
use crate::paths::{maven_path, path_to_url_segment, Paths};
use crate::util::{os_arch, os_name};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Default)]
pub struct ResolvedLibraries {
    pub downloads: Vec<DownloadTask>,
    pub classpath: Vec<PathBuf>,
    /// Çıkarılacak native arşivleri
    pub natives: Vec<PathBuf>,
}

fn native_key(lib: &Library) -> Option<String> {
    let map = lib.natives.as_ref()?;
    let raw = map.get(os_name())?;
    let bits = if os_arch() == "x86" { "32" } else { "64" };
    Some(raw.replace("${arch}", bits))
}

pub fn resolve_libraries(paths: &Paths, libs: &[Library], features: &Features) -> ResolvedLibraries {
    let root = paths.libraries();
    let mut out = ResolvedLibraries::default();

    for lib in libs {
        if !allowed(&lib.rules, features) {
            continue;
        }
        let dl = lib.downloads.clone().unwrap_or_default();

        // 1) Eski stil native classifier (LWJGL 2, <=1.18)
        if let Some(key) = native_key(lib) {
            let art = dl.classifiers.as_ref().and_then(|c| c.get(&key));
            let rel = art
                .and_then(|a| a.path.clone().map(PathBuf::from))
                .or_else(|| maven_path(&format!("{}:{key}", lib.name)));
            if let Some(rel) = rel {
                let path = root.join(&rel);
                if let Some(a) = art {
                    out.downloads.push(DownloadTask { url: a.url.clone(), path: path.clone(), sha1: a.sha1.clone(), size: a.size });
                }
                out.natives.push(path);
            }
            if dl.artifact.is_none() {
                continue;
            }
        }

        // 2) Normal artifact
        let (rel, url, sha1, size) = match &dl.artifact {
            Some(a) => {
                let rel = a.path.clone().map(PathBuf::from).or_else(|| maven_path(&lib.name));
                (rel, a.url.clone(), a.sha1.clone(), a.size)
            }
            None => {
                let rel = maven_path(&lib.name);
                let base = lib.url.clone().unwrap_or_else(|| LIBRARIES_URL.into());
                let url = rel
                    .as_ref()
                    .map(|r| format!("{}/{}", base.trim_end_matches('/'), path_to_url_segment(r)))
                    .unwrap_or_default();
                (rel, url, lib.sha1.clone(), lib.size)
            }
        };
        let Some(rel) = rel else { continue };
        let path = root.join(rel);
        // Forge'un işlemciyle ürettiği jar'ların URL'si boştur — sadece classpath.
        if !url.is_empty() {
            out.downloads.push(DownloadTask { url, path: path.clone(), sha1, size });
        }
        if lib.is_native_classifier() {
            out.natives.push(path.clone());
        }
        if !out.classpath.contains(&path) {
            out.classpath.push(path);
        }
    }
    out
}

/// Native kütüphaneleri düz olarak bir klasöre çıkarır (LWJGL 2 & 3 uyumlu) ve kullanılan klasörü döner.
///
/// Windows'ta önceki oyun tam kapanmadıysa ya da antivirüs tarıyorsa DLL'ler kilitli kalır ve klasör silinemez.
/// Bu durumda hata vermek yerine yanına yeni bir klasör açılır (natives-<zaman>); eski kopyalar sonra temizlenir.
pub fn extract_natives(archives: &[PathBuf], dest: &Path) -> Result<PathBuf> {
    let parent = dest.parent().map(Path::to_path_buf).unwrap_or_default();
    let base = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "natives".into());
    let dest = if !dest.exists() || crate::util::retry(|| std::fs::remove_dir_all(dest)).is_ok() {
        dest.to_path_buf()
    } else {
        let alt = parent.join(format!("{base}-{}", chrono::Utc::now().timestamp_millis()));
        tracing::warn!("natives klasörü kilitli ({}); {} kullanılıyor", dest.display(), alt.display());
        alt
    };
    // Önceki seferlerden kalan yedek klasörleri sessizce temizle (kilitliyse kalsın)
    if let Ok(rd) = std::fs::read_dir(&parent) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with(&format!("{base}-")) && e.path() != dest {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    std::fs::create_dir_all(&dest).map_err(|e| crate::error::AppError::at(&dest, e))?;
    for archive in archives {
        let Ok(file) = std::fs::File::open(archive) else { continue };
        let mut zip = zip::ZipArchive::new(file)?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i)?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();
            if name.starts_with("META-INF") {
                continue;
            }
            let is_native = [".so", ".dll", ".dylib", ".jnilib"].iter().any(|e| name.ends_with(e));
            if !is_native {
                continue;
            }
            // Mimari uyuşmazlığını önle (LWJGL3 jar'ları x64/arm64 alt klasörleri içerir)
            if os_arch() == "x86_64" && (name.contains("arm64") || name.contains("aarch64")) {
                continue;
            }
            if os_arch() == "arm64" && (name.contains("/x64/") || name.contains("x86_64")) {
                continue;
            }
            let file_name = Path::new(&name).file_name().unwrap().to_owned();
            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;
            let out = dest.join(file_name);
            crate::util::retry(|| std::fs::write(&out, &buf)).map_err(|e| crate::error::AppError::at(&out, e))?;
        }
    }
    Ok(dest)
}

/// Bir sürümün oynanabilmesi için gereken her şeyi indirir.
pub async fn install_version(
    http: &Http,
    paths: &Paths,
    version: &VersionJson,
    concurrency: usize,
    task: &str,
    progress: ProgressFn,
) -> Result<ResolvedLibraries> {
    report(&progress, task, "manifest", 0, 1);
    let mut downloads = Vec::new();

    // Client jar
    if let Some(client) = version.downloads.as_ref().and_then(|d| d.client.clone()) {
        downloads.push(DownloadTask {
            url: client.url,
            path: paths.version_jar(version.client_jar_id()),
            sha1: client.sha1,
            size: client.size,
        });
    }

    // Kütüphaneler
    let libs = resolve_libraries(paths, &version.libraries, &Features::default());
    downloads.extend(libs.downloads.iter().cloned());

    // Asset'ler
    let mut asset_index: Option<(String, AssetIndex)> = None;
    if let Some(idx) = &version.asset_index {
        let path = paths.assets().join("indexes").join(format!("{}.json", idx.id));
        let index: AssetIndex = http.json_cached(&idx.url, &path, Some(&idx.sha1)).await?;
        let objects = paths.assets().join("objects");
        let mut seen = std::collections::HashSet::new();
        for obj in index.objects.values() {
            if !seen.insert(obj.hash.clone()) {
                continue;
            }
            let prefix = &obj.hash[..2];
            downloads.push(DownloadTask {
                url: format!("{RESOURCES_URL}/{prefix}/{}", obj.hash),
                path: objects.join(prefix).join(&obj.hash),
                sha1: Some(obj.hash.clone()),
                size: Some(obj.size),
            });
        }
        asset_index = Some((idx.id.clone(), index));
    }
    report(&progress, task, "manifest", 1, 1);

    let p = progress.clone();
    let t = task.to_string();
    http.download_all(downloads, concurrency, move |done, total| report(&p, &t, "files", done, total))
        .await?;

    // Eski sürümler (<1.7.3) için sanal asset ağacı
    if let Some((id, index)) = asset_index {
        if index.is_virtual || index.map_to_resources {
            let virt = paths.assets().join("virtual").join(&id);
            for (name, obj) in &index.objects {
                let target = virt.join(name);
                if target.exists() {
                    continue;
                }
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let src = paths.assets().join("objects").join(&obj.hash[..2]).join(&obj.hash);
                std::fs::copy(src, target)?;
            }
        }
    }

    report(&progress, task, "done", 1, 1);
    Ok(libs)
}
