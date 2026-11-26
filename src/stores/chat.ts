import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { Pick } from "@/lib/types";
import { errorText } from "@/lib/format";

export interface ChatMessage {
  id: number;
  role: "user" | "ashi";
  text: string;
  picks?: Pick[];
  /** Ashi'nin yaptığı değişiklikler ("X kuruldu" …) */
  actions?: string[];
  /** Basit modda Ashi'nin mesajdan yakaladığı anahtar kelimeler */
  keywords?: string[];
  error?: boolean;
}

interface ChatState {
  open: boolean;
  busy: boolean;
  messages: ChatMessage[];
  /** Ham API geçmişi (tool_use / thinking blokları dahil) — opak */
  history: unknown[];
  mode: "claude" | "ollama" | "keyword" | null;
  activeInstance: string | null;
  /** Sohbet kutusuna önceden yazılacak metin (ör. ana sayfadan "Bana bir modpack kur") */
  draft: string | null;
  setDraft: (v: string | null) => void;
  setOpen: (v: boolean) => void;
  toggle: () => void;
  setActiveInstance: (id: string | null) => void;
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
  draft: null,

  setDraft: (draft) => set({ draft }),
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
  setActiveInstance: (activeInstance) => set({ activeInstance }),

  send: async (text) => {
    const msg = text.trim();
    if (!msg || get().busy) return;
    set((s) => ({ busy: true, messages: [...s.messages, { id: ++mid, role: "user", text: msg }] }));
    try {
      const out = await api.ashiChat(get().history, msg, get().activeInstance);
      set((s) => ({
        history: out.history,
        mode: out.mode,
        messages: [...s.messages, { id: ++mid, role: "ashi", text: out.reply, picks: out.picks, actions: out.actions, keywords: out.mode === "keyword" ? out.searches.flatMap((q) => q.split(" ")).filter(Boolean) : undefined }],
      }));
    } catch (e) {
      set((s) => ({ messages: [...s.messages, { id: ++mid, role: "ashi", text: errorText(e), error: true }] }));
    } finally {
      set({ busy: false });
    }
  },

  reset: () => set({ messages: [], history: [], mode: null }),
}));
