//! API anahtarları ayarlardan ayrı bir dosyada tutulur ve **hiçbir zaman**
//! webview'a gönderilmez; UI yalnızca "anahtar var mı" bilgisini görür.

use crate::error::Result;
use crate::util::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Secrets {
    pub anthropic_api_key: Option<String>,
    pub curseforge_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub anthropic: bool,
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
        SecretStatus { anthropic: has(&self.anthropic_api_key), curseforge: has(&self.curseforge_api_key) }
    }
}
