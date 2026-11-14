use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::updater::{self, UpdateInfo};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EV_UPDATE: &str = "update-status";

#[derive(Debug, Clone, Default)]
pub struct UpdateState {
    pub info: Option<UpdateInfo>,
    pub file: Option<PathBuf>,
    pub downloading: bool,
    pub progress: (u64, u64),
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current: String,
    pub info: Option<UpdateInfo>,
    pub downloaded: bool,
    pub downloading: bool,
    pub received: u64,
    pub total: u64,
    pub error: Option<String>,
}

fn status(st: &AppState) -> UpdateStatus {
    let u = st.update.lock();
    UpdateStatus {
        current: updater::CURRENT.into(),
        info: u.info.clone(),
        downloaded: u.file.is_some(),
        downloading: u.downloading,
        received: u.progress.0,
        total: u.progress.1,
        error: u.error.clone(),
    }
}

fn emit(app: &AppHandle) {
    let _ = app.emit(EV_UPDATE, status(&app.state::<AppState>()));
}

/// Kontrol et; yeni sürüm varsa (ayar açıksa) arka planda indir.
pub async fn check_and_fetch(app: &AppHandle, download: bool) -> Result<UpdateStatus> {
    let st = app.state::<AppState>();
    let found = updater::check(&st.http).await;
    {
        let mut u = st.update.lock();
        match &found {
            Ok(Some(info)) => {
                if u.info.as_ref().map(|i| i.version != info.version).unwrap_or(true) {
                    u.file = None;
                }
                u.info = Some(info.clone());
                u.error = None;
            }
            Ok(None) => *u = UpdateState::default(),
            Err(e) => u.error = Some(e.to_string()),
        }
    }
    emit(app);
    found?;
    if download {
        let need = { let u = st.update.lock(); u.info.is_some() && u.file.is_none() && !u.downloading };
        if need {
            fetch(app).await?;
        }
    }
    Ok(status(&st))
}

async fn fetch(app: &AppHandle) -> Result<PathBuf> {
    let st = app.state::<AppState>();
    let info = {
        let mut u = st.update.lock();
        if let Some(f) = &u.file {
            return Ok(f.clone());
        }
        u.downloading = true;
        u.error = None;
        u.info.clone().ok_or_else(|| AppError::msg("İndirilecek güncelleme yok"))?
    };
    emit(app);
    let dir = st.paths.cache().join("updates");
    let progress_app = app.clone();
    let last = std::sync::Mutex::new(std::time::Instant::now());
    let res = updater::download(&st.http, &dir, &info, move |done, total| {
        let st = progress_app.state::<AppState>();
        st.update.lock().progress = (done, total);
        let mut l = last.lock().unwrap();
        if l.elapsed() >= Duration::from_millis(150) || done >= total {
            *l = std::time::Instant::now();
            emit(&progress_app);
        }
    })
    .await;
    {
        let mut u = st.update.lock();
        u.downloading = false;
        match &res {
            Ok(f) => u.file = Some(f.clone()),
            Err(e) => u.error = Some(format!("Güncelleme indirilemedi: {e}")),
        }
    }
    emit(app);
    res
}

/// Açılıştan kısa süre sonra ve 6 saatte bir kontrol eder.
pub fn spawn_background(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        loop {
            let auto = app.state::<AppState>().settings.read().auto_update;
            if let Err(e) = check_and_fetch(&app, auto).await {
                tracing::info!("güncelleme kontrolü: {e}");
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

#[tauri::command]
pub fn update_status(state: State<'_, AppState>) -> UpdateStatus {
    status(&state)
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateStatus> {
    let auto = app.state::<AppState>().settings.read().auto_update;
    check_and_fetch(&app, auto).await
}

/// İndirir (gerekirse), kurulumu başlatır ve uygulamayı kapatır.
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<()> {
    if !app.state::<AppState>().running.lock().is_empty() {
        return Err(AppError::msg("Önce açık oyunu kapat; güncelleme sırasında launcher yeniden başlar"));
    }
    let file = fetch(&app).await?;
    updater::install(&file)?;
    let exit_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        exit_app.exit(0);
    });
    Ok(())
}
