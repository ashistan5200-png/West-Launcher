//! Tek tıkla yerel yapay zeka: Ollama'yı ve Ashi'nin modelini **aynı anda** kurar.
//! Kullanıcı ayrı ayrı bir şey indirmez, terminal açmaz, anahtar girmez.
//!
//! Aşamalar: indir → kur → başlat → modeli indir → hazır.
//!   - Windows: resmî OllamaSetup.exe sessiz modda (yönetici izni istemez, kullanıcıya kurulur)
//!   - macOS:   Ollama.app → /Applications (yazılamazsa ~/Applications)
//!   - Linux:   resmî paket launcher'ın veri klasörüne açılır (sudo gerekmez)

use super::ollama::{self, PullProgress};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use futures::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    /// "download" | "install" | "start" | "model" | "done" | "error"
    pub stage: &'static str,
    pub label: String,
    pub completed: u64,
    pub total: u64,
    pub error: Option<String>,
}

impl SetupProgress {
    fn new(stage: &'static str, label: impl Into<String>) -> Self {
        Self { stage, label: label.into(), completed: 0, total: 0, error: None }
    }
}

/// RAM'e göre önerilen model: 12 GB altı hafif model, üstü daha akıllı model.
pub fn recommended_model() -> &'static str {
    if crate::java::jvm::hardware().total_memory_mb < 12 * 1024 {
        "qwen2.5:3b"
    } else {
        ollama::DEFAULT_MODEL
    }
}

/// Model indirme boyutu (yaklaşık, arayüzde göstermek için).
pub fn model_size_gb(model: &str) -> f32 {
    match model {
        "qwen2.5:3b" => 1.9,
        "llama3.1:8b" => 4.9,
        _ => 4.7,
    }
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Launcher'ın kendi kurduğu Linux kopyası
fn local_dir(root: &Path) -> PathBuf {
    root.join("ollama")
}

/// Bilgisayarda kurulu Ollama'yı bulur (bizim kurduğumuz veya kullanıcının kendi kurduğu).
pub fn find_binary(root: &Path) -> Option<PathBuf> {
    let mut c: Vec<PathBuf> = vec![local_dir(root).join("bin").join(exe("ollama"))];
    if cfg!(windows) {
        if let Some(d) = dirs::data_local_dir() {
            c.push(d.join("Programs").join("Ollama").join("ollama.exe"));
        }
    }
    if cfg!(target_os = "macos") {
        c.push(PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"));
        if let Some(h) = dirs::home_dir() {
            c.push(h.join("Applications/Ollama.app/Contents/Resources/ollama"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        c.extend(std::env::split_paths(&path).map(|p| p.join(exe("ollama"))));
    }
    c.into_iter().find(|p| p.is_file())
}

/// `ollama serve`'ü arka planda, pencere açmadan başlatır.
fn spawn_server(bin: &Path) -> Result<()> {
    let mut cmd = std::process::Command::new(bin);
    cmd.arg("serve").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| AppError::msg(format!("Ollama başlatılamadı: {e}")))?;
    Ok(())
}

async fn wait_ready(http: &Http, url: &str, secs: u64) -> bool {
    for _ in 0..secs * 2 {
        if ollama::status(http, url, "").await.running {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
    false
}

/// Ollama kuruluysa ama kapalıysa sessizce başlatır. Çalışıyorsa `true`.
pub async fn ensure_running(http: &Http, url: &str, root: &Path) -> bool {
    if ollama::status(http, url, "").await.running {
        return true;
    }
    let Some(bin) = find_binary(root) else { return false };
    spawn_server(&bin).is_ok() && wait_ready(http, url, 12).await
}

async fn download(http: &Http, url: &str, dest: &Path, on: &impl Fn(SetupProgress)) -> Result<()> {
    if let Some(p) = dest.parent() {
        tokio::fs::create_dir_all(p).await?;
    }
    let resp = http
        .client
        .get(url)
        .timeout(Duration::from_secs(3 * 3600))
        .send()
        .await
        .map_err(|_| AppError::msg("Ollama indirilemedi; internet bağlantını kontrol et"))?
        .error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp).await?;
    let mut done = 0u64;
    let mut last = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppError::msg("İndirme yarıda kesildi; tekrar dene"))?;
        file.write_all(&chunk).await?;
        done += chunk.len() as u64;
        if done - last > 2 * 1024 * 1024 || done == total {
            last = done;
            on(SetupProgress { completed: done, total, ..SetupProgress::new("download", "Ollama indiriliyor") });
        }
    }
    file.flush().await?;
    drop(file);
    tokio::fs::rename(&tmp, dest).await?;
    Ok(())
}

/// Platforma göre Ollama'yı kurar ve çalıştırılabilir dosyanın yolunu döndürür.
async fn install(http: &Http, root: &Path, on: &impl Fn(SetupProgress)) -> Result<PathBuf> {
    let cache = root.join("cache");

    #[cfg(windows)]
    {
        let setup = cache.join("OllamaSetup.exe");
        download(http, "https://ollama.com/download/OllamaSetup.exe", &setup, on).await?;
        on(SetupProgress::new("install", "Ollama kuruluyor"));
        let s = setup.clone();
        let ok = tokio::task::spawn_blocking(move || {
            use std::os::windows::process::CommandExt;
            std::process::Command::new(&s)
                .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/SP-"])
                .creation_flags(0x0800_0000)
                .status()
                .map(|st| st.success())
                .unwrap_or(false)
        })
        .await
        .unwrap_or(false);
        let _ = std::fs::remove_file(&setup);
        if !ok {
            return Err(AppError::msg("Ollama kurulumu tamamlanamadı. Antivirüs engellemiş olabilir; tekrar dene."));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let zip = cache.join("Ollama-darwin.zip");
        download(http, "https://ollama.com/download/Ollama-darwin.zip", &zip, on).await?;
        on(SetupProgress::new("install", "Ollama kuruluyor"));
        let home_apps = dirs::home_dir().unwrap_or_default().join("Applications");
        let mut placed = false;
        for dir in [PathBuf::from("/Applications"), home_apps] {
            let _ = std::fs::create_dir_all(&dir);
            // ditto, uygulama paketindeki izinleri ve sembolik bağları korur
            let ok = tokio::process::Command::new("ditto")
                .args(["-x", "-k"])
                .arg(&zip)
                .arg(&dir)
                .status()
                .await
                .map(|s| s.success())
                .unwrap_or(false);
            if ok && dir.join("Ollama.app").exists() {
                placed = true;
                break;
            }
        }
        let _ = std::fs::remove_file(&zip);
        if !placed {
            return Err(AppError::msg("Ollama uygulama klasörüne kopyalanamadı"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" };
        let pkg = cache.join(format!("ollama-linux-{arch}.tar.zst"));
        download(http, &format!("https://ollama.com/download/ollama-linux-{arch}.tar.zst"), &pkg, on).await?;
        on(SetupProgress::new("install", "Ollama kuruluyor"));
        let dest = local_dir(root);
        let p = pkg.clone();
        let d = dest.clone();
        tokio::task::spawn_blocking(move || unpack_tar_zst(&p, &d))
        .await
        .map_err(|e| AppError::msg(e.to_string()))??;
        let _ = std::fs::remove_file(&pkg);
    }

    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = (http, cache, on);
        return Err(AppError::msg("Bu işletim sistemi için otomatik kurulum yok"));
    }

    find_binary(root).ok_or_else(|| AppError::msg("Ollama kuruldu ama bulunamadı; launcher'ı yeniden başlatıp tekrar dene"))
}

/// `.tar.zst` paketini `dest` klasörüne açar (önce klasörü temizler).
#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
fn unpack_tar_zst(src: &Path, dest: &Path) -> Result<()> {
    let _ = std::fs::remove_dir_all(dest);
    std::fs::create_dir_all(dest)?;
    let file = std::io::BufReader::new(std::fs::File::open(src)?);
    let dec = ruzstd::decoding::StreamingDecoder::new(file).map_err(|e| AppError::msg(format!("Paket açılamadı: {e}")))?;
    let mut ar = tar::Archive::new(dec);
    ar.set_preserve_permissions(true);
    ar.unpack(dest).map_err(|e| AppError::msg(format!("Paket açılamadı: {e}")))?;
    Ok(())
}

/// Tam kurulum: gerekiyorsa Ollama'yı indirip kurar, başlatır ve modeli indirir.
/// Zaten kurulu olan adımlar atlanır, bu yüzden yarıda kalan kurulum tekrar başlatılabilir.
pub async fn run(http: &Http, root: &Path, url: &str, model: &str, on: impl Fn(SetupProgress)) -> Result<()> {
    if !ollama::status(http, url, "").await.running {
        let bin = match find_binary(root) {
            Some(b) => b,
            None => install(http, root, &on).await?,
        };
        on(SetupProgress::new("start", "Ollama başlatılıyor"));
        // Windows kurulumu Ollama'yı kendisi başlatabilir; kısa bir süre bekle
        if !wait_ready(http, url, 4).await {
            spawn_server(&bin)?;
            if !wait_ready(http, url, 40).await {
                return Err(AppError::msg("Ollama başlatıldı ama yanıt vermiyor. Bilgisayarı yeniden başlatıp tekrar dene."));
            }
        }
    }

    if !ollama::status(http, url, model).await.model_installed {
        on(SetupProgress::new("model", "Ashi'nin beyni indiriliyor"));
        ollama::pull(http, url, model, |p: PullProgress| {
            on(SetupProgress { completed: p.completed, total: p.total, ..SetupProgress::new("model", "Ashi'nin beyni indiriliyor") });
        })
        .await?;
    }
    on(SetupProgress::new("done", "Hazır"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpacks_ollama_style_tar_zst() {
        let tmp = std::env::temp_dir().join(format!("west-ollama-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        // bin/ollama + lib/ollama/x.so düzeninde küçük bir paket
        let mut b = tar::Builder::new(Vec::new());
        for (path, body) in [("bin/ollama", b"#!/bin/sh\necho ok\n".as_slice()), ("lib/ollama/libx.so", b"lib".as_slice())] {
            let mut h = tar::Header::new_gnu();
            h.set_size(body.len() as u64);
            h.set_mode(0o755);
            h.set_cksum();
            b.append_data(&mut h, path, body).unwrap();
        }
        let raw = b.into_inner().unwrap();
        let packed = ruzstd::encoding::compress_to_vec(raw.as_slice(), ruzstd::encoding::CompressionLevel::Fastest);
        let src = tmp.join("p.tar.zst");
        std::fs::write(&src, packed).unwrap();
        let dest = tmp.join("ollama");
        unpack_tar_zst(&src, &dest).unwrap();
        assert_eq!(std::fs::read(dest.join("lib/ollama/libx.so")).unwrap(), b"lib");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert!(std::fs::metadata(dest.join("bin/ollama")).unwrap().permissions().mode() & 0o111 != 0);
        }
        // Launcher'ın kendi kopyası bulunabilmeli
        assert_eq!(find_binary(&tmp), Some(dest.join("bin").join(exe("ollama"))));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn model_sizes_are_known() {
        assert!(model_size_gb("qwen2.5:3b") < model_size_gb("qwen2.5:7b"));
        assert!(["qwen2.5:3b", "qwen2.5:7b"].contains(&recommended_model()));
    }
}
