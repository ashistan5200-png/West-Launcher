import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import type { WestAccount } from "@/lib/types";

interface WestState {
  configured: boolean;
  account: WestAccount | null;
  loaded: boolean;
  load: () => Promise<void>;
  setAccount: (a: WestAccount | null) => void;
  logout: () => Promise<void>;
}

/** West hesabı oturumu (anahtarlar arka uçta; burada yalnızca görünen bilgi). */
export const useWest = create<WestState>((set) => ({
  configured: false,
  account: null,
  loaded: false,
  load: async () => {
    if (!isTauri()) return set({ loaded: true });
    const s = await api.westStatus().catch(() => null);
    set({ configured: !!s?.configured, account: s?.account ?? null, loaded: true });
  },
  setAccount: (account) => set({ account }),
  logout: async () => {
    await api.westLogout().catch(() => {});
    set({ account: null });
  },
}));

/** Arkadaşların seni "Çevrimiçi" görmesi için dakikada bir durum bildirimi (supabase/presence.sql gerekir; yoksa sessizce atlanır). */
let presenceTimer: number | undefined;
export function startPresence() {
  if (!isTauri() || presenceTimer) return;
  const beat = () => {
    const a = useWest.getState().account;
    if (!a) return;
    void api
      .westApi("POST", "/rest/v1/presence", { body: { user_id: a.userId, status: "online", updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates" })
      .catch(() => {});
  };
  beat();
  presenceTimer = window.setInterval(beat, 60_000);
}
