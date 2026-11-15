import { create } from "zustand";
import { isTauri } from "@/lib/ipc";
import { profileByUsername, unreadCounts, type Profile } from "@/lib/social";
import { useWest } from "./west";

interface SocialState {
  me: Profile | null;
  unread: { notifications: number; messages: number };
  composeOpen: boolean;
  /** Yanıt / alıntı için açılan yazma penceresi */
  composeCtx: { replyTo?: string; quoteOf?: string } | null;
  loadMe: () => Promise<void>;
  setMe: (p: Profile) => void;
  refreshUnread: () => Promise<void>;
  openCompose: (ctx?: { replyTo?: string; quoteOf?: string }) => void;
  closeCompose: () => void;
}

export const useSocial = create<SocialState>((set) => ({
  me: null,
  unread: { notifications: 0, messages: 0 },
  composeOpen: false,
  composeCtx: null,
  loadMe: async () => {
    const acc = useWest.getState().account;
    if (!acc || !isTauri()) return set({ me: null });
    const me = await profileByUsername(acc.username).catch(() => null);
    set({ me });
  },
  setMe: (me) => set({ me }),
  refreshUnread: async () => {
    if (!useWest.getState().account) return;
    const unread = await unreadCounts().catch(() => null);
    if (unread) set({ unread });
  },
  openCompose: (ctx) => set({ composeOpen: true, composeCtx: ctx ?? null }),
  closeCompose: () => set({ composeOpen: false, composeCtx: null }),
}));
