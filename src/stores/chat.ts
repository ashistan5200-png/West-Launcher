import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import type { Pick, SecretStatus } from "@/lib/types";

export interface ChatMessage {
  id: number;
  role: "user" | "ashi";
  text: string;
  picks?: Pick[];
  error?: boolean;
}

interface ChatState {
  open: boolean;
  busy: boolean;
  messages: ChatMessage[];
  /** Ham API geçmişi (tool_use / thinking blokları dahil) — opak */
  history: unknown[];
  mode: "ollama" | "claude" | "keyword" | null;
  activeInstance: string | null;
  secrets: SecretStatus | null;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setActiveInstance: (id: string | null) => void;
  loadSecrets: () => Promise<void>;
  send: (text: string) => Promise<void>;
  reset: () => void;
}

let mid = 0;

export const useChat = create<ChatState>((set, get) => ({
  open: false,
  busy: false,
  messages: [],
  history: [],
  mode: null,
  activeInstance: null,
  secrets: null,

  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setActiveInstance: (activeInstance) => set({ activeInstance }),

  loadSecrets: async () => {
    if (isTauri()) set({ secrets: await api.secretStatus().catch(() => null) });
  },

  send: async (text) => {
    const msg = text.trim();
    if (!msg || get().busy) return;
    set((s) => ({ busy: true, messages: [...s.messages, { id: ++mid, role: "user", text: msg }] }));
    try {
      const out = await api.ashiChat(get().history, msg, get().activeInstance);
      set((s) => ({
        history: out.history,
        mode: out.mode,
        messages: [...s.messages, { id: ++mid, role: "ashi", text: out.reply, picks: out.picks }],
      }));
    } catch (e) {
      set((s) => ({ messages: [...s.messages, { id: ++mid, role: "ashi", text: String(e), error: true }] }));
    } finally {
      set({ busy: false });
    }
  },

  reset: () => set({ messages: [], history: [], mode: null }),
}));
