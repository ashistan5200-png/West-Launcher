use crate::error::Result;
use crate::state::AppState;
use crate::wallet::{self, Item, Wallet};
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletView {
    pub wallet: Wallet,
    pub plus: bool,
    pub catalog: &'static [Item],
    pub coins_per_hour: u64,
    pub plus_bonus_pct: u64,
    /// West hesabıyla giriş yapılmış ve sunucuya ulaşıldı mı
    pub logged_in: bool,
    /// Sunucuya ulaşılamadı; son bilinen cüzdan gösteriliyor (değişiklik yapılamaz)
    pub offline: bool,
}

fn view(w: Wallet, logged_in: bool, offline: bool) -> WalletView {
    WalletView { plus: w.plus_active(), wallet: w, catalog: wallet::CATALOG, coins_per_hour: wallet::COINS_PER_HOUR, plus_bonus_pct: wallet::PLUS_BONUS_PCT, logged_in, offline }
}

#[tauri::command]
pub async fn wallet_get(state: State<'_, AppState>) -> Result<WalletView> {
    if crate::cloud::current_user(&state.http, &state.paths.root).await.is_none() {
        return Ok(view(Wallet::default(), false, false));
    }
    match wallet::get(&state.http, &state.paths.root).await {
        Ok(w) => Ok(view(w, true, false)),
        Err(e) => match wallet::cached(&state.paths.root) {
            Some(w) => Ok(view(w, true, true)),
            None => Err(e),
        },
    }
}

#[tauri::command]
pub async fn wallet_buy(state: State<'_, AppState>, id: String) -> Result<WalletView> {
    wallet::buy(&state.http, &state.paths.root, &id).await.map(|w| view(w, true, false))
}

#[tauri::command]
pub async fn wallet_equip(state: State<'_, AppState>, kind: String, id: Option<String>) -> Result<WalletView> {
    wallet::equip(&state.http, &state.paths.root, &kind, id.as_deref()).await.map(|w| view(w, true, false))
}
