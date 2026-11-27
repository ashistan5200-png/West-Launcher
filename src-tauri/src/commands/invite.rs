//! "Birlikte oyna" davetleri: westclient://katil/KOD bağlantıları ve kurulum
use crate::error::Result;
use crate::instance::Instance;
use crate::invite::{self, InviteInfo};
use crate::state::AppState;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

/// Arayüze giden olay: davet kodu
pub const EV_INVITE: &str = "west-invite";

fn handle(app: &AppHandle, url: &str) {
    let Some(code) = invite::code_from_url(url) else { return };
    // Arayüz henüz yüklenmemiş olabilir: kodu sakla, olayı da gönder
    *app.state::<AppState>().pending_invite.lock() = Some(code.clone());
    let _ = app.emit(EV_INVITE, code);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// westclient:// bağlantılarını dinle (açılışta gelen dahil)
pub fn bind_deep_links(app: &AppHandle) {
    // Kurulum kaydı olmayan durumlarda (geliştirme, AppImage) protokolü kendimiz kaydederiz
    #[cfg(any(windows, target_os = "linux"))]
    {
        let _ = app.deep_link().register_all();
    }
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for u in urls {
            handle(app, u.as_str());
        }
    }
    let h = app.clone();
    app.deep_link().on_open_url(move |event| {
        for u in event.urls() {
            handle(&h, u.as_str());
        }
    });
}

#[tauri::command]
pub fn take_pending_invite(state: State<'_, AppState>) -> Option<String> {
    state.pending_invite.lock().take()
}

#[tauri::command]
pub async fn invite_info(state: State<'_, AppState>, code: String) -> Result<InviteInfo> {
    invite::info(&state, &code).await
}

#[tauri::command]
pub async fn invite_install(state: State<'_, AppState>, code: String) -> Result<Instance> {
    state.pending_invite.lock().take();
    invite::install(&state, &code).await
}
