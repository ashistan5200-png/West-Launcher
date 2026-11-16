use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeSettings {
    /// Hex vurgu rengi (mat buz mavisi varsayılan), örn. "#7fa7c9"
    pub accent: String,
    /// 0–40 px arası arka plan bulanıklığı (CSS backdrop-filter)
    pub blur: u8,
    /// Pencere saydamlığı 0.6–1.0
    pub opacity: f32,
    /// "mica" | "acrylic" | "none" — native pencere efekti
    pub window_effect: String,
    /// "compact" | "comfortable"
    pub density: String,
    pub reduce_motion: bool,
    /// Fare imlecinin arkasında, altındaki rengi alan piksel parçacıklar
    pub cursor_trail: bool,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            accent: "#e8a25c".into(),
            blur: 12,
            opacity: 0.94,
            window_effect: "mica".into(),
            density: "compact".into(),
            reduce_motion: false,
            cursor_trail: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: ThemeSettings,
    /// Genel varsayılan bellek (MB). None → donanıma göre otomatik.
    pub default_memory_mb: Option<u32>,
    pub auto_java: bool,
    pub max_concurrent_downloads: usize,
    pub backup_on_exit: bool,
    pub backup_dir: Option<String>,
    pub backup_keep: usize,
    pub close_on_launch: bool,
    /// Mojang onaylı Azure uygulama kimliği (Microsoft girişi için)
    pub microsoft_client_id: Option<String>,
    /// Ashi'nin yapay zekası: "ollama" (ücretsiz, yerel) | "off" (anahtar kelime modu)
    pub ai_provider: String,
    pub ollama_url: String,
    pub ollama_model: String,
    /// İlk açılış turu (Ashi) ve aktarım sihirbazı tamamlandı mı
    pub onboarding_done: bool,
    /// Uyumlu instance'lara West Companion oyun içi modunu kur
    pub companion_enabled: bool,
    /// Discord Rich Presence (Discord Developer Portal'daki uygulama kimliği gerekir)
    pub discord_rpc: bool,
    pub discord_client_id: Option<String>,
    /// Yeni sürüm bulununca arka planda indir (kurulum yine kullanıcı onayıyla)
    pub auto_update: bool,
    /// West Overlay: oyun açıkken kısayolla oyunun üstünde açılan West Client paneli
    pub overlay_enabled: bool,
    /// Overlay kısayolu (ör. "F7")
    pub overlay_hotkey: String,
    /// Overlay teması: "night" | "day" | "pixel-night" | "pixel-day"
    pub overlay_theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: ThemeSettings::default(),
            default_memory_mb: None,
            auto_java: true,
            max_concurrent_downloads: 24,
            backup_on_exit: true,
            backup_dir: None,
            backup_keep: 10,
            close_on_launch: false,
            microsoft_client_id: None,
            ai_provider: "ollama".into(),
            ollama_url: crate::assistant::ollama::DEFAULT_URL.into(),
            ollama_model: crate::assistant::ollama::DEFAULT_MODEL.into(),
            onboarding_done: false,
            companion_enabled: true,
            discord_rpc: true,
            discord_client_id: None,
            auto_update: true,
            overlay_enabled: true,
            overlay_hotkey: "F7".into(),
            overlay_theme: "night".into(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Self>(&b).ok())
            .map(|mut s| {
                // Claude seçeneği kaldırıldı → yerel modele geç (yoksa anahtar kelime moduna düşer)
                if s.ai_provider != "off" {
                    s.ai_provider = "ollama".into();
                }
                s
            })
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        crate::util::write_json_atomic(path, self)
    }
}
