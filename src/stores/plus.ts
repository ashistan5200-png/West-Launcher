/**
 * West+ üyeliği. Kaynak her zaman sunucudur (supabase/plus.sql); burada yalnızca görünen durum tutulur.
 * Açılış ekranında beklemeden logo gösterebilmek için son bilinen durum yerel olarak saklanır,
 * ardından sunucudan doğrulanır.
 */
import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import { tx } from "@/lib/i18n";
import { useWest } from "./west";

/** Fiyatlar (TL). Satış e-pin siteleri üzerinden yapılır. */
export const PLUS_PLANS = [
  { id: "month", label: tx("Aylık"), price: "79,99", days: 30, note: "" },
  { id: "quarter", label: tx("3 Aylık"), price: "149,99", days: 90, note: tx("Ayda 50 TL") },
  { id: "year", label: tx("Yıllık"), price: "449,99", days: 365, note: tx("Ayda 37,50 TL") },
] as const;

/** West+ kodlarının satıldığı sayfa. Boşsa "yakında" gösterilir. */
export const PLUS_STORE_URL = "";

const CACHE = "west.plus";

function cached(): { userId: string; expiresAt: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? "null") as { userId: string; expiresAt: string } | null;
    return v && new Date(v.expiresAt).getTime() > Date.now() ? v : null;
  } catch {
    return null;
  }
}

interface PlusState {
  active: boolean;
  expiresAt: string | null;
  loaded: boolean;
  modalOpen: boolean;
  load: () => Promise<void>;
  redeem: (code: string) => Promise<{ ok: true; days: number; expiresAt: string } | { ok: false; error: string }>;
  openModal: () => void;
  closeModal: () => void;
}

const c0 = cached();

export const usePlus = create<PlusState>((set) => ({
  active: !!c0,
  expiresAt: c0?.expiresAt ?? null,
  loaded: false,
  modalOpen: false,

  load: async () => {
    const acc = useWest.getState().account;
    if (!isTauri() || !acc) {
      if (useWest.getState().loaded) {
        try { localStorage.removeItem(CACHE); } catch { /* yok say */ }
        set({ active: false, expiresAt: null, loaded: true });
      }
      return;
    }
    const rows = await api
      .westApi<{ expires_at: string }[]>("GET", "/rest/v1/plus_subscriptions", { query: [["select", "expires_at"], ["user_id", `eq.${acc.userId}`]] })
      .catch(() => null);
    // Sunucuya ulaşılamadıysa son bilinen durum kalsın
    if (!rows) return set({ loaded: true });
    const exp = rows[0]?.expires_at ?? null;
    const active = !!exp && new Date(exp).getTime() > Date.now();
    try {
      if (active) localStorage.setItem(CACHE, JSON.stringify({ userId: acc.userId, expiresAt: exp }));
      else localStorage.removeItem(CACHE);
    } catch { /* yok say */ }
    set({ active, expiresAt: active ? exp : null, loaded: true });
  },

  redeem: async (code) => {
    const r = await api
      .westApi<{ ok: boolean; error?: string; days?: number; expires_at?: string }>("POST", "/rest/v1/rpc/redeem_plus_code", { body: { p_code: code } })
      .catch((e) => ({ ok: false, error: String(e) }) as { ok: false; error: string });
    if (!r.ok) {
      const msg: Record<string, string> = {
        login: tx("Kodu kullanmak için West hesabına giriş yap."),
        rate: tx("Çok fazla deneme yaptın. 10 dakika sonra tekrar dene."),
        invalid: tx("Bu kod geçersiz. Harfleri kontrol et."),
        used: tx("Bu kod daha önce kullanılmış."),
      };
      return { ok: false, error: msg[r.error ?? ""] ?? tx("Kod şu an doğrulanamadı. İnternet bağlantını kontrol edip tekrar dene.") };
    }
    await usePlus.getState().load();
    return { ok: true, days: r.days ?? 0, expiresAt: r.expires_at ?? "" };
  },

  openModal: () => set({ modalOpen: true }),
  closeModal: () => set({ modalOpen: false }),
}));

/** Hesap değişince ve saatte bir West+ durumunu yenile */
let started = false;
export function startPlus() {
  if (started) return;
  started = true;
  void usePlus.getState().load();
  useWest.subscribe((s, p) => {
    if (s.account?.userId !== p.account?.userId || s.loaded !== p.loaded) void usePlus.getState().load();
  });
  window.setInterval(() => void usePlus.getState().load(), 60 * 60 * 1000);
}
