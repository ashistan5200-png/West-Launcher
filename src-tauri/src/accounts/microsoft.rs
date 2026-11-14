//! Microsoft → Xbox Live → XSTS → Minecraft kimlik zinciri (cihaz kodu akışı)
//! ve Minecraft Services profil/skin/pelerin uç noktaları.
//!
//! Not: api.minecraftservices.com yalnızca Mojang'ın onayladığı Azure uygulama
//! kimliklerini (client id) kabul eder. Kimlik Ayarlar'dan girilir.

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
async fn minecraft_chain(http: &Http, ms_access: &str) -> Result<(String, i64, Option<String>, Profile)> {
    let xbl: serde_json::Value = http
        .client
        .post(XBL)
        .json(&json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access}") },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"
        }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let xbl_token = xbl["Token"].as_str().ok_or_else(|| AppError::msg("Xbox Live token alınamadı"))?;
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().unwrap_or_default().to_string();

    let resp = http
        .client
        .post(XSTS)
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

    let resp = http.client.post(MC_LOGIN).json(&json!({ "identityToken": format!("XBL3.0 x={uhs};{xsts_token}") })).send().await?;
    if resp.status() == reqwest::StatusCode::FORBIDDEN {
        return Err(AppError::msg("Minecraft Services bu uygulama kimliğini kabul etmedi. Azure uygulamasının Mojang tarafından onaylanmış olması gerekir."));
    }
    let mc: serde_json::Value = resp.error_for_status()?.json().await?;
    let token = mc["access_token"].as_str().ok_or_else(|| AppError::msg("Minecraft token alınamadı"))?.to_string();
    let expires = mc["expires_in"].as_i64().unwrap_or(86_400);

    let resp = http.client.get(MC_PROFILE).bearer_auth(&token).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::msg("Bu Microsoft hesabında Minecraft: Java Edition yok."));
    }
    let profile: Profile = resp.error_for_status()?.json().await?;
    Ok((token, expires, xuid, profile))
}

pub async fn finish_login(http: &Http, ms_access: &str, ms_refresh: &str) -> Result<(Account, Profile)> {
    let (token, expires, xuid, profile) = minecraft_chain(http, ms_access).await?;
    let acc = Account {
        uuid: profile.id.clone(),
        username: profile.name.clone(),
        kind: AccountKind::Microsoft,
        skin_id: None,
        ms: Some(MsTokens { refresh_token: ms_refresh.into(), mc_access_token: token, mc_expires_at: Utc::now() + ChronoDuration::seconds(expires - 120), xuid }),
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
    let (access, refresh) = refresh_ms(http, client_id, &ms.refresh_token).await?;
    let (fresh, _) = finish_login(http, &access, &refresh).await?;
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
