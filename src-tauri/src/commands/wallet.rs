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
}

fn view(w: Wallet) -> WalletView {
    WalletView { plus: w.plus_active(), wallet: w, catalog: wallet::CATALOG, coins_per_hour: wallet::COINS_PER_HOUR, plus_bonus_pct: wallet::PLUS_BONUS_PCT }
}

#[tauri::command]
pub fn wallet_get(state: State<'_, AppState>) -> WalletView {
    view(wallet::load(&state.paths.root))
}

#[tauri::command]
pub fn wallet_buy(state: State<'_, AppState>, id: String) -> Result<WalletView> {
    wallet::buy(&state.paths.root, &id).map(view)
}

#[tauri::command]
pub fn wallet_equip(state: State<'_, AppState>, kind: String, id: Option<String>) -> Result<WalletView> {
    wallet::equip(&state.paths.root, &kind, id.as_deref()).map(view)
}
