//! API anahtarları ayarlardan ayrı bir dosyada tutulur ve **hiçbir zaman**
//! webview'a gönderilmez; UI yalnızca "anahtar var mı" bilgisini görür.

use crate::error::Result;
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Secrets {
    pub curseforge_api_key: Option<String>,
    /// İsteğe bağlı launcher kilidi — Argon2id PHC dizesi (şifrenin kendisi asla saklanmaz)
    pub launcher_password: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub curseforge: bool,
}

impl Secrets {
    pub fn path(root: &Path) -> PathBuf {
        root.join("secrets.json")
    }

    pub fn load(root: &Path) -> Self {
        std::fs::read(Self::path(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, root: &Path) -> Result<()> {
        let p = Self::path(root);
        write_json_atomic(&p, self)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn status(&self) -> SecretStatus {
        let has = |k: &Option<String>| k.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        SecretStatus { curseforge: has(&self.curseforge_api_key) }
    }
}

// ───────── Launcher kilidi ─────────

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

pub fn hash_password(pw: &str) -> Result<String> {
    if pw.chars().count() < 4 {
        return Err(crate::error::AppError::msg(crate::i18n::t("Şifre en az 4 karakter olmalı")));
    }
    // 16 baytlık kriptografik rastgele tuz (UUID v4 işletim sisteminin CSPRNG'sinden üretilir)
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(|e| crate::error::AppError::msg(e.to_string()))?;
    Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| crate::error::AppError::msg(e.to_string()))
}

pub fn verify_password(pw: &str, phc: &str) -> bool {
    PasswordHash::new(phc).map(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn password_roundtrip() {
        let h = hash_password("ashi1234").unwrap();
        assert!(h.starts_with("$argon2"));
        assert!(!h.contains("ashi1234"));
        assert!(verify_password("ashi1234", &h));
        assert!(!verify_password("yanlis", &h));
        assert!(hash_password("abc").is_err());
    }
}
