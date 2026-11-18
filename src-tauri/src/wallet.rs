//! West Coin cüzdanı ve mağaza.
//!
//! Oyunda geçirilen her saat 100 West Coin kazandırır (West Plus'ta 150). Coin'ler yalnızca görünüm
//! öğelerine (tema, arka plan, imleç izi, oyun içi menü teması, pelerin ve aksesuarlar) ve West Plus'a
//! harcanır. Hiçbiri oyunda avantaj sağlamaz.
//!
//! Cüzdan West hesabına bağlı olarak Supabase'de tutulur (supabase/wallet.sql). Bakiye, sahip olunan ve
//! kuşanılan öğeler yalnızca sunucudaki fonksiyonlarla değişir; fiyatlar da sunucudaki listeden okunur.
//! Buradaki katalog yalnızca mağaza ekranını çizmek içindir (sunucudakiyle aynı listeden üretilir).
//! Sunucuya ulaşılamazsa son bilinen cüzdan yerel bir önbellekten gösterilir; değişiklik yapılamaz.

use crate::error::{AppError, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use crate::core::http::Http;
use std::path::{Path, PathBuf};

/// Saat başına coin
pub const COINS_PER_HOUR: u64 = 100;
/// West Plus'ta kazanç çarpanı (%)
pub const PLUS_BONUS_PCT: u64 = 150;
/// İlk açılış hediyesi
pub const WELCOME_BONUS: u64 = 300;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Plus,
    Theme,
    Sky,
    Trail,
    MenuTheme,
    Cape,
    Hat,
    Back,
    Aura,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: &'static str,
    pub kind: Kind,
    /// West Coin fiyatı (0 = ücretsiz / herkese açık)
    pub price: u64,
    /// Yalnızca West Plus sahipleri kullanabilir (Plus sürdükçe, ayrıca satın almadan)
    pub plus_only: bool,
    /// West Plus için: kaç gün
    pub days: u32,
}

const fn it(id: &'static str, kind: Kind, price: u64) -> Item {
    Item { id, kind, price, plus_only: false, days: 0 }
}
const fn plus(id: &'static str, kind: Kind) -> Item {
    Item { id, kind, price: 0, plus_only: true, days: 0 }
}
const fn sub(id: &'static str, price: u64, days: u32) -> Item {
    Item { id, kind: Kind::Plus, price, plus_only: false, days }
}

/// Mağazadaki her şey. Fiyat ölçeği: 100 coin ≈ 1 saat oyun.
pub const CATALOG: &[Item] = &[
    // West Plus
    sub("plus_30", 2500, 30),
    sub("plus_90", 6500, 90),
    sub("plus_365", 22000, 365),
    // Launcher temaları
    it("theme_ocean", Kind::Theme, 600),
    it("theme_forest", Kind::Theme, 600),
    it("theme_rose", Kind::Theme, 600),
    it("theme_mono", Kind::Theme, 500),
    it("theme_nether", Kind::Theme, 900),
    it("theme_end", Kind::Theme, 900),
    plus("theme_gold", Kind::Theme),
    plus("theme_aurora", Kind::Theme),
    // Arka plan sahneleri (ana sayfa ve launcher arka planı)
    it("sky_dawn", Kind::Sky, 400),
    it("sky_night", Kind::Sky, 400),
    it("sky_snow", Kind::Sky, 500),
    it("sky_sakura", Kind::Sky, 700),
    it("sky_nether", Kind::Sky, 700),
    it("sky_end", Kind::Sky, 700),
    plus("sky_aurora", Kind::Sky),
    // İmleç izleri
    it("trail_stars", Kind::Trail, 300),
    it("trail_snow", Kind::Trail, 300),
    it("trail_fire", Kind::Trail, 400),
    it("trail_hearts", Kind::Trail, 400),
    plus("trail_rainbow", Kind::Trail),
    // Oyun içi West menü temaları
    it("menu_ocean", Kind::MenuTheme, 500),
    it("menu_forest", Kind::MenuTheme, 500),
    it("menu_nether", Kind::MenuTheme, 700),
    it("menu_end", Kind::MenuTheme, 700),
    plus("menu_gold", Kind::MenuTheme),
    // Pelerinler (oyunda)
    it("cape_west", Kind::Cape, 0),
    it("cape_sunset", Kind::Cape, 1200),
    it("cape_ocean", Kind::Cape, 1200),
    it("cape_forest", Kind::Cape, 1200),
    it("cape_sakura", Kind::Cape, 1500),
    it("cape_nether", Kind::Cape, 1500),
    it("cape_end", Kind::Cape, 1500),
    plus("cape_plus", Kind::Cape),
    // Şapkalar (oyunda)
    it("hat_cap", Kind::Hat, 1000),
    it("hat_catears", Kind::Hat, 1200),
    it("hat_tophat", Kind::Hat, 1500),
    it("hat_wizard", Kind::Hat, 1800),
    it("hat_crown", Kind::Hat, 2500),
    plus("hat_halo", Kind::Hat),
    // Sırt (oyunda)
    it("back_bag", Kind::Back, 1200),
    it("back_wings", Kind::Back, 3000),
    it("back_dragon", Kind::Back, 3500),
    plus("back_plus_wings", Kind::Back),
    // Aura / parçacıklar (oyunda)
    it("aura_hearts", Kind::Aura, 800),
    it("aura_notes", Kind::Aura, 800),
    it("aura_flame", Kind::Aura, 1000),
    plus("aura_stars", Kind::Aura),
];

/// Oyunda takılan yuvalar (Gardırop)
pub const GAME_SLOTS: &[&str] = &["cape", "hat", "back", "aura", "menuTheme"];

/// Bir öğenin yuvası
pub fn slot_of(id: &str) -> &'static str {
    match id.split('_').next().unwrap_or("") {
        "cape" => "cape",
        "hat" => "hat",
        "back" => "back",
        "aura" => "aura",
        "menu" => "menuTheme",
        "theme" => "theme",
        "sky" => "sky",
        "trail" => "trail",
        _ => "",
    }
}

pub fn item(id: &str) -> Option<&'static Item> {
    CATALOG.iter().find(|i| i.id == id)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: DateTime<Utc>,
    /// Pozitif: kazanç, negatif: harcama
    pub amount: i64,
    pub reason: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Wallet {
    pub coins: u64,
    /// Coin'e dönüşmemiş artan saniyeler (36 sn = 1 coin)
    pub carry_secs: u64,
    pub earned_total: u64,
    pub owned: Vec<String>,
    pub plus_until: Option<DateTime<Utc>>,
    /// Kuşanılan öğeler: yuva → öğe kimliği
    pub equipped: std::collections::BTreeMap<String, String>,
    pub history: Vec<HistoryEntry>,
    /// Bilgisayardaki eski cüzdan hesaba aktarıldı mı
    pub imported: bool,
}

impl Wallet {
    pub fn plus_active(&self) -> bool {
        self.plus_until.map(|u| u > Utc::now()).unwrap_or(false)
    }

    /// Bu öğeyi kullanabilir mi? (sahip, ücretsiz ya da Plus'a özel ve Plus açık)
    pub fn can_use(&self, it: &Item) -> bool {
        it.price == 0 && !it.plus_only || self.owned.iter().any(|o| o == it.id) || it.plus_only && self.plus_active()
    }
}

/// Sunucudan dönen cüzdan (+ isteğe bağlı "earned")
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ServerWallet {
    coins: i64,
    carry_secs: i64,
    earned_total: i64,
    owned: Vec<String>,
    plus_until: Option<DateTime<Utc>>,
    equipped: std::collections::BTreeMap<String, String>,
    history: Vec<HistoryEntry>,
    imported: bool,
    earned: i64,
}

fn from_server(v: serde_json::Value) -> Result<(Wallet, u64)> {
    let s: ServerWallet = serde_json::from_value(v)?;
    let w = Wallet {
        coins: s.coins.max(0) as u64,
        carry_secs: s.carry_secs.max(0) as u64,
        earned_total: s.earned_total.max(0) as u64,
        owned: s.owned,
        plus_until: s.plus_until,
        equipped: s.equipped,
        history: s.history,
        imported: s.imported,
    };
    Ok((w, s.earned.max(0) as u64))
}

fn cache_file(root: &Path) -> PathBuf {
    root.join("wallet-cache.json")
}

/// Eski (yalnızca bu bilgisayarda tutulan) cüzdan dosyası
fn legacy_file(root: &Path) -> PathBuf {
    root.join("wallet.json")
}

/// Son bilinen cüzdan (sunucuya ulaşılamazken gösterim ve oyun içi görünüm için)
pub fn cached(root: &Path) -> Option<Wallet> {
    std::fs::read(cache_file(root)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn remember(root: &Path, w: &Wallet) {
    let _ = crate::util::write_json_atomic(&cache_file(root), w);
}

/// Sunucu hata metnini kullanıcıya anlaşılır hale getir
fn friendly(e: AppError) -> AppError {
    let s = e.to_string();
    if s.contains("login") || s.contains("giriş yapmalısın") || s.contains("JWT") {
        return AppError::msg("West Coin için West hesabına giriş yap");
    }
    // PostgREST hata gövdesinden "message" alanı
    if let Some(i) = s.find("\"message\":\"") {
        let rest = &s[i + 11..];
        if let Some(j) = rest.find('"') {
            return AppError::msg(rest[..j].to_string());
        }
    }
    e
}

async fn rpc(http: &Http, root: &Path, name: &str, body: serde_json::Value) -> Result<(Wallet, u64)> {
    let v = crate::cloud::api(http, root, "POST", &format!("/rest/v1/rpc/{name}"), &[], Some(body), None).await.map_err(friendly)?;
    let (w, earned) = from_server(v)?;
    remember(root, &w);
    Ok((w, earned))
}

/// Cüzdanı getir. İlk kez giriş yapılan bilgisayarda eski yerel cüzdan bir kez hesaba aktarılır.
pub async fn get(http: &Http, root: &Path) -> Result<Wallet> {
    let (w, _) = rpc(http, root, "wallet_get", serde_json::json!({})).await?;
    let legacy = legacy_file(root);
    if !w.imported && legacy.is_file() {
        if let Some(old) = std::fs::read(&legacy).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) {
            let body = serde_json::json!({
                "p_coins": old["coins"].as_i64().unwrap_or(0).saturating_sub(WELCOME_BONUS as i64).max(0),
                "p_owned": old["owned"].clone(),
                "p_plus_until": old["plusUntil"].clone(),
                "p_equipped": old["equipped"].clone(),
            });
            if let Ok((w2, _)) = rpc(http, root, "wallet_import", body).await {
                let _ = std::fs::rename(&legacy, root.join("wallet.json.aktarildi"));
                return Ok(w2);
            }
        }
    }
    Ok(w)
}

pub async fn buy(http: &Http, root: &Path, id: &str) -> Result<Wallet> {
    rpc(http, root, "wallet_buy", serde_json::json!({ "p_item": id })).await.map(|x| x.0)
}

pub async fn equip(http: &Http, root: &Path, slot: &str, id: Option<&str>) -> Result<Wallet> {
    rpc(http, root, "wallet_equip", serde_json::json!({ "p_slot": slot, "p_item": id })).await.map(|x| x.0)
}

/// Oyun açıldı: sunucu süreyi buradan ölçmeye başlar
pub async fn session_start(http: &Http, root: &Path) {
    if let Err(e) = rpc(http, root, "wallet_session_start", serde_json::json!({})).await {
        tracing::info!("West Coin oturumu başlatılamadı: {e}");
    }
}

/// Oyun kapandı: oynanan süre kadar coin. Sunucu, oturum başından beri geçen süreden fazlasını saymaz.
pub async fn earn(http: &Http, root: &Path, secs: u64) -> Result<u64> {
    rpc(http, root, "wallet_earn", serde_json::json!({ "p_secs": secs.min(i32::MAX as u64) })).await.map(|x| x.1)
}

/// Oyunda Gardırop'ta yapılan seçimleri hesaba yaz (yalnızca değişen oyun içi yuvalar)
pub async fn sync_from_game(http: &Http, root: &Path, chosen: &std::collections::BTreeMap<String, String>) -> Result<()> {
    let Some(w) = cached(root) else { return Ok(()) };
    for slot in GAME_SLOTS {
        let want = chosen.get(*slot);
        if w.equipped.get(*slot) != want {
            // Sunucu sahip olunmayan ya da yanlış yuvadaki öğeyi reddeder
            let _ = equip(http, root, slot, want.map(String::as_str)).await;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_json_maps() {
        let v = serde_json::json!({
            "coins": 4250, "earnedTotal": 6800, "carrySecs": 20, "plus": true,
            "plusUntil": "2030-01-01T00:00:00Z", "owned": ["cape_sakura"], "equipped": {"cape": "cape_sakura"},
            "imported": true, "history": [{"at": "2026-11-18T10:00:00Z", "amount": 100, "reason": "play"}], "earned": 150
        });
        let (w, earned) = from_server(v).unwrap();
        assert_eq!((w.coins, earned), (4250, 150));
        assert!(w.plus_active() && w.imported);
        assert!(w.can_use(item("cape_sakura").unwrap()));
        assert!(w.can_use(item("hat_halo").unwrap())); // Plus'a özel, Plus açık
        assert!(!w.can_use(item("hat_crown").unwrap()));
        assert_eq!(slot_of("menu_end"), "menuTheme");
    }

    #[test]
    fn friendly_errors() {
        let e = friendly(AppError::msg(r#"400: {"code":"P0001","message":"Yeterli West Coin yok (2500 gerekiyor)"}"#));
        assert_eq!(e.to_string(), "Yeterli West Coin yok (2500 gerekiyor)");
        assert_eq!(friendly(AppError::msg("Bunun için West hesabına giriş yapmalısın.")).to_string(), "West Coin için West hesabına giriş yap");
    }
}
