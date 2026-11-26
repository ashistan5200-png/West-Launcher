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

/// Erişilebilirlik / performans. Performans modu ana anahtardır; altındaki seçenekler tek tek de açılıp kapatılabilir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Accessibility {
    /// Zayıf bilgisayarlar için: sade West ana menüsü ve aşağıdaki hafifletmeler
    pub performance_mode: bool,
    /// Oyunda West ana menüsü, duraklatma menüsü ve West görünümlü Minecraft ekranları
    pub west_menus: bool,
    /// Oyun içi West HUD öğeleri (FPS, tuşlar, koordinatlar …)
    pub west_hud: bool,
    /// Oyun içi menü animasyonları
    pub game_animations: bool,
    /// Oyunda pürüzsüz yazı tipi
    pub smooth_font: bool,
    /// Oyna'ya basınca uyumlu optimizasyon modlarını kur (Sodium, Lithium, FerriteCore …)
    pub perf_mods: bool,
    /// Oyunun grafik ayarlarını hafiflet (parçacık, bulut, gölge, görüş mesafesi)
    pub low_graphics: bool,
    /// Launcher'da bulanıklık, saydamlık ve geçiş animasyonları
    pub launcher_effects: bool,
}

impl Default for Accessibility {
    fn default() -> Self {
        Self {
            performance_mode: false,
            west_menus: true,
            west_hud: true,
            game_animations: true,
            smooth_font: true,
            perf_mods: false,
            low_graphics: false,
            launcher_effects: true,
        }
    }
}

/// Tüm instance'lar için oyun varsayılanları (instance'ın kendi ayarı varsa o geçerli)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GameDefaults {
    /// Oyun penceresinin boyutu (genişlik, yükseklik); None → Minecraft'ın varsayılanı
    pub resolution: Option<(u32, u32)>,
    /// Oyunu tam ekran başlat
    pub fullscreen: bool,
    /// Her instance'a eklenen JVM argümanları (instance'ınkilerden önce)
    pub jvm_args: Vec<String>,
    /// Oyun başlamadan çalışan komut; hata dönerse oyun açılmaz
    pub pre_launch: String,
    /// Oyun kapandıktan sonra çalışan komut
    pub post_exit: String,
    /// Java'yı saran komut (ör. "gamemoderun", "prime-run", "mangohud")
    pub wrapper: String,
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
    /// Oyun açılınca launcher: "keep" (açık kalsın) | "minimize" (küçült) | "hide" (gizle, oyun kapanınca geri gelsin)
    pub launch_behavior: String,
    /// Açılışta gösterilen sayfa: "/" | "/library" | "/browse" (eski "/social" ana sayfaya düşer)
    pub start_page: String,
    pub game: GameDefaults,
    /// Mojang onaylı Azure uygulama kimliği (Microsoft girişi için)
    pub microsoft_client_id: Option<String>,
    /// Ashi'nin yapay zekası: "ollama" (ücretsiz, yerel) | "off" (anahtar kelime modu)
    pub ai_provider: String,
    pub ollama_url: String,
    pub ollama_model: String,
    /// Claude modunda kullanılan model
    pub claude_model: String,
    /// İlk açılış turu (Ashi) ve aktarım sihirbazı tamamlandı mı
    pub onboarding_done: bool,
    /// Uyumlu instance'lara West Companion oyun içi modunu kur
    pub companion_enabled: bool,
    /// Discord Rich Presence (Discord Developer Portal'daki uygulama kimliği gerekir)
    pub discord_rpc: bool,
    pub discord_client_id: Option<String>,
    /// Yeni sürüm bulununca arka planda indir (kurulum yine kullanıcı onayıyla)
    pub auto_update: bool,
    /// West arka plan müziği (launcher'da ve oyunun menülerinde)
    pub music: bool,
    /// Müzik oyunun içinde de çalsın (Minecraft'ın kendi müziğinin yerine)
    pub music_in_game: bool,
    /// Arayüz dili: "tr" | "en" | "de". Boş → ilk açılışta sistem dilinden seçilir.
    /// Eski ayar dosyalarında alan yoksa Türkçe kalır.
    #[serde(default = "legacy_language")]
    pub language: String,
    pub accessibility: Accessibility,
}

fn legacy_language() -> String {
    "tr".into()
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
            launch_behavior: "minimize".into(),
            start_page: "/".into(),
            game: GameDefaults::default(),
            microsoft_client_id: None,
            ai_provider: "ollama".into(),
            ollama_url: crate::assistant::ollama::DEFAULT_URL.into(),
            ollama_model: crate::assistant::ollama::DEFAULT_MODEL.into(),
            claude_model: crate::assistant::claude::DEFAULT_MODEL.into(),
            onboarding_done: false,
            companion_enabled: true,
            discord_rpc: true,
            discord_client_id: None,
            auto_update: true,
            music: true,
            music_in_game: true,
            language: String::new(),
            accessibility: Accessibility::default(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Self>(&b).ok())
            .map(|mut s| {
                // Bilinmeyen sağlayıcı → yerel model (yoksa anahtar kelime moduna düşer)
                if !["off", "ollama", "claude"].contains(&s.ai_provider.as_str()) {
                    s.ai_provider = "ollama".into();
                }
                if s.claude_model.trim().is_empty() {
                    s.claude_model = crate::assistant::claude::DEFAULT_MODEL.into();
                }
                // Eski "oyun açılınca küçült" anahtarı yeni davranış seçimine taşınır
                if s.close_on_launch && (s.launch_behavior.is_empty() || s.launch_behavior == "keep") {
                    s.launch_behavior = "minimize".into();
                    s.close_on_launch = false;
                }
                if !["keep", "minimize", "hide"].contains(&s.launch_behavior.as_str()) {
                    s.launch_behavior = "keep".into();
                }
                s
            })
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        crate::util::write_json_atomic(path, self)
    }
}
