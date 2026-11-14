use crate::error::{AppError, Result};
use crate::util::sha1_file;
use futures::{stream, StreamExt};
use serde::de::DeserializeOwned;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub url: String,
    pub path: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Clone)]
pub struct Http {
    pub client: reqwest::Client,
}

impl Http {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("WestLauncher/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(32)
            .build()
            .expect("http client");
        Self { client }
    }

    pub async fn json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        Ok(self.client.get(url).send().await?.error_for_status()?.json().await?)
    }

    /// JSON'u indirir ve diske önbelleğe alır; ağ yoksa önbellekten okur.
    pub async fn json_cached<T: DeserializeOwned>(&self, url: &str, cache: &Path, sha1: Option<&str>) -> Result<T> {
        if let Some(h) = sha1 {
            if cache.exists() && sha1_file(cache).ok().as_deref() == Some(h) {
                return Ok(serde_json::from_slice(&tokio::fs::read(cache).await?)?);
            }
        }
        match self.client.get(url).send().await.and_then(|r| r.error_for_status()) {
            Ok(resp) => {
                let bytes = resp.bytes().await?;
                if let Some(p) = cache.parent() {
                    tokio::fs::create_dir_all(p).await?;
                }
                tokio::fs::write(cache, &bytes).await?;
                Ok(serde_json::from_slice(&bytes)?)
            }
            Err(e) if cache.exists() => {
                tracing::warn!("çevrimdışı önbellek kullanılıyor: {url} ({e})");
                Ok(serde_json::from_slice(&tokio::fs::read(cache).await?)?)
            }
            Err(e) => Err(e.into()),
        }
    }

    /// Dosya zaten geçerliyse atlar. Hızlı yol: boyut eşleşirse hash
    /// hesaplanmaz (binlerce asset için kritik); indirmeden sonra SHA1 doğrulanır.
    pub fn is_valid(task: &DownloadTask, deep: bool) -> bool {
        let Ok(meta) = std::fs::metadata(&task.path) else { return false };
        if let Some(size) = task.size {
            if meta.len() != size {
                return false;
            }
            if !deep {
                return true;
            }
        }
        match &task.sha1 {
            Some(h) => sha1_file(&task.path).map(|a| a.eq_ignore_ascii_case(h)).unwrap_or(false),
            None => meta.len() > 0,
        }
    }

    pub async fn download(&self, task: &DownloadTask) -> Result<()> {
        let mut last_err = None;
        for attempt in 0..3u32 {
            match self.download_once(task).await {
                Ok(()) => return Ok(()),
                Err(e) => {
                    tracing::warn!("indirme denemesi {} başarısız {}: {e}", attempt + 1, task.url);
                    last_err = Some(e);
                    tokio::time::sleep(Duration::from_millis(400 * 2u64.pow(attempt))).await;
                }
            }
        }
        Err(last_err.unwrap())
    }

    async fn download_once(&self, task: &DownloadTask) -> Result<()> {
        if let Some(p) = task.path.parent() {
            tokio::fs::create_dir_all(p).await?;
        }
        let part = task.path.with_extension("part");
        let resp = self.client.get(&task.url).send().await?.error_for_status()?;
        let mut file = tokio::fs::File::create(&part).await?;
        let mut body = resp.bytes_stream();
        let mut hasher = <sha1::Sha1 as sha1::Digest>::new();
        while let Some(chunk) = body.next().await {
            let chunk = chunk?;
            sha1::Digest::update(&mut hasher, &chunk);
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        drop(file);
        if let Some(expected) = &task.sha1 {
            let actual = hex::encode(sha1::Digest::finalize(hasher));
            if !actual.eq_ignore_ascii_case(expected) {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(AppError::Hash {
                    path: task.path.display().to_string(),
                    expected: expected.clone(),
                    actual,
                });
            }
        }
        tokio::fs::rename(&part, &task.path).await?;
        Ok(())
    }

    /// Paralel toplu indirme. `on_progress(done, total)` her dosyada çağrılır.
    pub async fn download_all<F>(&self, tasks: Vec<DownloadTask>, concurrency: usize, on_progress: F) -> Result<()>
    where
        F: Fn(u64, u64) + Send + Sync + 'static,
    {
        let total = tasks.len() as u64;
        let done = Arc::new(AtomicU64::new(0));
        let on_progress = Arc::new(on_progress);
        on_progress(0, total);

        let results: Vec<Result<()>> = stream::iter(tasks)
            .map(|task| {
                let this = self.clone();
                let done = done.clone();
                let on_progress = on_progress.clone();
                async move {
                    let valid = {
                        let t = task.clone();
                        tokio::task::spawn_blocking(move || Http::is_valid(&t, false))
                            .await
                            .unwrap_or(false)
                    };
                    if !valid {
                        this.download(&task).await?;
                    }
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    on_progress(n, total);
                    Ok(())
                }
            })
            .buffer_unordered(concurrency.max(1))
            .collect()
            .await;

        let errors: Vec<_> = results.into_iter().filter_map(|r| r.err()).collect();
        if let Some(first) = errors.into_iter().next() {
            return Err(first);
        }
        Ok(())
    }
}

impl Default for Http {
    fn default() -> Self {
        Self::new()
    }
}
