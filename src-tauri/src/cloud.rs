//! West hesabı (Supabase Auth). Şifreyi Supabase saklar ve doğrular; West Client
//! şifreyi hiçbir yere yazmaz. Oturum anahtarları yalnızca bu bilgisayarda
//! `west-account.json` dosyasında tutulur ve arayüze gönderilmez.

use crate::core::http::Http;
use crate::error::{AppError, Result};
use crate::util::write_json_atomic;
use chrono::{DateTime, Duration, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct CloudConfig {
    supabase_url: String,
    supabase_anon_key: String,
}

/// Derleme sırasında gömülen proje bilgileri. "anon" anahtarı gizli değildir
/// (tarayıcıdaki her Supabase uygulamasında görünür); erişimi veritabanı kuralları korur.
static CONFIG: Lazy<CloudConfig> = Lazy::new(|| {
    let mut c: CloudConfig = serde_json::from_str(include_str!("../west-cloud.json")).unwrap_or_default();
    if let Some(u) = option_env!("WEST_SUPABASE_URL").filter(|s| !s.is_empty()) {
        c.supabase_url = u.into();
    }
    if let Some(k) = option_env!("WEST_SUPABASE_ANON_KEY").filter(|s| !s.is_empty()) {
        c.supabase_anon_key = k.into();
    }
    c.supabase_url = c.supabase_url.trim_end_matches('/').to_string();
    c
});

pub fn configured() -> bool {
    !CONFIG.supabase_url.is_empty() && !CONFIG.supabase_anon_key.is_empty()
}

fn cfg() -> Result<&'static CloudConfig> {
    if configured() { Ok(&CONFIG) } else { Err(AppError::msg(crate::i18n::t("West hesap sunucusu henüz ayarlanmadı."))) }
}

static USERNAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Za-z0-9_]{3,16}$").unwrap());
static EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").unwrap());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    user_id: String,
    username: String,
    email: String,
    email_confirmed: bool,
    access_token: String,
    refresh_token: String,
    expires_at: DateTime<Utc>,
}

/// Arayüzün gördüğü bilgi (anahtar yok).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WestAccount {
    pub user_id: String,
    pub username: String,
    pub email: String,
    pub email_confirmed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub configured: bool,
    pub account: Option<WestAccount>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignupResult {
    /// E-posta doğrulaması gerekiyorsa true (oturum doğrulamadan sonra açılır)
    pub needs_confirmation: bool,
    pub account: Option<WestAccount>,
}

fn file(root: &Path) -> PathBuf {
    root.join("west-account.json")
}

fn load(root: &Path) -> Option<Session> {
    std::fs::read(file(root)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save(root: &Path, s: &Session) -> Result<()> {
    let p = file(root);
    write_json_atomic(&p, s)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn view(s: &Session) -> WestAccount {
    WestAccount { user_id: s.user_id.clone(), username: s.username.clone(), email: s.email.clone(), email_confirmed: s.email_confirmed }
}

#[derive(Deserialize)]
struct AuthUser {
    id: String,
    email: Option<String>,
    email_confirmed_at: Option<String>,
    #[serde(default)]
    user_metadata: serde_json::Value,
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
    user: Option<AuthUser>,
}

/// Supabase hata yanıtını anlaşılır Türkçeye çevirir.
fn friendly(status: reqwest::StatusCode, body: &str) -> AppError {
    let v: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let code = v["error_code"].as_str().or(v["code"].as_str()).or(v["error"].as_str()).unwrap_or("");
    let msg = v["msg"].as_str().or(v["error_description"].as_str()).or(v["message"].as_str()).unwrap_or(body);
    let lower = format!("{code} {msg}").to_lowercase();
    let text = if lower.contains("already") || lower.contains("user_already_exists") || lower.contains("email_exists") {
        "Bu e-posta adresiyle zaten bir West hesabı var. Giriş yapmayı dene."
    } else if lower.contains("database error") || lower.contains("duplicate") || lower.contains("unique") {
        "Bu kullanıcı adı alınmış. Başka bir ad seç."
    } else if lower.contains("invalid login") || lower.contains("invalid_credentials") || lower.contains("invalid_grant") {
        "E-posta ya da şifre yanlış."
    } else if lower.contains("email not confirmed") || lower.contains("email_not_confirmed") {
        "E-posta adresin henüz doğrulanmadı. Gelen kutundaki bağlantıya tıkla."
    } else if lower.contains("weak") || lower.contains("password should") {
        "Şifre çok zayıf. En az 8 karakter; harf ve rakam karışık olsun."
    } else if lower.contains("rate") || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene."
    } else if lower.contains("invalid") && lower.contains("email") {
        "Geçerli bir e-posta adresi gir."
    } else {
        return AppError::msg(crate::i18n::tf("West hesabı: {0}", &[&msg]));
    };
    AppError::msg(crate::i18n::t(text))
}

async fn post(http: &Http, path: &str, body: serde_json::Value, bearer: Option<&str>) -> Result<String> {
    let c = cfg()?;
    let mut req = http
        .client
        .post(format!("{}{path}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(25))
        .header("apikey", &c.supabase_anon_key)
        .json(&body);
    // Yeni "sb_publishable_" anahtarları JWT değildir: yalnızca `apikey` başlığında gider.
    // Eski "anon" (JWT) anahtarı Authorization'da da beklenir.
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    } else if !c.supabase_anon_key.starts_with("sb_") {
        req = req.bearer_auth(&c.supabase_anon_key);
    }
    let resp = req.send().await.map_err(|e| AppError::msg(crate::i18n::tf("West hesap sunucusuna ulaşılamadı: {0}", &[&e])))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(friendly(status, &text));
    }
    Ok(text)
}

fn session_from(t: TokenResp, fallback_username: Option<&str>) -> Option<Session> {
    let (access, refresh, user) = (t.access_token?, t.refresh_token?, t.user?);
    Some(Session {
        username: user.user_metadata["username"].as_str().or(fallback_username).unwrap_or("").to_string(),
        email: user.email.unwrap_or_default(),
        email_confirmed: user.email_confirmed_at.is_some(),
        user_id: user.id,
        access_token: access,
        refresh_token: refresh,
        expires_at: Utc::now() + Duration::seconds(t.expires_in.unwrap_or(3600) - 60),
    })
}

pub fn validate(username: &str, email: &str, password: &str) -> Result<()> {
    if !USERNAME.is_match(username) {
        return Err(AppError::msg(crate::i18n::t("Kullanıcı adı 3–16 karakter olmalı; yalnızca harf, rakam ve alt çizgi.")));
    }
    if !EMAIL.is_match(email) {
        return Err(AppError::msg(crate::i18n::t("Geçerli bir e-posta adresi gir.")));
    }
    if password.chars().count() < 8 {
        return Err(AppError::msg(crate::i18n::t("Şifre en az 8 karakter olmalı.")));
    }
    if !(password.chars().any(|c| c.is_alphabetic()) && password.chars().any(|c| c.is_ascii_digit())) {
        return Err(AppError::msg(crate::i18n::t("Şifrede en az bir harf ve bir rakam olsun.")));
    }
    Ok(())
}

/// Kullanıcı adı boşta mı? (profiles tablosu, büyük/küçük harf duyarsız)
pub async fn username_available(http: &Http, username: &str) -> Result<bool> {
    let c = cfg()?;
    if !USERNAME.is_match(username) {
        return Ok(false);
    }
    let mut req = http
        .client
        .get(format!("{}/rest/v1/profiles", c.supabase_url))
        .timeout(std::time::Duration::from_secs(15))
        .header("apikey", &c.supabase_anon_key);
    if !c.supabase_anon_key.starts_with("sb_") {
        req = req.bearer_auth(&c.supabase_anon_key);
    }
    let rows: Vec<serde_json::Value> = req
        .query(&[("select", "username"), ("username", &format!("ilike.{username}"))])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(rows.is_empty())
}

pub async fn signup(http: &Http, root: &Path, username: &str, email: &str, password: &str) -> Result<SignupResult> {
    let (username, email) = (username.trim(), email.trim().to_lowercase());
    validate(username, &email, password)?;
    if !username_available(http, username).await.unwrap_or(true) {
        return Err(AppError::msg(crate::i18n::t("Bu kullanıcı adı alınmış. Başka bir ad seç.")));
    }
    let body = post(http, "/auth/v1/signup", serde_json::json!({ "email": email, "password": password, "data": { "username": username } }), None).await?;
    let t: TokenResp = serde_json::from_str(&body).unwrap_or(TokenResp { access_token: None, refresh_token: None, expires_in: None, user: None });
    match session_from(t, Some(username)) {
        Some(s) => {
            save(root, &s)?;
            Ok(SignupResult { needs_confirmation: false, account: Some(view(&s)) })
        }
        // Proje e-posta doğrulaması istiyor: oturum doğrulamadan sonra girişle açılır
        None => Ok(SignupResult { needs_confirmation: true, account: None }),
    }
}

pub async fn login(http: &Http, root: &Path, email: &str, password: &str) -> Result<WestAccount> {
    let email = email.trim().to_lowercase();
    if !EMAIL.is_match(&email) {
        return Err(AppError::msg(crate::i18n::t("Giriş için e-posta adresini gir.")));
    }
    let body = post(http, "/auth/v1/token?grant_type=password", serde_json::json!({ "email": email, "password": password }), None).await?;
    let t: TokenResp = serde_json::from_str(&body)?;
    let s = session_from(t, None).ok_or_else(|| AppError::msg(crate::i18n::t("West hesabına giriş yapılamadı.")))?;
    save(root, &s)?;
    Ok(view(&s))
}

async fn refresh(http: &Http, root: &Path, s: &Session) -> Result<Session> {
    let body = post(http, "/auth/v1/token?grant_type=refresh_token", serde_json::json!({ "refresh_token": s.refresh_token }), None).await?;
    let t: TokenResp = serde_json::from_str(&body)?;
    let fresh = session_from(t, Some(&s.username)).ok_or_else(|| AppError::msg("Oturum yenilenemedi."))?;
    save(root, &fresh)?;
    Ok(fresh)
}

/// Kayıtlı oturum; süresi dolduysa yenilenir. Sunucuya ulaşılamazsa son bilinen bilgi gösterilir.
pub async fn status(http: &Http, root: &Path) -> Status {
    if !configured() {
        return Status { configured: false, account: None };
    }
    let Some(s) = load(root) else { return Status { configured: true, account: None } };
    if s.expires_at > Utc::now() {
        return Status { configured: true, account: Some(view(&s)) };
    }
    match refresh(http, root, &s).await {
        Ok(f) => Status { configured: true, account: Some(view(&f)) },
        // Sunucuya ulaşılamadı (mesaj seçili dile çevrilmiş olabilir)
        Err(e) if e.to_string().contains(crate::i18n::tf("West hesap sunucusuna ulaşılamadı: {0}", &[&""]).trim_end()) => Status { configured: true, account: Some(view(&s)) },
        Err(_) => {
            // Oturum iptal edilmiş (şifre değişti vb.)
            let _ = std::fs::remove_file(file(root));
            Status { configured: true, account: None }
        }
    }
}

pub async fn logout(http: &Http, root: &Path) -> Result<()> {
    if let Some(s) = load(root) {
        let _ = post(http, "/auth/v1/logout", serde_json::json!({}), Some(&s.access_token)).await;
    }
    let _ = std::fs::remove_file(file(root));
    Ok(())
}

pub async fn reset_password(http: &Http, email: &str) -> Result<()> {
    let email = email.trim().to_lowercase();
    if !EMAIL.is_match(&email) {
        return Err(AppError::msg(crate::i18n::t("Geçerli bir e-posta adresi gir.")));
    }
    post(http, "/auth/v1/recover", serde_json::json!({ "email": email }), None).await?;
    Ok(())
}

// ───────── Sosyal ağ: kısıtlı veri kapısı ─────────

/// Geçerli (gerekirse yenilenmiş) oturum anahtarı; giriş yoksa None.
async fn token(http: &Http, root: &Path) -> Option<(String, String)> {
    let s = load(root)?;
    if s.expires_at > Utc::now() {
        return Some((s.access_token, s.user_id));
    }
    refresh(http, root, &s).await.ok().map(|f| (f.access_token, f.user_id))
}

/// Giriş yapmış West hesabının kimliği (oturum gerekirse yenilenir); giriş yoksa None.
pub async fn current_user(http: &Http, root: &Path) -> Option<String> {
    token(http, root).await.map(|(_, id)| id)
}

/// Arayüzün veritabanına tek kapısı. Yalnızca `/rest/v1/` (tablolar, görünümler, fonksiyonlar)
/// adreslerine izin verilir; erişimi Supabase'teki satır güvenliği kuralları belirler.
pub async fn api(http: &Http, root: &Path, method: &str, path: &str, query: &[(String, String)], body: Option<serde_json::Value>, prefer: Option<&str>) -> Result<serde_json::Value> {
    let c = cfg()?;
    if !path.starts_with("/rest/v1/") || path.contains("..") || path.contains('?') || path.contains('#') {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let m = match method {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        _ => return Err(AppError::msg(crate::i18n::t("Geçersiz istek"))),
    };
    let tok = token(http, root).await;
    if m != reqwest::Method::GET && tok.is_none() && !path.starts_with("/rest/v1/rpc/") {
        return Err(AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")));
    }
    let mut req = http
        .client
        .request(m, format!("{}{path}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(25))
        .header("apikey", &c.supabase_anon_key)
        .query(query);
    if let Some((t, _)) = &tok {
        req = req.bearer_auth(t);
    } else if !c.supabase_anon_key.starts_with("sb_") {
        req = req.bearer_auth(&c.supabase_anon_key);
    }
    if let Some(p) = prefer {
        req = req.header("Prefer", p);
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.map_err(|e| AppError::msg(crate::i18n::tf("West sunucusuna ulaşılamadı: {0}", &[&e])))?;
    let status = resp.status();
    let range = resp.headers().get("content-range").and_then(|v| v.to_str().ok()).map(String::from);
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let msg = v["message"].as_str().or(v["msg"].as_str()).unwrap_or(&text).to_string();
        // Yalnızca tablo/fonksiyonun kendisi yoksa "SQL çalıştırılmamış" de; başka hatalar olduğu gibi görünsün
        if msg.contains("schema cache") || (msg.contains("does not exist") && msg.contains("\"public.")) {
            if path.contains("depot") || path.contains("role") {
                return Err(AppError::msg(crate::i18n::t("Depo için Supabase'te supabase/depot.sql dosyası henüz çalıştırılmamış.")));
            }
            return Err(AppError::msg(crate::i18n::t("Sosyal özellikler için Supabase'te supabase/social.sql dosyası henüz çalıştırılmamış.")));
        }
        return Err(AppError::msg(msg));
    }
    let data: serde_json::Value = if text.trim().is_empty() { serde_json::Value::Null } else { serde_json::from_str(&text)? };
    // Sayfalama için toplam sayı (Prefer: count=exact)
    if let Some(total) = range.and_then(|r| r.rsplit('/').next().and_then(|n| n.parse::<u64>().ok())) {
        return Ok(serde_json::json!({ "data": data, "total": total }));
    }
    Ok(data)
}

/// Bir Supabase Edge Function'ı West hesabının oturumuyla çağırır (ör. lobby-verify).
pub async fn function(http: &Http, root: &Path, name: &str, body: serde_json::Value) -> Result<serde_json::Value> {
    let c = cfg()?;
    if !name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let (tok, _) = token(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")))?;
    let resp = http
        .client
        .post(format!("{}/functions/v1/{name}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(25))
        .header("apikey", &c.supabase_anon_key)
        .bearer_auth(&tok)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::msg(crate::i18n::tf("West sunucusuna ulaşılamadı: {0}", &[&e])))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    if status == reqwest::StatusCode::NOT_FOUND && v["error"].is_null() {
        return Err(AppError::msg(crate::i18n::tf("Supabase'te \"{0}\" fonksiyonu henüz yayınlanmamış.", &[&name])));
    }
    if !status.is_success() {
        let msg = v["error"].as_str().or(v["message"].as_str()).map(String::from).unwrap_or_else(|| text.chars().take(200).collect());
        return Err(AppError::msg(msg));
    }
    Ok(v)
}

/// Oyunun Supabase Realtime'a (WebSocket) bağlanması için gereken bilgiler: adres, herkese açık
/// anahtar ve kullanıcının kısa ömürlü oturum anahtarı (yalnızca kendi verisine erişir).
pub async fn realtime(http: &Http, root: &Path) -> Result<serde_json::Value> {
    let c = cfg()?;
    let (tok, uid) = token(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")))?;
    let host = c.supabase_url.trim_end_matches('/').replacen("https://", "wss://", 1).replacen("http://", "ws://", 1);
    Ok(serde_json::json!({
        "url": format!("{host}/realtime/v1/websocket?apikey={}&vsn=1.0.0", c.supabase_anon_key),
        "token": tok,
        "user": uid,
    }))
}

/// Görsel yükler (avatar, banner, gönderi, hikâye, mesaj) ve herkese açık adresini döner.
pub async fn upload(http: &Http, root: &Path, local: &Path, folder: &str) -> Result<String> {
    let c = cfg()?;
    if !["avatars", "banners", "posts", "stories", "messages", "depot"].contains(&folder) {
        return Err(AppError::msg(crate::i18n::t("Geçersiz klasör")));
    }
    let (tok, uid) = token(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")))?;
    let ext = local.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return Err(AppError::msg(crate::i18n::t("Yalnızca PNG, JPG, WEBP veya GIF yüklenebilir"))),
    };
    let bytes = tokio::fs::read(local).await?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(AppError::msg(crate::i18n::t("Görsel en fazla 8 MB olabilir")));
    }
    let name = format!("{uid}/{folder}/{}.{ext}", uuid::Uuid::new_v4());
    let resp = http
        .client
        .post(format!("{}/storage/v1/object/media/{name}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(60))
        .header("apikey", &c.supabase_anon_key)
        .bearer_auth(&tok)
        .header("Content-Type", mime)
        .header("x-upsert", "false")
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::msg(crate::i18n::tf("Yükleme başarısız: {0}", &[&e])))?;
    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        if t.contains("Bucket not found") {
            return Err(AppError::msg(crate::i18n::t("Görsel deposu yok: Supabase'te supabase/social.sql dosyasını çalıştır.")));
        }
        return Err(AppError::msg(crate::i18n::tf("Yükleme başarısız: {0}", &[&t.chars().take(200).collect::<String>()])));
    }
    Ok(format!("{}/storage/v1/object/public/media/{name}", c.supabase_url))
}

// ───────── Depo (topluluk dosyaları) ─────────

/// Depo dosyasını kullanıcının kendi klasörüne yükler; depodaki yolunu döner. Yalnızca Onaylı ve
/// üstü roller yükleyebilir (Supabase depolama kuralı); dosya önceden doğrulanmış olmalı.
pub async fn upload_depot(http: &Http, root: &Path, local: &Path, file_name: &str) -> Result<String> {
    let c = cfg()?;
    let (tok, uid) = token(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")))?;
    let bytes = tokio::fs::read(local).await?;
    if bytes.len() as u64 > crate::depot::MAX_SIZE {
        return Err(AppError::msg(crate::i18n::t("Dosya en fazla 50 MB olabilir. Büyük dünyaları küçültmek için gereksiz bölgeleri silip yeniden sıkıştır.")));
    }
    let name = format!("{uid}/{}/{}", uuid::Uuid::new_v4(), crate::depot::safe_name(file_name));
    let resp = http
        .client
        .post(format!("{}/storage/v1/object/depot/{name}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(600))
        .header("apikey", &c.supabase_anon_key)
        .bearer_auth(&tok)
        .header("Content-Type", "application/octet-stream")
        .header("x-upsert", "false")
        .body(bytes)
        .send()
        .await
        .map_err(|e| AppError::msg(crate::i18n::tf("Yükleme başarısız: {0}", &[&e])))?;
    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        if t.contains("Bucket not found") {
            return Err(AppError::msg(crate::i18n::t("Depo henüz kurulmamış: Supabase'te supabase/depot.sql dosyasını çalıştır.")));
        }
        if t.contains("row-level security") || t.contains("Unauthorized") || t.contains("403") {
            return Err(AppError::msg(crate::i18n::t("Depo'ya yalnızca Onaylı kullanıcılar dosya yükleyebilir.")));
        }
        if t.contains("Payload too large") || t.contains("exceeded the maximum") {
            return Err(AppError::msg(crate::i18n::t("Dosya Supabase'in boyut sınırını aşıyor (en fazla 50 MB).")));
        }
        return Err(AppError::msg(crate::i18n::tf("Yükleme başarısız: {0}", &[&t.chars().take(200).collect::<String>()])));
    }
    Ok(name)
}

/// Depodaki bir dosyayı siler (sahibi ya da moderatör; kuralı Supabase uygular)
pub async fn delete_depot(http: &Http, root: &Path, path: &str) -> Result<()> {
    let c = cfg()?;
    if path.contains("..") || path.starts_with('/') {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let (tok, _) = token(http, root).await.ok_or_else(|| AppError::msg(crate::i18n::t("Bunun için West hesabına giriş yapmalısın.")))?;
    let resp = http
        .client
        .delete(format!("{}/storage/v1/object/depot/{path}", c.supabase_url))
        .timeout(std::time::Duration::from_secs(30))
        .header("apikey", &c.supabase_anon_key)
        .bearer_auth(&tok)
        .send()
        .await
        .map_err(|e| AppError::msg(crate::i18n::tf("West sunucusuna ulaşılamadı: {0}", &[&e])))?;
    if !resp.status().is_success() && resp.status() != reqwest::StatusCode::NOT_FOUND {
        let t = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(t.chars().take(200).collect::<String>()));
    }
    Ok(())
}

/// Depodaki dosyanın herkese açık indirme adresi
pub fn depot_url(path: &str) -> Result<String> {
    let c = cfg()?;
    if path.contains("..") || path.starts_with('/') {
        return Err(AppError::msg(crate::i18n::t("Geçersiz istek")));
    }
    let enc: Vec<String> = path.split('/').map(|p| urlencoding_encode(p)).collect();
    Ok(format!("{}/storage/v1/object/public/depot/{}", c.supabase_url, enc.join("/")))
}

fn urlencoding_encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'+') { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validation() {
        assert!(validate("Ashi_West", "a@b.co", "gizli1234").is_ok());
        assert!(validate("ab", "a@b.co", "gizli1234").is_err());
        assert!(validate("Ashi West", "a@b.co", "gizli1234").is_err());
        assert!(validate("AshiWest", "abc", "gizli1234").is_err());
        assert!(validate("AshiWest", "a@b.co", "kisa1").is_err());
        assert!(validate("AshiWest", "a@b.co", "sadeceharf").is_err());
    }
    #[test]
    fn friendly_errors() {
        let e = friendly(reqwest::StatusCode::BAD_REQUEST, r#"{"error":"invalid_grant","error_description":"Invalid login credentials"}"#);
        assert!(e.to_string().contains("yanlış"));
        let e = friendly(reqwest::StatusCode::UNPROCESSABLE_ENTITY, r#"{"code":422,"error_code":"user_already_exists","msg":"User already registered"}"#);
        assert!(e.to_string().contains("zaten"));
    }
}
