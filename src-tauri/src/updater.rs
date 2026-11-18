//! Uygulama güncelleyicisi. GitHub Releases'teki son sürümü kontrol eder,
//! platforma uygun kurulum dosyasını indirir, GitHub'ın verdiği SHA-256
//! özetiyle doğrular ve kurar.

use crate::core::http::Http;
use crate::error::{AppError, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

pub const REPO: &str = "ashistan5200-png/West-Launcher";
pub const CURRENT: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    /// "sha256:<hex>" — GitHub her yüklenen dosya için hesaplar
    #[serde(default)]
    digest: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    assets: Vec<GhAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub title: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub page_url: String,
    pub asset_name: String,
    pub download_url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

/// "v0.1.10" → (0,1,10). Sayısal olmayan ekler yok sayılır.
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let core = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next()?;
    let mut it = core.split('.').map(|p| p.parse::<u64>().ok());
    Some((it.next()??, it.next().flatten().unwrap_or(0), it.next().flatten().unwrap_or(0)))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (parse_version(candidate), parse_version(current)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

/// Bu kurulum için doğru dosya adı (iş akışı sabit adlarla yükler).
pub fn asset_for_platform() -> &'static str {
    if cfg!(windows) {
        "West-Launcher-Setup.exe"
    } else if cfg!(target_os = "macos") {
        "West-Launcher-macOS.dmg"
    } else if std::env::var_os("APPIMAGE").is_some() {
        "West-Launcher-Linux.AppImage"
    } else {
        "West-Launcher-Linux.deb"
    }
}

/// Daha yeni bir sürüm varsa bilgisini döndürür.
pub async fn check(http: &Http) -> Result<Option<UpdateInfo>> {
    check_against(http, CURRENT).await
}

/// `current` sürümüne göre kontrol (testlerde eski bir sürümü taklit etmek için).
pub async fn check_against(http: &Http, current: &str) -> Result<Option<UpdateInfo>> {
    let resp = http
        .client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None); // henüz sürüm yok
    }
    if resp.status() == reqwest::StatusCode::FORBIDDEN || resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::msg(crate::i18n::t("GitHub şu an çok fazla istek alıyor; güncelleme kontrolü daha sonra tekrar denenecek")));
    }
    let rel: GhRelease = resp.error_for_status()?.json().await?;
    if rel.draft || rel.prerelease || !is_newer(&rel.tag_name, current) {
        return Ok(None);
    }
    let want = asset_for_platform();
    let Some(asset) = rel.assets.into_iter().find(|a| a.name == want) else {
        return Ok(None); // bu platformun dosyası henüz yüklenmemiş (derleme sürüyor olabilir)
    };
    Ok(Some(UpdateInfo {
        current: current.into(),
        version: rel.tag_name.trim_start_matches('v').to_string(),
        title: rel.name.unwrap_or_else(|| format!("West Client {}", rel.tag_name)),
        notes: rel.body.unwrap_or_default(),
        published_at: rel.published_at,
        page_url: rel.html_url,
        asset_name: asset.name,
        download_url: asset.browser_download_url,
        size: asset.size,
        sha256: asset.digest.and_then(|d| d.strip_prefix("sha256:").map(str::to_lowercase)),
    }))
}

/// Kurulum dosyasını indirir ve doğrular. Aynı sürüm zaten indirilmişse tekrar indirmez.
pub async fn download(http: &Http, dir: &Path, info: &UpdateInfo, on_progress: impl Fn(u64, u64)) -> Result<PathBuf> {
    tokio::fs::create_dir_all(dir).await?;
    let target = dir.join(format!("{}-{}", info.version, info.asset_name));
    if let Some(expected) = &info.sha256 {
        if target.exists() && sha256_file(&target).await? == *expected {
            on_progress(info.size, info.size);
            return Ok(target);
        }
    }
    let part = target.with_extension("part");
    let resp = http.client.get(&info.download_url).send().await?.error_for_status()?;
    let total = resp.content_length().unwrap_or(info.size);
    let mut file = tokio::fs::File::create(&part).await?;
    let mut hasher = Sha256::new();
    let mut done = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        on_progress(done, total);
    }
    file.flush().await?;
    drop(file);
    if let Some(expected) = &info.sha256 {
        let actual = hex::encode(hasher.finalize());
        if actual != *expected {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(AppError::Hash { path: info.asset_name.clone(), expected: expected.clone(), actual });
        }
    }
    tokio::fs::rename(&part, &target).await?;
    Ok(target)
}

async fn sha256_file(p: &Path) -> Result<String> {
    let bytes = tokio::fs::read(p).await?;
    Ok(hex::encode(Sha256::digest(&bytes)))
}

/// İndirilen güncellemeyi başlatır. Çağıran taraf ardından uygulamayı kapatmalıdır
/// (Windows'ta kurulum çalışan dosyanın üzerine yazabilsin diye).
pub fn install(file: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        // Tauri NSIS kurulumu: /P = soru sormadan ilerleme çubuğuyla kur, /R = bitince uygulamayı aç
        std::process::Command::new(file).args(["/P", "/R"]).spawn()?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(file).spawn()?;
        return Ok(());
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        if let Some(current) = std::env::var_os("APPIMAGE") {
            // AppImage: çalışan dosyayı yenisiyle değiştir ve yeni sürümü başlat
            use std::os::unix::fs::PermissionsExt;
            let current = PathBuf::from(current);
            let staged = current.with_extension("new");
            std::fs::copy(file, &staged)?;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
            std::fs::rename(&staged, &current)?;
            std::process::Command::new(&current).spawn()?;
        } else {
            // .deb: sistemin paket yükleyicisiyle aç
            std::process::Command::new("xdg-open").arg(file).spawn()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn version_compare() {
        assert!(is_newer("v0.1.2", "0.1.1"));
        assert!(is_newer("v0.2.0", "0.1.9"));
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(is_newer("v0.1.10", "0.1.9"));
        assert!(!is_newer("v0.1.1", "0.1.1"));
        assert!(!is_newer("v0.1.0", "0.1.1"));
        assert!(!is_newer("nightly", "0.1.1"));
        assert_eq!(parse_version("v1.2.3-beta"), Some((1, 2, 3)));
    }
}
