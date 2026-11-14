//! Microsoft → Xbox Live → XSTS → Minecraft kimlik zinciri (cihaz kodu akışı)
//! ve Minecraft Services profil/skin/pelerin uç noktaları.
//!
//! İki giriş yolu:
//!   - Doğrudan giriş (varsayılan): Microsoft'un login.live.com sayfası launcher
//!     içinde ayrı bir pencerede açılır; kullanıcı e-posta/şifresiyle giriş yapar.
//!     Minecraft'ın masaüstü istemci kimliği kullanılır, ayrıca kimlik gerekmez.
//!   - Cihaz kodu (gelişmiş): Mojang onaylı kendi Azure uygulama kimliğiyle.

use super::{Account, AccountKind, MsTokens};
use crate::core::http::Http;
use crate::error::{AppError, Result};
use chrono::{Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;

const DEVICE_CODE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";
const XBL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

// ───────── Doğrudan giriş (login.live.com) ─────────
const LIVE_CLIENT_ID: &str = "00000000402b5328";
const LIVE_AUTHORIZE: &str = "https://login.live.com/oauth20_authorize.srf";
const LIVE_TOKEN: &str = "https://login.live.com/oauth20_token.srf";
/// Girişin kullanıcı tarafından iptal edildiğini belirten iç işaret.
pub const LOGIN_CANCELLED: &str = "__west_login_cancelled__";
pub const LIVE_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
const LIVE_SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";

/// Giriş penceresinde açılacak Microsoft sayfası.
pub fn live_authorize_url() -> String {
    let q = |s: &str| s.replace(':', "%3A").replace('/', "%2F");
    format!(
        "{LIVE_AUTHORIZE}?client_id={LIVE_CLIENT_ID}&response_type=code&scope={}&redirect_uri={}&prompt=select_account",
        q(LIVE_SCOPE),
        q(LIVE_REDIRECT)
    )
}

/// Pencere yönlendirmesinden yetki kodunu ayıklar (`...oauth20_desktop.srf?code=...`).
pub fn code_from_redirect(url: &str) -> Option<Result<String>> {
    if !url.starts_with(LIVE_REDIRECT) {
        return None;
    }
    // Değerler URL kodlu gelir (ör. %24 → $). Çözülmeden gönderilirse Microsoft
    // "The provided value for the 'code' parameter is not valid" der.
    let parsed = reqwest::Url::parse(url).ok()?;
    let pairs: Vec<(String, String)> = parsed.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let param = |k: &str| pairs.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.trim().to_string()).filter(|v| !v.is_empty());
    if let Some(code) = param("code") {
        return Some(Ok(code));
    }
    // Kullanıcı Microsoft sayfasındaki × ile vazgeçti → hata değil, sessiz iptal
    if param("error").as_deref() == Some("access_denied") {
        return Some(Err(AppError::msg(LOGIN_CANCELLED)));
    }
    let desc = param("error_description").or(param("error")).unwrap_or_else(|| "bilinmeyen hata".into());
    Some(Err(AppError::msg(format!("Microsoft girişi iptal edildi veya başarısız: {desc}"))))
}

async fn live_token(http: &Http, form: &[(&str, &str)]) -> Result<(String, String)> {
    let r: TokenResp = http.client.post(LIVE_TOKEN).timeout(STEP_TIMEOUT).form(form).send().await?.json().await?;
    match (r.access_token, r.refresh_token) {
        (Some(a), Some(rt)) => Ok((a, rt)),
        _ => Err(AppError::msg(format!("Microsoft oturumu alınamadı: {}", r.error_description.or(r.error).unwrap_or_default()))),
    }
}

pub async fn live_exchange(http: &Http, code: &str) -> Result<(String, String)> {
    live_token(http, &[("client_id", LIVE_CLIENT_ID), ("code", code), ("grant_type", "authorization_code"), ("redirect_uri", LIVE_REDIRECT), ("scope", LIVE_SCOPE)]).await
}

async fn live_refresh(http: &Http, refresh: &str) -> Result<(String, String)> {
    live_token(http, &[("client_id", LIVE_CLIENT_ID), ("refresh_token", refresh), ("grant_type", "refresh_token"), ("redirect_uri", LIVE_REDIRECT), ("scope", LIVE_SCOPE)])
        .await
        .map_err(|_| AppError::msg("Microsoft oturumu sona erdi; hesabı yeniden ekle"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    #[serde(rename(deserialize = "device_code"))]
    pub device_code: String,
    #[serde(rename(deserialize = "user_code"))]
    pub user_code: String,
    #[serde(rename(deserialize = "verification_uri"))]
    pub verification_uri: String,
    #[serde(rename(deserialize = "expires_in"))]
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct TokenResp {
    access_token: Option<String>,
    refresh_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

pub enum Poll {
    Pending,
    SlowDown,
    Done { access: String, refresh: String },
}

pub async fn start(http: &Http, client_id: &str) -> Result<DeviceCode> {
    let resp = http.client.post(DEVICE_CODE).form(&[("client_id", client_id), ("scope", SCOPE)]).send().await?;
    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(format!("Microsoft girişi başlatılamadı: {}", t.chars().take(200).collect::<String>())));
    }
    Ok(resp.json().await?)
}

pub async fn poll(http: &Http, client_id: &str, device_code: &str) -> Result<Poll> {
    let r: TokenResp = http
        .client
        .post(TOKEN)
        .form(&[("client_id", client_id), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("device_code", device_code)])
        .send()
        .await?
        .json()
        .await?;
    match (r.access_token, r.refresh_token, r.error.as_deref()) {
        (Some(a), Some(rt), _) => Ok(Poll::Done { access: a, refresh: rt }),
        (_, _, Some("authorization_pending")) => Ok(Poll::Pending),
        (_, _, Some("slow_down")) => Ok(Poll::SlowDown),
        (_, _, Some("expired_token")) => Err(AppError::msg("Kodun süresi doldu, girişi yeniden başlat")),
        (_, _, Some("authorization_declined")) => Err(AppError::msg("Giriş reddedildi")),
        (_, _, e) => Err(AppError::msg(format!("Microsoft girişi başarısız: {}", r.error_description.or(e.map(String::from)).unwrap_or_default()))),
    }
}

async fn refresh_ms(http: &Http, client_id: &str, refresh: &str) -> Result<(String, String)> {
    let r: TokenResp = http
        .client
        .post(TOKEN)
        .form(&[("client_id", client_id), ("grant_type", "refresh_token"), ("refresh_token", refresh), ("scope", SCOPE)])
        .send()
        .await?
        .json()
        .await?;
    match (r.access_token, r.refresh_token) {
        (Some(a), Some(rt)) => Ok((a, rt)),
        _ => Err(AppError::msg("Microsoft oturumu sona erdi; hesabı yeniden ekle")),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSkin {
    pub id: String,
    pub state: String,
    pub url: String,
    #[serde(default)]
    pub variant: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cape {
    pub id: String,
    pub state: String,
    pub url: String,
    pub alias: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<ProfileSkin>,
    #[serde(default)]
    pub capes: Vec<Cape>,
}

/// MS erişim token'ından Minecraft token'ı + profil üretir.
async fn xbl_auth(http: &Http, ticket: String) -> Result<serde_json::Value> {
    Ok(http
        .client
        .post(XBL)
        .timeout(STEP_TIMEOUT)
        .json(&json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": ticket },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

/// Giriş adımları arayüze bildirilir ("Xbox Live'a bağlanılıyor…").
pub type Stage<'a> = &'a (dyn Fn(&'static str) + Send + Sync);

/// Tek bir istek en fazla bu kadar beklenir; aksi halde kullanıcı sonsuz yükleme görür.
const STEP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

async fn minecraft_chain(http: &Http, ms_access: &str, live: bool, stage: Stage<'_>) -> Result<(String, i64, Option<String>, Profile)> {
    stage("Xbox Live'a bağlanılıyor…");
    let (first, second) = if live { (ms_access.to_string(), format!("d={ms_access}")) } else { (format!("d={ms_access}"), ms_access.to_string()) };
    let xbl = match xbl_auth(http, first).await {
        Ok(v) => v,
        Err(_) => xbl_auth(http, second).await.map_err(|e| AppError::msg(format!("Xbox Live girişi başarısız: {e}")))?,
    };
    let xbl_token = xbl["Token"].as_str().ok_or_else(|| AppError::msg("Xbox Live token alınamadı"))?;
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or_default().to_string();

    stage("Xbox hesabı doğrulanıyor…");
    let resp = http
        .client
        .post(XSTS)
        .timeout(STEP_TIMEOUT)
        .json(&json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
            "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"
        }))
        .send()
        .await?;
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        let v: serde_json::Value = resp.json().await.unwrap_or_default();
        return Err(AppError::msg(match v["XErr"].as_u64() {
            Some(2148916233) => "Bu Microsoft hesabının bir Xbox profili yok. xbox.com'da bir profil oluşturup tekrar dene.",
            Some(2148916235) => "Xbox Live bu ülkede kullanılamıyor.",
            Some(2148916238) => "Bu bir çocuk hesabı; bir yetişkinin hesabı aile grubuna eklemesi gerekiyor.",
            _ => "Xbox Live yetkilendirmesi başarısız.",
        }));
    }
    let xsts: serde_json::Value = resp.error_for_status()?.json().await?;
    let xsts_token = xsts["Token"].as_str().ok_or_else(|| AppError::msg("XSTS token alınamadı"))?;
    let xuid = xsts["DisplayClaims"]["xui"][0]["xid"].as_str().map(String::from);

    stage("Minecraft'a giriş yapılıyor…");
    let resp = http.client.post(MC_LOGIN).timeout(STEP_TIMEOUT).json(&json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts_token}") })).send().await?;
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::msg("Minecraft Services bu uygulama kimliğini kabul etmedi. Azure uygulamasının Mojang tarafından onaylanmış olması gerekir."));
    }
    let mc: serde_json::Value = resp.error_for_status()?.json().await?;
    let token = mc["access_token"].as_str().ok_or_else(|| AppError::msg("Minecraft token alınamadı"))?.to_string();
    let expires = mc["expires_in"].as_i64().unwrap_or(86_400);

    stage("Minecraft profili alınıyor…");
    let resp = http.client.get(MC_PROFILE).timeout(STEP_TIMEOUT).bearer_auth(&token).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::msg("Bu Microsoft hesabında Minecraft: Java Edition yok."));
    }
    let profile: Profile = resp.error_for_status()?.json().await?;
    Ok((token, expires, xuid, profile))
}

pub async fn finish_login(http: &Http, ms_access: &str, ms_refresh: &str, live: bool, stage: Stage<'_>) -> Result<(Account, Profile)> {
    let (token, expires, xuid, profile) = minecraft_chain(http, ms_access, live, stage).await?;
    let acc = Account {
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        kind: AccountKind::Microsoft,
        skin_id: None,
        ms: Some(MsTokens { refresh_token: ms_refresh.into(), mc_access_token: token, mc_expires_at: Utc::now() + ChronoDuration::seconds(expires - 120), xuid, live }),
        added: Utc::now(),
    };
    Ok((acc, profile))
}

/// Minecraft token'ı süresi dolmak üzereyse refresh token ile yeniler (yerinde).
pub async fn ensure_fresh(http: &Http, client_id: &str, acc: &mut Account) -> Result<bool> {
    let Some(ms) = acc.ms.as_ref() else { return Ok(false) };
    if ms.mc_expires_at > Utc::now() + ChronoDuration::minutes(5) {
        return Ok(false);
    }
    let live = ms.live;
    let (access, refresh) = if live { live_refresh(http, &ms.refresh_token).await? } else { refresh_ms(http, client_id, &ms.refresh_token).await? };
    let (fresh, _) = finish_login(http, &access, &refresh, live, &|_| {}).await?;
    acc.username = fresh.username;
    acc.ms = fresh.ms;
    Ok(true)
}

pub async fn profile(http: &Http, token: &str) -> Result<Profile> {
    Ok(http.client.get(MC_PROFILE).bearer_auth(token).send().await?.error_for_status()?.json().await?)
}

/// Skin'i hesaba yükler (classic/slim).
pub async fn upload_skin(http: &Http, token: &str, png: Vec<u8>, slim: bool) -> Result<()> {
    let part = reqwest::multipart::Part::bytes(png).file_name("skin.png").mime_str("image/png").map_err(|e| AppError::msg(e.to_string()))?;
    let form = reqwest::multipart::Form::new().text("variant", if slim { "slim" } else { "classic" }).part("file", part);
    let resp = http.client.post(format!("{MC_PROFILE}/skins")).bearer_auth(token).multipart(form).send().await?;
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::msg("Mojang çok sık skin değişikliğine izin vermiyor; bir dakika sonra tekrar dene."));
    }
    if !resp.status().is_success() {
        let t = resp.text().await.unwrap_or_default();
        return Err(AppError::msg(format!("Skin yüklenemedi: {}", t.chars().take(200).collect::<String>())));
    }
    Ok(())
}

/// Sahip olunan bir pelerini etkinleştirir; None → pelerini gizler.
pub async fn set_cape(http: &Http, token: &str, cape_id: Option<&str>) -> Result<()> {
    let url = format!("{MC_PROFILE}/capes/active");
    let req = match cape_id {
        Some(id) => http.client.put(&url).bearer_auth(token).json(&json!({ "capeId": id })),
        None => http.client.delete(&url).bearer_auth(token),
    };
    req.send().await?.error_for_status()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn redirect_parsing() {
        assert!(code_from_redirect("https://login.live.com/ppsecure/post.srf").is_none());
        // URL kodlu karakterler çözülmeli (gerçek Microsoft kodlarında görülür)
        let enc = code_from_redirect("https://login.live.com/oauth20_desktop.srf?code=M.C540_BAY.2.U.ab%24cd%21ef-12&lc=1055").unwrap().unwrap();
        assert_eq!(enc, "M.C540_BAY.2.U.ab$cd!ef-12");
        let ok = code_from_redirect("https://login.live.com/oauth20_desktop.srf?code=M.C123_BAY.2.abc&lc=1033").unwrap().unwrap();
        assert_eq!(ok, "M.C123_BAY.2.abc");
        let cancel = code_from_redirect("https://login.live.com/oauth20_desktop.srf?error=access_denied&error_description=The+user+has+denied").unwrap();
        assert_eq!(cancel.unwrap_err().to_string(), LOGIN_CANCELLED);
        let err = code_from_redirect("https://login.live.com/oauth20_desktop.srf?error=server_error&error_description=Try+again").unwrap();
        assert!(err.unwrap_err().to_string().contains("Try again"));
        assert!(live_authorize_url().contains("redirect_uri=https%3A%2F%2Flogin.live.com%2Foauth20_desktop.srf"));
    }
}
