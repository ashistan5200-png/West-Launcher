//! Java çalışma zamanı keşfi ve otomatik kurulum (Eclipse Adoptium / Temurin).

pub mod jvm;

use crate::core::http::{DownloadTask, Http};
use crate::core::{report, ProgressFn};
use crate::error::{AppError, Result};
use crate::paths::Paths;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: PathBuf,
    pub version: String,
    pub major: u32,
    pub arch: String,
    /// Launcher tarafından yönetiliyor mu
    pub managed: bool,
}

fn java_bin_name() -> &'static str {
    if cfg!(windows) { "javaw.exe" } else { "java" }
}

fn java_cli_name() -> &'static str {
    if cfg!(windows) { "java.exe" } else { "java" }
}

/// "1.8.0_402" → 8, "17.0.10" → 17, "21" → 21
pub fn parse_major(version: &str) -> Option<u32> {
    let mut it = version.split(|c: char| c == '.' || c == '_' || c == '-' || c == '+');
    let first: u32 = it.next()?.parse().ok()?;
    if first == 1 { it.next()?.parse().ok() } else { Some(first) }
}

/// `java -XshowSettings:properties -version` çıktısından sürüm ve mimari okur.
pub async fn probe(bin: &Path) -> Option<JavaInstall> {
    let cli = bin.with_file_name(java_cli_name());
    let exe = if cli.exists() { cli } else { bin.to_path_buf() };
    let mut cmd = tokio::process::Command::new(&exe);
    cmd.args(["-XshowSettings:properties", "-version"]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output()).await.ok()?.ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let ver_re = Regex::new(r"java\.version = (\S+)").unwrap();
    let arch_re = Regex::new(r"os\.arch = (\S+)").unwrap();
    let version = ver_re.captures(&text)?.get(1)?.as_str().to_string();
    let arch = arch_re.captures(&text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()).unwrap_or_default();
    Some(JavaInstall { major: parse_major(&version)?, path: bin.to_path_buf(), version, arch, managed: false })
}

fn candidate_roots(paths: &Paths) -> Vec<PathBuf> {
    let mut roots = vec![paths.java_runtimes()];
    if let Ok(h) = std::env::var("JAVA_HOME") {
        roots.push(PathBuf::from(h));
    }
    if cfg!(windows) {
        for base in ["C:\\Program Files", "C:\\Program Files (x86)"] {
            for vendor in ["Java", "Eclipse Adoptium", "Zulu", "Microsoft", "BellSoft", "Amazon Corretto"] {
                roots.push(Path::new(base).join(vendor));
            }
        }
        if let Some(d) = dirs::data_dir() {
            // Resmi launcher'ın gömülü JRE'leri
            roots.push(d.join(".minecraft").join("runtime"));
        }
        if let Some(l) = dirs::data_local_dir() {
            roots.push(l.join("Packages").join("Microsoft.4297127D64EC6_8wekyb3d8bbwe").join("LocalCache").join("Local").join("runtime"));
        }
    } else if cfg!(target_os = "macos") {
        roots.push("/Library/Java/JavaVirtualMachines".into());
        if let Some(h) = dirs::home_dir() {
            roots.push(h.join("Library/Java/JavaVirtualMachines"));
            roots.push(h.join("Library/Application Support/minecraft/runtime"));
        }
        roots.push("/opt/homebrew/opt".into());
    } else {
        roots.extend(["/usr/lib/jvm", "/usr/lib64/jvm", "/opt/java", "/opt/jdk"].map(PathBuf::from));
        if let Some(h) = dirs::home_dir() {
            roots.push(h.join(".sdkman/candidates/java"));
            roots.push(h.join(".minecraft/runtime"));
        }
    }
    roots
}

/// Sistemdeki tüm Java kurulumlarını bulur (derinlik sınırlı tarama).
pub async fn detect(paths: &Paths) -> Vec<JavaInstall> {
    let mut bins = Vec::new();
    for root in candidate_roots(paths) {
        if !root.exists() {
            continue;
        }
        for e in walkdir::WalkDir::new(&root).max_depth(6).into_iter().flatten() {
            if e.file_name() == java_bin_name() && e.path().parent().map(|p| p.ends_with("bin")).unwrap_or(false) {
                bins.push(e.path().to_path_buf());
            }
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let b = dir.join(java_bin_name());
            if b.exists() {
                bins.push(std::fs::canonicalize(&b).unwrap_or(b));
            }
        }
    }
    bins.sort();
    bins.dedup();

    let managed_root = paths.java_runtimes();
    let probes = bins.into_iter().map(|b| async move { probe(&b).await });
    let mut found: Vec<JavaInstall> = futures::future::join_all(probes)
        .await
        .into_iter()
        .flatten()
        .map(|mut j| {
            j.managed = j.path.starts_with(&managed_root);
            j
        })
        .collect();
    found.sort_by(|a, b| b.major.cmp(&a.major).then(b.managed.cmp(&a.managed)));
    found.dedup_by(|a, b| a.path == b.path);
    found
}

/// Minecraft sürümünün istediği Java'yı seçer; tercih sırası:
/// birebir major + launcher yönetimli > birebir major > yok.
pub fn pick(installs: &[JavaInstall], major: u32) -> Option<&JavaInstall> {
    let native_arch = matches!(std::env::consts::ARCH, "x86_64" | "aarch64");
    let mut matching: Vec<&JavaInstall> = installs.iter().filter(|j| j.major == major).collect();
    matching.sort_by_key(|j| {
        let arch_ok = !native_arch || j.arch.contains("64");
        (!j.managed, !arch_ok)
    });
    matching.first().copied()
}

fn adoptium_os() -> &'static str {
    if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "mac" } else { "linux" }
}

fn adoptium_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86" => "x86",
        _ => "x64",
    }
}

/// Temurin JRE'yi indirip `java/<major>/` altına kurar.
pub async fn install(http: &Http, paths: &Paths, major: u32, progress: ProgressFn) -> Result<JavaInstall> {
    let task = format!("java-{major}");
    let mut arch = adoptium_arch();
    // Java 8'in macOS ARM yapısı yok → Rosetta ile x64
    if major == 8 && cfg!(target_os = "macos") && arch == "aarch64" {
        arch = "x64";
    }
    let api = format!(
        "https://api.adoptium.net/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jre&os={}&vendor=eclipse",
        adoptium_os()
    );
    #[derive(Deserialize)]
    struct Pkg { link: String, checksum: Option<String>, name: String }
    #[derive(Deserialize)]
    struct Bin { package: Pkg }
    #[derive(Deserialize)]
    struct Asset { binary: Bin }
    let assets: Vec<Asset> = http.json(&api).await?;
    let pkg = &assets.first().ok_or_else(|| AppError::NotFound(format!("Java {major} paketi")))?.binary.package;

    let archive = paths.cache().join(&pkg.name);
    report(&progress, &task, "java", 0, 1);
    http.download(&DownloadTask { url: pkg.link.clone(), path: archive.clone(), sha1: None, size: None }).await?;
    if let Some(expected) = &pkg.checksum {
        use sha2::Digest;
        let bytes = tokio::fs::read(&archive).await?;
        let actual = hex::encode(sha2::Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(AppError::Hash { path: pkg.name.clone(), expected: expected.clone(), actual });
        }
    }

    let dest = paths.java_runtimes().join(major.to_string());
    let archive_c = archive.clone();
    let dest_c = dest.clone();
    tokio::task::spawn_blocking(move || extract_archive(&archive_c, &dest_c))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
    let _ = tokio::fs::remove_file(&archive).await;

    let bin = walkdir::WalkDir::new(&dest)
        .into_iter()
        .flatten()
        .find(|e| e.file_name() == java_bin_name() && e.path().parent().map(|p| p.ends_with("bin")).unwrap_or(false))
        .map(|e| e.into_path())
        .ok_or_else(|| AppError::msg("Kurulan arşivde java bulunamadı"))?;
    report(&progress, &task, "java", 1, 1);
    let mut j = probe(&bin).await.ok_or_else(|| AppError::msg("Kurulan Java çalıştırılamadı"))?;
    j.managed = true;
    Ok(j)
}

fn extract_archive(archive: &Path, dest: &Path) -> Result<()> {
    if dest.exists() {
        std::fs::remove_dir_all(dest)?;
    }
    std::fs::create_dir_all(dest)?;
    let name = archive.to_string_lossy();
    if name.ends_with(".zip") {
        zip::ZipArchive::new(std::fs::File::open(archive)?)?.extract(dest)?;
    } else {
        let gz = flate2::read::GzDecoder::new(std::fs::File::open(archive)?);
        tar::Archive::new(gz).unpack(dest)?;
    }
    Ok(())
}

/// Gerekli Java'yı bulur, yoksa (izin verilmişse) kurar.
pub async fn ensure(http: &Http, paths: &Paths, major: u32, auto_install: bool, progress: ProgressFn) -> Result<JavaInstall> {
    let installs = detect(paths).await;
    if let Some(j) = pick(&installs, major) {
        return Ok(j.clone());
    }
    if !auto_install {
        return Err(AppError::NotFound(format!("Java {major} (Ayarlar → Java'dan kurabilirsiniz)")));
    }
    install(http, paths, major, progress).await
}

/// UI'daki "Java" sekmesi için major → kurulumlar.
pub fn group_by_major(installs: Vec<JavaInstall>) -> BTreeMap<u32, Vec<JavaInstall>> {
    let mut map: BTreeMap<u32, Vec<JavaInstall>> = BTreeMap::new();
    for j in installs {
        map.entry(j.major).or_default().push(j);
    }
    map
}

#[cfg(test)]
mod tests {
    #[test]
    fn majors() {
        assert_eq!(super::parse_major("1.8.0_402"), Some(8));
        assert_eq!(super::parse_major("17.0.10"), Some(17));
        assert_eq!(super::parse_major("21"), Some(21));
        assert_eq!(super::parse_major("21-ea"), Some(21));
    }
}
