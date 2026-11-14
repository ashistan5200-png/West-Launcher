//! Skin arşivi: `skins/<id>.png` + `skins/index.json`.
//! Bilgisayardan yükleme, oyuncu adından alma, favoriler, son kullanılanlar.

use crate::core::http::Http;
use crate::error::{AppError, Result};
use crate::util::write_json_atomic;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinEntry {
    pub id: String,
    pub name: String,
    pub slim: bool,
    pub favorite: bool,
    pub added: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    /// "file" | "player:<ad>" | "account"
    pub origin: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinWithData {
    #[serde(flatten)]
    pub entry: SkinEntry,
    pub data_url: String,
}

pub struct Library {
    dir: PathBuf,
}

/// PNG başlığından boyut okur ve Minecraft skin biçimini doğrular (64×64 veya eski 64×32).
pub fn validate_png(bytes: &[u8]) -> Result<(u32, u32)> {
    const SIG: &[u8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 24 || &bytes[..8] != SIG || &bytes[12..16] != b"IHDR" {
        return Err(AppError::msg("Dosya geçerli bir PNG değil"));
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if !(w == 64 && (h == 64 || h == 32)) {
        return Err(AppError::msg(format!("Skin 64×64 (veya eski 64×32) olmalı; bu dosya {w}×{h}")));
    }
    if bytes.len() > 256 * 1024 {
        return Err(AppError::msg("Skin dosyası çok büyük"));
    }
    Ok((w, h))
}

impl Library {
    pub fn new(root: &Path) -> Self {
        Self { dir: root.join("skins") }
    }

    fn index_path(&self) -> PathBuf {
        self.dir.join("index.json")
    }

    pub fn png_path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.png"))
    }

    pub fn list(&self) -> Vec<SkinEntry> {
        let mut v: Vec<SkinEntry> = std::fs::read(self.index_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        // Favoriler önce, sonra en son kullanılan / eklenen
        v.sort_by(|a, b| b.favorite.cmp(&a.favorite).then(b.last_used.unwrap_or(b.added).cmp(&a.last_used.unwrap_or(a.added))));
        v
    }

    fn save(&self, items: &[SkinEntry]) -> Result<()> {
        write_json_atomic(&self.index_path(), items)
    }

    pub fn read(&self, id: &str) -> Result<Vec<u8>> {
        if id.contains(['/', '\\', '.']) {
            return Err(AppError::msg("geçersiz skin kimliği"));
        }
        std::fs::read(self.png_path(id)).map_err(|_| AppError::NotFound("skin dosyası".into()))
    }

    pub fn data_url(&self, id: &str) -> Result<String> {
        Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(self.read(id)?)))
    }

    pub fn with_data(&self, e: SkinEntry) -> Option<SkinWithData> {
        Some(SkinWithData { data_url: self.data_url(&e.id).ok()?, entry: e })
    }

    /// Aynı PNG zaten arşivdeyse mevcut kaydı döndürür (içerik hash'i = kimlik).
    pub fn add(&self, bytes: &[u8], name: &str, slim: bool, origin: &str) -> Result<SkinEntry> {
        validate_png(bytes)?;
        std::fs::create_dir_all(&self.dir)?;
        let id = hex::encode(Sha1::digest(bytes))[..16].to_string();
        let mut items = self.list();
        if let Some(e) = items.iter().find(|e| e.id == id) {
            return Ok(e.clone());
        }
        std::fs::write(self.png_path(&id), bytes)?;
        let e = SkinEntry { id, name: name.chars().take(40).collect(), slim, favorite: false, added: Utc::now(), last_used: None, origin: origin.into() };
        items.push(e.clone());
        self.save(&items)?;
        Ok(e)
    }

    pub fn update(&self, id: &str, name: Option<String>, slim: Option<bool>, favorite: Option<bool>, used: bool) -> Result<SkinEntry> {
        let mut items = self.list();
        let e = items.iter_mut().find(|e| e.id == id).ok_or_else(|| AppError::NotFound("skin".into()))?;
        if let Some(n) = name.filter(|n| !n.trim().is_empty()) {
            e.name = n.trim().chars().take(40).collect();
        }
        if let Some(s) = slim {
            e.slim = s;
        }
        if let Some(f) = favorite {
            e.favorite = f;
        }
        if used {
            e.last_used = Some(Utc::now());
        }
        let out = e.clone();
        self.save(&items)?;
        Ok(out)
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let mut items = self.list();
        items.retain(|e| e.id != id);
        self.save(&items)?;
        let _ = std::fs::remove_file(self.png_path(id));
        Ok(())
    }
}

/// Bir oyuncunun güncel skinini Mojang'dan çeker → (png, slim).
pub async fn fetch_player_skin(http: &Http, name: &str) -> Result<(Vec<u8>, bool)> {
    let resp = http.client.get(format!("https://api.mojang.com/users/profiles/minecraft/{name}")).send().await?;
    if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::msg("Mojang şu an çok fazla istek alıyor; birkaç saniye sonra tekrar dene."));
    }
    if resp.status() == reqwest::StatusCode::NOT_FOUND || resp.status() == reqwest::StatusCode::NO_CONTENT {
        return Err(AppError::NotFound(format!("\"{name}\" adında bir Minecraft oyuncusu")));
    }
    let profile: serde_json::Value = resp.error_for_status()?.json().await?;
    let uuid = profile["id"].as_str().ok_or_else(|| AppError::NotFound(name.into()))?;
    fetch_uuid_skin(http, uuid).await
}

pub async fn fetch_uuid_skin(http: &Http, uuid: &str) -> Result<(Vec<u8>, bool)> {
    let session: serde_json::Value = http.json(&format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}")).await?;
    let b64 = session["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["name"] == "textures"))
        .and_then(|p| p["value"].as_str())
        .ok_or_else(|| AppError::msg("textures özelliği yok"))?;
    let textures: serde_json::Value = serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| AppError::msg(e.to_string()))?)?;
    let skin = &textures["textures"]["SKIN"];
    let url = skin["url"].as_str().ok_or_else(|| AppError::msg("Bu oyuncunun özel bir skini yok (varsayılan Steve/Alex)"))?.replacen("http://", "https://", 1);
    let slim = skin["metadata"]["model"].as_str() == Some("slim");
    let png = http.client.get(&url).send().await?.error_for_status()?.bytes().await?.to_vec();
    Ok((png, slim))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        v.extend(w.to_be_bytes());
        v.extend(h.to_be_bytes());
        v.extend([8, 6, 0, 0, 0]);
        v
    }
    #[test]
    fn validates_dimensions() {
        assert!(validate_png(&png(64, 64)).is_ok());
        assert!(validate_png(&png(64, 32)).is_ok());
        assert!(validate_png(&png(128, 128)).is_err());
        assert!(validate_png(b"not a png at all, definitely").is_err());
    }
    #[test]
    fn dedupes_and_orders_favorites_first() {
        let dir = std::env::temp_dir().join(format!("skins-{}", uuid::Uuid::new_v4()));
        let lib = Library::new(&dir);
        let a = lib.add(&png(64, 64), "A", false, "file").unwrap();
        let again = lib.add(&png(64, 64), "A2", true, "file").unwrap();
        assert_eq!(a.id, again.id);
        let b = lib.add(&png(64, 32), "B", false, "file").unwrap();
        lib.update(&a.id, None, None, Some(true), false).unwrap();
        assert_eq!(lib.list()[0].id, a.id);
        lib.remove(&b.id).unwrap();
        assert_eq!(lib.list().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
