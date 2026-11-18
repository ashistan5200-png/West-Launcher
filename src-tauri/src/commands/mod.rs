//! Tauri IPC katmanı — iş mantığı core/instance/java modüllerinde kalır.

pub mod accounts;
pub mod cloud;
pub mod ashi;
pub mod assistant;
pub mod content;
pub mod files;
pub mod importer;
pub mod instance;
pub mod java;
pub mod launch;
pub mod news;
pub mod screenshots;
pub mod settings;
pub mod skins;
pub mod updater;
pub mod versions;
pub mod wallet;
pub mod depot;
pub mod window;

use crate::core::{Progress, ProgressFn};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

pub const EV_PROGRESS: &str = "progress";
pub const EV_GAME_LOG: &str = "game-log";
pub const EV_GAME_EXIT: &str = "game-exit";

/// Motorun ilerleme geri çağrısını frontend olayına bağlar (≈30 olay/sn sınırı).
pub fn progress_emitter(app: &AppHandle) -> ProgressFn {
    let app = app.clone();
    let last = Arc::new(parking_lot::Mutex::new(std::time::Instant::now()));
    Arc::new(move |p: Progress| {
        let important = p.current == 0 || p.current >= p.total || p.stage == "done";
        let mut l = last.lock();
        if important || l.elapsed().as_millis() >= 33 {
            *l = std::time::Instant::now();
            let _ = app.emit(EV_PROGRESS, p);
        }
    })
}
