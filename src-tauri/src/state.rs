use crate::core::http::Http;
use crate::paths::Paths;
use crate::settings::Settings;
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::collections::HashMap;
use std::time::Instant;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot};

/// Bir oyun sürecinden gelen ham sinyaller — Ashi testleri bunları izler.
#[derive(Debug, Clone)]
pub enum GameSignal {
    Log(String),
    Exit(Option<i32>),
}

pub struct Hunt {
    pub cancel: Arc<AtomicBool>,
}

pub struct RunningGame {
    pub pid: u32,
    pub started: Instant,
    pub kill: Option<oneshot::Sender<()>>,
    /// Çökme analizörü için son N satır
    pub log_tail: std::collections::VecDeque<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningInfo {
    pub instance_id: String,
    pub pid: u32,
    pub uptime_secs: u64,
}

pub struct AppState {
    pub paths: Paths,
    pub http: Http,
    pub settings: RwLock<Settings>,
    pub running: Mutex<HashMap<String, RunningGame>>,
    /// instance id → sinyal dinleyicisi (yalnızca Ashi testleri sırasında)
    pub watchers: Mutex<HashMap<String, mpsc::UnboundedSender<GameSignal>>>,
    /// instance id → süren Suçlu Avı
    pub hunts: Mutex<HashMap<String, Hunt>>,
    /// Süren Microsoft cihaz kodu girişi (iptal bayrağı)
    pub ms_login: Mutex<Option<Arc<AtomicBool>>>,
    pub discord: crate::discord::Discord,
    pub update: Mutex<crate::commands::updater::UpdateState>,
    /// Launcher açılırken gelen westclient://katil/KOD bağlantısı (arayüz hazır olunca alınır)
    pub pending_invite: Mutex<Option<String>>,
}

impl AppState {
    pub fn new(paths: Paths) -> Self {
        let settings = Settings::load(&paths.settings_file());
        crate::i18n::set_lang(&settings.language);
        let discord = crate::discord::Discord::start(settings.discord_client_id.clone(), settings.discord_rpc);
        Self {
            paths,
            http: Http::new(),
            settings: RwLock::new(settings),
            running: Mutex::new(HashMap::new()),
            watchers: Mutex::new(HashMap::new()),
            hunts: Mutex::new(HashMap::new()),
            ms_login: Mutex::new(None),
            discord,
            update: Mutex::new(Default::default()),
            pending_invite: Mutex::new(None),
        }
    }

    pub fn running_info(&self) -> Vec<RunningInfo> {
        self.running
            .lock()
            .iter()
            .map(|(id, g)| RunningInfo { instance_id: id.clone(), pid: g.pid, uptime_secs: g.started.elapsed().as_secs() })
            .collect()
    }
}

pub const LOG_TAIL: usize = 2000;
