//! West Overlay: oyun açıkken bir kısayolla, oyunun üstünde açılan şeffaf West Client paneli.
//!
//! Minecraft'ın içine çizilmez; ayrı, her zaman üstte duran bir penceredir. Bu yüzden her
//! Minecraft sürümünde ve her yükleyicide aynı şekilde çalışır ve oyunu bozamaz.
//! Kısayol yalnızca bir oyun açıkken kayıtlıdır; başka zamanlarda tuşu meşgul etmez.

use crate::error::{AppError, Result};
use crate::state::AppState;
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::OnceLock;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const LABEL: &str = "overlay";
pub const EV_OPEN: &str = "overlay-open";

/// Şu an kayıtlı kısayol (değişince eskisi kaldırılır)
static ACTIVE: Mutex<Option<String>> = Mutex::new(None);

/// Global kısayol eklentisi: basılınca overlay'i aç/kapat.
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = toggle(app);
            }
        })
        .build()
}

fn window(app: &AppHandle) -> Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#/overlay".into()))
        .title("West Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| AppError::msg(format!("Overlay açılamadı: {e}")))
}

/// Overlay'i oyunun bulunduğu ekranı (yoksa ana ekranı) kaplayacak şekilde yerleştirir.
fn cover_monitor(app: &AppHandle, w: &WebviewWindow) {
    let monitor = app
        .get_webview_window("main")
        .and_then(|m| m.current_monitor().ok().flatten())
        .or_else(|| w.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let _ = w.set_position(*m.position());
        let _ = w.set_size(*m.size());
    }
}

pub fn toggle(app: &AppHandle) -> Result<()> {
    let w = window(app)?;
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        cover_monitor(app, &w);
        let _ = w.set_always_on_top(true);
        let _ = w.show();
        let _ = w.set_focus();
        let _ = app.emit_to(LABEL, EV_OPEN, ());
    }
    Ok(())
}

pub fn hide(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Oyun başladığında: kısayolu kaydet ve pencereyi önceden hazırla (ilk açılış anında olsun).
pub fn on_game_started(app: &AppHandle) {
    let (enabled, key) = {
        let s = app.state::<AppState>();
        let s = s.settings.read();
        (s.overlay_enabled, s.overlay_hotkey.clone())
    };
    if !enabled {
        return;
    }
    register(app, &key);
    let _ = window(app);
}

/// Son oyun kapandığında: kısayolu bırak, overlay'i gizle.
pub fn on_games_stopped(app: &AppHandle) {
    unregister(app);
    hide(app);
}

fn register(app: &AppHandle, key: &str) {
    let mut active = ACTIVE.lock();
    if active.as_deref() == Some(key) {
        return;
    }
    if let Some(old) = active.take() {
        if let Ok(s) = old.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(s);
        }
    }
    match key.parse::<Shortcut>() {
        Ok(s) => match app.global_shortcut().register(s) {
            Ok(()) => *active = Some(key.to_string()),
            Err(e) => tracing::warn!("Overlay kısayolu kaydedilemedi ({key}): {e}"),
        },
        Err(e) => tracing::warn!("Geçersiz overlay kısayolu ({key}): {e}"),
    }
}

fn unregister(app: &AppHandle) {
    if let Some(old) = ACTIVE.lock().take() {
        if let Ok(s) = old.parse::<Shortcut>() {
            let _ = app.global_shortcut().unregister(s);
        }
    }
}

/// Ayarlar değişince (kısayol ya da açma/kapama) oyun açıksa hemen uygula.
pub fn settings_changed(app: &AppHandle) {
    let st = app.state::<AppState>();
    let running = !st.running.lock().is_empty();
    let (enabled, key) = {
        let s = st.settings.read();
        (s.overlay_enabled, s.overlay_hotkey.clone())
    };
    if running && enabled {
        register(app, &key);
    } else {
        unregister(app);
        if !enabled {
            hide(app);
        }
    }
}

// ───────── Komutlar ─────────

#[tauri::command]
pub fn overlay_toggle(app: AppHandle) -> Result<()> {
    toggle(&app)
}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) {
    hide(&app);
}

/// Kısayolun geçerli olup olmadığını kontrol eder (Ayarlar'daki seçim için).
#[tauri::command]
pub fn overlay_check_hotkey(key: String) -> bool {
    key.parse::<Shortcut>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offered_hotkeys_parse() {
        for k in ["F6", "F7", "F8", "F9", "F10", "F12", "Alt+W", "Ctrl+Tab"] {
            assert!(k.parse::<Shortcut>().is_ok(), "{k} tanınmadı");
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStats {
    /// Oyunun işlemci kullanımı, tüm çekirdeklere göre yüzde (0–100)
    pub cpu: f32,
    /// Oyunun kullandığı bellek (MB)
    pub memory_mb: u64,
    pub system_used_mb: u64,
    pub system_total_mb: u64,
    pub uptime_secs: u64,
}

static SYS: OnceLock<Mutex<System>> = OnceLock::new();

/// Çalışan oyunun canlı işlemci/bellek kullanımı. İşlemci yüzdesi iki ölçüm arasındaki
/// farktan hesaplanır; bu yüzden ilk çağrı 0 dönebilir.
#[tauri::command]
pub fn game_stats(state: tauri::State<'_, AppState>, instance_id: String) -> Result<GameStats> {
    let (pid, uptime) = {
        let r = state.running.lock();
        let g = r.get(&instance_id).ok_or_else(|| AppError::msg("Oyun açık değil"))?;
        (g.pid, g.started.elapsed().as_secs())
    };
    let mut sys = SYS.get_or_init(|| Mutex::new(System::new())).lock();
    let p = Pid::from_u32(pid);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[p]), true, ProcessRefreshKind::new().with_cpu().with_memory());
    sys.refresh_memory();
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
    let (cpu, mem) = sys.process(p).map(|pr| (pr.cpu_usage() / cores, pr.memory() / 1024 / 1024)).unwrap_or((0.0, 0));
    Ok(GameStats {
        cpu: cpu.clamp(0.0, 100.0),
        memory_mb: mem,
        system_used_mb: sys.used_memory() / 1024 / 1024,
        system_total_mb: sys.total_memory() / 1024 / 1024,
        uptime_secs: uptime,
    })
}
