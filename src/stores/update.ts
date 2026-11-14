import { create } from "zustand";
import { api, events, isTauri } from "@/lib/ipc";
import type { UpdateStatus } from "@/lib/types";

interface UpdateState {
  status: UpdateStatus | null;
  open: boolean;
  checking: boolean;
  installing: boolean;
  error: string | null;
  setOpen: (v: boolean) => void;
  check: () => Promise<void>;
  install: () => Promise<void>;
  bind: () => Promise<() => void>;
}

export const useUpdate = create<UpdateState>((set) => ({
  status: null,
  open: false,
  checking: false,
  installing: false,
  error: null,
  setOpen: (open) => set({ open, error: null }),

  check: async () => {
    if (!isTauri()) return;
    set({ checking: true, error: null });
    try {
      set({ status: await api.checkUpdate() });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ checking: false });
    }
  },

  install: async () => {
    set({ installing: true, error: null });
    try {
      await api.installUpdate(); // başarılıysa launcher kapanır, kurulum açılır
    } catch (e) {
      set({ installing: false, error: String(e) });
    }
  },

  bind: async () => {
    if (!isTauri()) return () => {};
    set({ status: await api.updateStatus().catch(() => null) });
    return events.onUpdate((status) => set({ status }));
  },
}));
