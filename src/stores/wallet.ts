/**
 * West Coin cüzdanı (arayüz tarafı). Asıl kayıt ve kurallar Rust'ta: src-tauri/src/wallet.rs.
 * Kuşanılan launcher görünümleri (tema, arka plan, imleç izi) buradan uygulanır.
 */
import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/ipc";
import { applyPack } from "@/lib/theme";
import { SLOT, THEME_PACKS, type ShopItem } from "@/lib/shop";

export interface WalletData {
  coins: number;
  carrySecs: number;
  earnedTotal: number;
  owned: string[];
  plusUntil: string | null;
  equipped: Record<string, string>;
  history: { at: string; amount: number; reason: string }[];
}
interface WalletView { wallet: WalletData; plus: boolean; catalog: ShopItem[]; coinsPerHour: number; plusBonusPct: number }

const CACHE = "west.walletView";

function cached(): WalletView | null {
  try { return JSON.parse(localStorage.getItem(CACHE) ?? "null") as WalletView | null; } catch { return null; }
}

interface WalletState {
  view: WalletView | null;
  shopOpen: boolean;
  /** Son kazanç bildirimi */
  earned: { coins: number; at: number } | null;
  load: () => Promise<void>;
  buy: (id: string) => Promise<string | null>;
  equip: (slot: string, id: string | null) => Promise<string | null>;
  owns: (id: string) => boolean;
  canUse: (id: string) => boolean;
  equipped: (slot: string) => string | null;
  dismissEarned: () => void;
}

function apply(v: WalletView | null) {
  const pack = v?.wallet.equipped.theme;
  applyPack(pack ? THEME_PACKS[pack] ?? null : null);
  try { if (v) localStorage.setItem(CACHE, JSON.stringify(v)); } catch { /* yok say */ }
}

const c0 = cached();
// Açılışta (sunucuya gitmeden) son bilinen görünüm hemen uygulansın
if (c0) apply(c0);

export const useWallet = create<WalletState>((set, get) => ({
  view: c0,
  shopOpen: false,
  earned: null,

  load: async () => {
    if (!isTauri()) return;
    const v = await invoke<WalletView>("wallet_get").catch(() => null);
    if (!v) return;
    apply(v);
    set({ view: v });
  },

  buy: async (id) => {
    try {
      const v = await invoke<WalletView>("wallet_buy", { id });
      apply(v);
      set({ view: v });
      return null;
    } catch (e) {
      return String(e);
    }
  },

  equip: async (slot, id) => {
    try {
      const v = await invoke<WalletView>("wallet_equip", { kind: slot, id });
      apply(v);
      set({ view: v });
      return null;
    } catch (e) {
      return String(e);
    }
  },

  owns: (id) => !!get().view?.wallet.owned.includes(id),
  canUse: (id) => {
    const v = get().view;
    const it = v?.catalog.find((c) => c.id === id);
    if (!v || !it) return false;
    return (it.price === 0 && !it.plusOnly) || v.wallet.owned.includes(id) || (it.plusOnly && v.plus);
  },
  equipped: (slot) => get().view?.wallet.equipped[slot] ?? null,
  dismissEarned: () => set({ earned: null }),
}));

/** Plus açık mı (açılışta önbellekten, sonra Rust'tan) */
export const usePlusActive = () => useWallet((s) => !!s.view?.plus);

let started = false;
export function startWallet() {
  if (started || !isTauri()) return;
  started = true;
  void useWallet.getState().load();
  void listen<{ coins: number }>("wallet-earned", (e) => {
    void useWallet.getState().load();
    useWallet.setState({ earned: { coins: e.payload.coins, at: Date.now() } });
  });
  // Plus süresi dolarsa görünüm geri alınsın
  window.setInterval(() => void useWallet.getState().load(), 10 * 60 * 1000);
}

export { SLOT };
