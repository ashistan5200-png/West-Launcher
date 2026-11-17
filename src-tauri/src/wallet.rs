//! West Coin cüzdanı ve mağaza.
//!
//! Oyunda geçirilen her saat 100 West Coin kazandırır (West Plus'ta 150). Coin'ler yalnızca görünüm
//! öğelerine (tema, arka plan, imleç izi, oyun içi menü teması, pelerin ve aksesuarlar) ve West Plus'a
//! harcanır. Hiçbiri oyunda avantaj sağlamaz. Cüzdan bu bilgisayarda tutulur; sunucu gerekmez.
//!
//! Fiyatlar ve hangi öğenin West Plus'a özel olduğu burada, tek yerde tanımlıdır.

use crate::error::{AppError, Result};
use chrono::{DateTime, Duration, Utc};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
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
    /// Kuşanılan öğeler: tür → öğe kimliği
    pub equipped: std::collections::BTreeMap<String, String>,
    pub history: Vec<HistoryEntry>,
    pub welcomed: bool,
}

impl Wallet {
    pub fn plus_active(&self) -> bool {
        self.plus_until.map(|u| u > Utc::now()).unwrap_or(false)
    }

    /// Bu öğeyi kullanabilir mi? (sahip, ücretsiz ya da Plus'a özel ve Plus açık)
    pub fn can_use(&self, it: &Item) -> bool {
        it.price == 0 && !it.plus_only || self.owned.iter().any(|o| o == it.id) || it.plus_only && self.plus_active()
    }

    fn log(&mut self, amount: i64, reason: impl Into<String>) {
        self.history.push(HistoryEntry { at: Utc::now(), amount, reason: reason.into() });
        let n = self.history.len();
        if n > 60 {
            self.history.drain(0..n - 60);
        }
    }

    /// Süresi biten Plus öğelerini çıkar
    fn drop_expired(&mut self) {
        let ids: Vec<(String, String)> = self.equipped.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
        for (k, v) in ids {
            if let Some(it) = item(&v) {
                if !self.can_use(it) {
                    self.equipped.remove(&k);
                }
            }
        }
    }
}

static LOCK: Mutex<()> = Mutex::new(());

fn file(root: &Path) -> PathBuf {
    root.join("wallet.json")
}

pub fn load(root: &Path) -> Wallet {
    let mut w: Wallet = std::fs::read(file(root)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if !w.welcomed {
        w.welcomed = true;
        w.coins += WELCOME_BONUS;
        w.earned_total += WELCOME_BONUS;
        w.log(WELCOME_BONUS as i64, "welcome");
        let _ = crate::util::write_json_atomic(&file(root), &w);
    }
    w.drop_expired();
    w
}

fn save(root: &Path, w: &Wallet) -> Result<()> {
    crate::util::write_json_atomic(&file(root), w)
}

/// Oyun oturumu bitti: süreye göre coin ekle. Kazanılan coin sayısını döner.
pub fn earn(root: &Path, secs: u64) -> Result<u64> {
    let _g = LOCK.lock();
    let mut w = load(root);
    let rate = if w.plus_active() { COINS_PER_HOUR * PLUS_BONUS_PCT / 100 } else { COINS_PER_HOUR };
    // Bir oturumda en fazla 12 saat sayılır (açık unutulan oyun)
    let total = w.carry_secs + secs.min(12 * 3600);
    let coins = total * rate / 3600;
    w.carry_secs = total - coins * 3600 / rate;
    if coins > 0 {
        w.coins += coins;
        w.earned_total += coins;
        w.log(coins as i64, "play");
    }
    save(root, &w)?;
    Ok(coins)
}

pub fn buy(root: &Path, id: &str) -> Result<Wallet> {
    let _g = LOCK.lock();
    let mut w = load(root);
    let it = item(id).ok_or_else(|| AppError::msg("Böyle bir öğe yok"))?;
    if it.plus_only {
        return Err(AppError::msg("Bu öğe West Plus'a özel; West Plus açıkken ücretsiz kullanılır"));
    }
    if it.kind != Kind::Plus && w.owned.iter().any(|o| o == id) {
        return Err(AppError::msg("Bu öğe zaten sende"));
    }
    if w.coins < it.price {
        return Err(AppError::msg(format!("Yeterli West Coin yok ({} gerekiyor)", it.price)));
    }
    w.coins -= it.price;
    if it.kind == Kind::Plus {
        let from = w.plus_until.filter(|u| *u > Utc::now()).unwrap_or_else(Utc::now);
        w.plus_until = Some(from + Duration::days(it.days as i64));
    } else {
        w.owned.push(id.to_string());
    }
    w.log(-(it.price as i64), id);
    save(root, &w)?;
    Ok(w)
}

/// Kuşan ya da çıkar (id None → o türü çıkar)
pub fn equip(root: &Path, kind: &str, id: Option<&str>) -> Result<Wallet> {
    let _g = LOCK.lock();
    let mut w = load(root);
    match id {
        None => {
            w.equipped.remove(kind);
        }
        Some(id) => {
            let it = item(id).ok_or_else(|| AppError::msg("Böyle bir öğe yok"))?;
            if !w.can_use(it) {
                return Err(AppError::msg(if it.plus_only { "Bu öğe için West Plus gerekiyor" } else { "Önce bu öğeyi satın almalısın" }));
            }
            w.equipped.insert(kind.to_string(), id.to_string());
        }
    }
    save(root, &w)?;
    Ok(w)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn earning_buying_and_plus() {
        let dir = std::env::temp_dir().join(format!("west-wallet-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Hediye
        assert_eq!(load(&dir).coins, WELCOME_BONUS);
        // 1,5 saat → 150 coin
        assert_eq!(earn(&dir, 5400).unwrap(), 150);
        // Artan saniyeler kaybolmaz: 30 sn + 6 sn = 1 coin
        assert_eq!(earn(&dir, 30).unwrap(), 0);
        assert_eq!(earn(&dir, 6).unwrap(), 1);
        assert_eq!(load(&dir).coins, WELCOME_BONUS + 151);
        // Yetmeyen coin
        assert!(buy(&dir, "plus_30").is_err());
        // Satın al, tekrar alma, kuşan
        let w = buy(&dir, "trail_stars").unwrap();
        assert_eq!(w.coins, WELCOME_BONUS + 151 - 300);
        assert!(buy(&dir, "trail_stars").is_err());
        assert!(equip(&dir, "trail", Some("trail_stars")).is_ok());
        assert!(equip(&dir, "trail", Some("trail_fire")).is_err());
        // Plus'a özel öğe Plus olmadan kuşanılamaz
        assert!(equip(&dir, "trail", Some("trail_rainbow")).is_err());
        // Plus al (coin ekleyerek), Plus öğesini kuşan, Plus'ta kazanç %150
        let mut w = load(&dir);
        w.coins += 5000;
        save(&dir, &w).unwrap();
        let w = buy(&dir, "plus_30").unwrap();
        assert!(w.plus_active());
        assert!(equip(&dir, "trail", Some("trail_rainbow")).is_ok());
        assert_eq!(earn(&dir, 3600).unwrap(), 150);
        // İkinci Plus üstüne eklenir
        let before = load(&dir).plus_until.unwrap();
        let mut w = load(&dir);
        w.coins += 2500;
        save(&dir, &w).unwrap();
        let after = buy(&dir, "plus_30").unwrap().plus_until.unwrap();
        assert!((after - before).num_days() == 30);
        // Plus biterse Plus öğesi otomatik çıkar
        let mut w = load(&dir);
        w.plus_until = Some(Utc::now() - Duration::days(1));
        save(&dir, &w).unwrap();
        assert!(load(&dir).equipped.get("trail").is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
