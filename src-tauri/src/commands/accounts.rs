use crate::accounts::{microsoft, offline_account, AccountStore, AccountView};
use crate::core::auth::AuthSession;
use crate::error::{AppError, Result};
use crate::skins::{fetch_uuid_skin, Library, SkinWithData};
use crate::state::AppState;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

pub const EV_MS_LOGIN: &str = "ms-login";

fn store(state: &AppState) -> AccountStore {
    AccountStore::load(&state.paths.accounts_file())
}

fn client_id(state: &AppState) -> Result<String> {
    state
        .settings
        .read()
        .microsoft_client_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::msg("Microsoft girişi için Ayarlar → Hesaplar ve anahtarlar bölümüne bir Azure uygulama (client) kimliği girin."))
}

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Vec<AccountView> {
    store(&state).views()
}

#[tauri::command]
pub fn add_offline_account(state: State<'_, AppState>, name: String) -> Result<Vec<AccountView>> {
    let mut s = store(&state);
    s.upsert(offline_account(name.trim())?);
    s.save(&state.paths.accounts_file())?;
    Ok(s.views())
}

#[tauri::command]
pub fn set_active_account(state: State<'_, AppState>, uuid: String) -> Result<Vec<AccountView>> {
    let mut s = store(&state);
    s.get_mut(&uuid)?;
    s.active = Some(uuid);
    s.save(&state.paths.accounts_file())?;
    Ok(s.views())
}

#[tauri::command]
pub fn remove_account(state: State<'_, AppState>, uuid: String) -> Result<Vec<AccountView>> {
    let mut s = store(&state);
    s.remove(&uuid);
    s.save(&state.paths.accounts_file())?;
    Ok(s.views())
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginEvent {
    /// "done" | "error" | "cancelled"
    status: &'static str,
    username: Option<String>,
    message: Option<String>,
}

/// Cihaz kodu akışını başlatır; kullanıcı kodu tarayıcıda girerken arka planda yoklar.
#[tauri::command]
pub async fn ms_login_start(app: AppHandle, state: State<'_, AppState>) -> Result<microsoft::DeviceCode> {
    let cid = client_id(&state)?;
    let code = microsoft::start(&state.http, &cid).await?;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(prev) = state.ms_login.lock().replace(cancel.clone()) {
        prev.store(true, Ordering::Relaxed);
    }
    let dc = code.clone();
    tokio::spawn(async move {
        let st = app.state::<AppState>();
        let mut interval = dc.interval.max(2);
        let deadline = std::time::Instant::now() + Duration::from_secs(dc.expires_in);
        let result: Result<Option<String>> = async {
            loop {
                tokio::time::sleep(Duration::from_secs(interval)).await;
                if cancel.load(Ordering::Relaxed) {
                    return Ok(None);
                }
                if std::time::Instant::now() > deadline {
                    return Err(AppError::msg("Kodun süresi doldu"));
                }
                match microsoft::poll(&st.http, &cid, &dc.device_code).await? {
                    microsoft::Poll::Pending => {}
                    microsoft::Poll::SlowDown => interval += 5,
                    microsoft::Poll::Done { access, refresh } => {
                        let (acc, _profile) = microsoft::finish_login(&st.http, &access, &refresh, false, &|_| {}).await?;
                        let name = acc.username.clone();
                        let mut s = store(&st);
                        s.upsert(acc);
                        s.save(&st.paths.accounts_file())?;
                        return Ok(Some(name));
                    }
                }
            }
        }
        .await;
        let ev = match result {
            Ok(Some(name)) => LoginEvent { status: "done", username: Some(name), message: None },
            Ok(None) => LoginEvent { status: "cancelled", username: None, message: None },
            Err(e) => LoginEvent { status: "error", username: None, message: Some(e.to_string()) },
        };
        let _ = app.emit(EV_MS_LOGIN, ev);
    });
    Ok(code)
}

#[tauri::command]
pub fn ms_login_cancel(app: AppHandle, state: State<'_, AppState>) {
    if let Some(c) = state.ms_login.lock().take() {
        c.store(true, Ordering::Relaxed);
    }
    if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = w.close();
    }
}

const LOGIN_WINDOW: &str = "ms-login";
const CANCELLED: &str = microsoft::LOGIN_CANCELLED;

type CodeSender = Arc<parking_lot::Mutex<Option<tokio::sync::oneshot::Sender<Result<String>>>>>;

fn deliver(tx: &CodeSender, r: Result<String>) {
    if let Some(t) = tx.lock().take() {
        let _ = t.send(r);
    }
}

/// Doğrudan Microsoft girişi: login.live.com launcher içinde ayrı bir pencerede
/// açılır. Pencere IPC yetkisi olmayan harici bir sayfadır; yalnızca yönlendirme
/// adresindeki yetki kodu yakalanır, şifre launcher'a hiç ulaşmaz.
#[tauri::command]
pub async fn ms_login_window(app: AppHandle) -> Result<()> {
    if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
        let _ = w.set_focus();
        return Ok(());
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String>>();
    let tx: CodeSender = Arc::new(parking_lot::Mutex::new(Some(tx)));
    let url: tauri::Url = microsoft::live_authorize_url().parse().map_err(|e| AppError::msg(format!("{e}")))?;

    let nav_tx = tx.clone();
    let load_tx = tx.clone();
    let win = tauri::WebviewWindowBuilder::new(&app, LOGIN_WINDOW, tauri::WebviewUrl::External(url))
        .title("Microsoft ile giriş · West Launcher")
        .inner_size(500.0, 680.0)
        .min_inner_size(420.0, 560.0)
        .center()
        .focused(true)
        .incognito(true)
        .on_navigation(move |u| {
            tracing::info!("ms-login gezinme: {}{}", u.host_str().unwrap_or(""), u.path());
            match microsoft::code_from_redirect(u.as_str()) {
                Some(r) => {
                    deliver(&nav_tx, r);
                    false
                }
                None => true,
            }
        })
        // Bazı WebView2 sürümleri sunucu yönlendirmesini gezinme olayı olarak bildirmez → sayfa yüklenince de bak
        .on_page_load(move |_w, p| {
            if let Some(r) = microsoft::code_from_redirect(p.url().as_str()) {
                deliver(&load_tx, r);
            }
        })
        .build()
        .map_err(|e| AppError::msg(format!("Giriş penceresi açılamadı: {e}")))?;

    let close_tx = tx.clone();
    win.on_window_event(move |e| {
        if matches!(e, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
            deliver(&close_tx, Err(AppError::msg(CANCELLED)));
        }
    });

    // Bazı WebView'lar yönlendirmeyi gezinme olayı olarak bildirmez → adresi de izle
    let poll_tx = tx.clone();
    let poll_app = app.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(300)).await;
            if poll_tx.lock().is_none() {
                break;
            }
            let Some(w) = poll_app.get_webview_window(LOGIN_WINDOW) else { break };
            if let Ok(u) = w.url() {
                if let Some(r) = microsoft::code_from_redirect(u.as_str()) {
                    deliver(&poll_tx, r);
                    break;
                }
            }
        }
    });

    tokio::spawn(async move {
        let result = rx.await.unwrap_or_else(|_| Err(AppError::msg(CANCELLED)));
        if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
            let _ = w.close();
        }
        let st = app.state::<AppState>();
        let ev = match result {
            Err(e) if e.to_string() == CANCELLED => LoginEvent { status: "cancelled", username: None, message: None },
            Err(e) => LoginEvent { status: "error", username: None, message: Some(e.to_string()) },
            Ok(code) => {
                let stage_app = app.clone();
                let stage = move |m: &'static str| {
                    tracing::info!("ms-login: {m}");
                    let _ = stage_app.emit(EV_MS_LOGIN, LoginEvent { status: "progress", username: None, message: Some(m.into()) });
                };
                stage("Microsoft oturumu doğrulanıyor…");
                let work = async {
                    let (access, refresh) = microsoft::live_exchange(&st.http, &code).await?;
                    let (acc, _) = microsoft::finish_login(&st.http, &access, &refresh, true, &stage).await?;
                    let name = acc.username.clone();
                    let mut s = store(&st);
                    s.upsert(acc);
                    s.save(&st.paths.accounts_file())?;
                    Ok::<String, AppError>(name)
                };
                // Hiçbir durumda sonsuz yükleme olmasın
                let done: Result<String> = match tokio::time::timeout(Duration::from_secs(120), work).await {
                    Ok(r) => r.map_err(|e| {
                        tracing::warn!("ms-login başarısız: {e}");
                        e
                    }),
                    Err(_) => Err(AppError::msg("Microsoft/Xbox sunucuları zamanında yanıt vermedi. İnternet bağlantını kontrol edip tekrar dene.")),
                };
                match done {
                    Ok(name) => LoginEvent { status: "done", username: Some(name), message: None },
                    Err(e) => LoginEvent { status: "error", username: None, message: Some(e.to_string()) },
                }
            }
        };
        let _ = app.emit(EV_MS_LOGIN, ev);
    });
    Ok(())
}

/// Başlatma için oturum: açık parametre > etkin hesap (MS ise token tazelenir) > offline ad.
pub async fn resolve_launch_auth(state: &AppState, auth: Option<AuthSession>, offline_name: Option<String>) -> Result<AuthSession> {
    if let Some(a) = auth {
        return Ok(a);
    }
    let mut s = store(state);
    if let Some(uuid) = s.active.clone() {
        let cid = state.settings.read().microsoft_client_id.clone().unwrap_or_default();
        let acc = s.get_mut(&uuid)?;
        if acc.ms.is_some() {
            if microsoft::ensure_fresh(&state.http, &cid, acc).await? {
                let session = acc.session();
                s.save(&state.paths.accounts_file())?;
                return Ok(session);
            }
        }
        return Ok(acc.session());
    }
    super::launch::resolve_auth(None, offline_name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub uploaded: bool,
    pub accounts: Vec<AccountView>,
}

/// Arşivdeki skini hesaba uygular. Microsoft → Mojang'a yüklenir;
/// offline → launcher'da etkin skin olur (oyunda West Companion ile görünür).
#[tauri::command]
pub async fn apply_skin(state: State<'_, AppState>, skin_id: String, account: String) -> Result<ApplyResult> {
    let lib = Library::new(&state.paths.root);
    let entry = lib.list().into_iter().find(|e| e.id == skin_id).ok_or_else(|| AppError::NotFound("skin".into()))?;
    let png = lib.read(&skin_id)?;
    let mut s = store(&state);
    let cid = state.settings.read().microsoft_client_id.clone().unwrap_or_default();
    let acc = s.get_mut(&account)?;
    let mut uploaded = false;
    if acc.ms.is_some() {
        microsoft::ensure_fresh(&state.http, &cid, acc).await?;
        let token = acc.ms.as_ref().unwrap().mc_access_token.clone();
        microsoft::upload_skin(&state.http, &token, png, entry.slim).await?;
        uploaded = true;
    }
    acc.skin_id = Some(skin_id.clone());
    s.save(&state.paths.accounts_file())?;
    lib.update(&skin_id, None, None, None, true)?;
    Ok(ApplyResult { uploaded, accounts: s.views() })
}

/// Hesabın şu anki skini. Microsoft için Mojang'dan çekilip arşive eklenir.
#[tauri::command]
pub async fn account_skin(state: State<'_, AppState>, account: String) -> Result<Option<SkinWithData>> {
    let lib = Library::new(&state.paths.root);
    let mut s = store(&state);
    let acc = s.get_mut(&account)?;
    if acc.ms.is_some() {
        let (png, slim) = fetch_uuid_skin(&state.http, &acc.uuid).await?;
        let e = lib.add(&png, &format!("{} (hesap)", acc.username), slim, "account")?;
        acc.skin_id = Some(e.id.clone());
        s.save(&state.paths.accounts_file())?;
        return Ok(lib.with_data(e));
    }
    Ok(acc.skin_id.clone().and_then(|id| lib.list().into_iter().find(|e| e.id == id)).and_then(|e| lib.with_data(e)))
}

#[tauri::command]
pub async fn account_capes(state: State<'_, AppState>, account: String) -> Result<Vec<microsoft::Cape>> {
    let mut s = store(&state);
    let cid = state.settings.read().microsoft_client_id.clone().unwrap_or_default();
    let acc = s.get_mut(&account)?;
    if acc.ms.is_none() {
        return Ok(vec![]);
    }
    if microsoft::ensure_fresh(&state.http, &cid, acc).await? {
        let token = acc.ms.as_ref().unwrap().mc_access_token.clone();
        s.save(&state.paths.accounts_file())?;
        return Ok(microsoft::profile(&state.http, &token).await?.capes);
    }
    Ok(microsoft::profile(&state.http, &acc.ms.as_ref().unwrap().mc_access_token).await?.capes)
}

#[tauri::command]
pub async fn set_account_cape(state: State<'_, AppState>, account: String, cape_id: Option<String>) -> Result<()> {
    let mut s = store(&state);
    let cid = state.settings.read().microsoft_client_id.clone().unwrap_or_default();
    let acc = s.get_mut(&account)?;
    if acc.ms.is_none() {
        return Err(AppError::msg("Pelerin yalnızca Microsoft hesaplarında değiştirilebilir"));
    }
    microsoft::ensure_fresh(&state.http, &cid, acc).await?;
    let token = acc.ms.as_ref().unwrap().mc_access_token.clone();
    s.save(&state.paths.accounts_file())?;
    microsoft::set_cape(&state.http, &token, cape_id.as_deref()).await
}

