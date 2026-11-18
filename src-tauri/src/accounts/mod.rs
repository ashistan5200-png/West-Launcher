//! Çoklu hesap yöneticisi: Microsoft (OAuth cihaz kodu) ve offline hesaplar.
//! Token'lar `accounts.json`'da (Unix'te 0600) durur ve UI'a asla gönderilmez;
//! UI yalnızca `AccountView` görür.

pub mod microsoft;

use crate::core::auth::AuthSession;
use crate::error::{AppError, Result};
use crate::util::write_json_atomic;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Microsoft,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsTokens {
    pub refresh_token: String,
    pub mc_access_token: String,
    pub mc_expires_at: DateTime<Utc>,
    pub xuid: Option<String>,
    /// login.live.com ile doğrudan girişle mi alındı (yenileme yolu buna göre seçilir)
    #[serde(default)]
    pub live: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    /// Minecraft UUID (tiresiz) — hesabın kimliği
    pub uuid: String,
    pub username: String,
    pub kind: AccountKind,
    /// Skin arşivindeki etkin skin (offline hesaplar için launcher'da/oyun içi modda gösterilir)
    pub skin_id: Option<String>,
    #[serde(default)]
    pub ms: Option<MsTokens>,
    pub added: DateTime<Utc>,
}

/// UI'a giden, token içermeyen görünüm.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub uuid: String,
    pub username: String,
    pub kind: AccountKind,
    pub skin_id: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AccountStore {
    pub active: Option<String>,
    pub accounts: Vec<Account>,
}

impl AccountStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        write_json_atomic(path, self)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn views(&self) -> Vec<AccountView> {
        self.accounts
            .iter()
            .map(|a| AccountView {
                uuid: a.uuid.clone(),
                username: a.username.clone(),
                kind: a.kind,
                skin_id: a.skin_id.clone(),
                active: self.active.as_deref() == Some(&a.uuid),
            })
            .collect()
    }

    pub fn get_mut(&mut self, uuid: &str) -> Result<&mut Account> {
        self.accounts.iter_mut().find(|a| a.uuid == uuid).ok_or_else(|| AppError::NotFound("hesap".into()))
    }

    /// Aynı UUID varsa günceller (yeniden giriş), yoksa ekler; eklenen hesap etkin olur.
    pub fn upsert(&mut self, mut acc: Account) {
        if let Some(existing) = self.accounts.iter_mut().find(|a| a.uuid == acc.uuid) {
            acc.skin_id = acc.skin_id.or(existing.skin_id.take());
            acc.added = existing.added;
            *existing = acc.clone();
        } else {
            self.accounts.push(acc.clone());
        }
        self.active = Some(acc.uuid);
    }

    pub fn remove(&mut self, uuid: &str) {
        self.accounts.retain(|a| a.uuid != uuid);
        if self.active.as_deref() == Some(uuid) {
            self.active = self.accounts.first().map(|a| a.uuid.clone());
        }
    }

    pub fn active_account(&self) -> Option<&Account> {
        self.active.as_deref().and_then(|u| self.accounts.iter().find(|a| a.uuid == u))
    }
}

pub fn valid_username(name: &str) -> bool {
    (3..=16).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn offline_account(name: &str) -> Result<Account> {
    if !valid_username(name) {
        return Err(AppError::msg(crate::i18n::t("Kullanıcı adı 3–16 karakter olmalı; yalnızca harf, rakam ve _ içerebilir")));
    }
    let s = AuthSession::offline(name);
    Ok(Account { uuid: s.uuid, username: name.into(), kind: AccountKind::Offline, skin_id: None, ms: None, added: Utc::now() })
}

impl Account {
    /// Başlatma için oturum. Microsoft token'ı çağıran tarafından tazelenmiş olmalı.
    pub fn session(&self) -> AuthSession {
        match (&self.kind, &self.ms) {
            (AccountKind::Microsoft, Some(ms)) => AuthSession {
                username: self.username.clone(),
                uuid: self.uuid.clone(),
                access_token: ms.mc_access_token.clone(),
                user_type: "msa".into(),
                xuid: ms.xuid.clone(),
            },
            _ => AuthSession::offline(&self.username),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn usernames() {
        assert!(valid_username("Ashi_West"));
        assert!(!valid_username("ab"));
        assert!(!valid_username("çok-uzun-ve-geçersiz"));
    }
    #[test]
    fn upsert_and_remove_keep_active_consistent() {
        let mut s = AccountStore::default();
        s.upsert(offline_account("Alpha").unwrap());
        s.upsert(offline_account("Bravo").unwrap());
        assert_eq!(s.active_account().unwrap().username, "Bravo");
        let bravo = s.active.clone().unwrap();
        s.remove(&bravo);
        assert_eq!(s.active_account().unwrap().username, "Alpha");
        s.upsert(offline_account("Alpha").unwrap());
        assert_eq!(s.accounts.len(), 1);
    }
}
