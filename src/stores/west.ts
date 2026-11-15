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
    const s = await api.westStatus().catch(() => ({ configured: false, account: null }));
    set({ configured: s.configured, account: s.account, loaded: true });
  },
  setAccount: (account) => set({ account }),
  logout: async () => {
    await api.westLogout().catch(() => {});
    set({ account: null });
  },
}));
