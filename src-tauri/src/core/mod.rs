//! Launcher motoru: Mojang meta, indirme, kurulum ve başlatma.
//! Bu modül Tauri'ye bağımlı değildir; ilerleme `ProgressFn` ile raporlanır.

pub mod auth;
pub mod http;
pub mod install;
pub mod launch;
pub mod manifest;
pub mod rules;

use serde::Serialize;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// Görev kimliği (genelde instance id)
    pub task: String,
    /// "manifest" | "libraries" | "assets" | "natives" | "java" | "loader" | "done"
    pub stage: String,
    pub current: u64,
    pub total: u64,
    pub message: Option<String>,
}

pub type ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>;

pub fn noop_progress() -> ProgressFn {
    Arc::new(|_| {})
}

pub fn report(p: &ProgressFn, task: &str, stage: &str, current: u64, total: u64) {
    p(Progress { task: task.into(), stage: stage.into(), current, total, message: None });
}
