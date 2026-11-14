import { create } from "zustand";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { api, events, isTauri } from "@/lib/ipc";
import type { Screenshot } from "@/lib/types";

interface GalleryState {
  items: Screenshot[];
  loading: boolean;
  instance: string | null;
  /** Lightbox'ta açık görüntünün yolu */
  viewing: string | null;
  editing: string | null;
  message: { text: string; tone: "ok" | "error" } | null;
  setInstance: (id: string | null) => void;
  load: () => Promise<void>;
  view: (path: string | null) => void;
  edit: (path: string | null) => void;
  copy: (s: Screenshot) => Promise<void>;
  exportTo: (s: Screenshot) => Promise<void>;
  remove: (s: Screenshot) => Promise<void>;
  added: (s: Screenshot) => void;
  flash: (text: string, tone?: "ok" | "error") => void;
  bindEvents: () => Promise<() => void>;
}

let flashTimer: number | undefined;

export const useGallery = create<GalleryState>((set, get) => ({
  items: [],
  loading: false,
  instance: null,
  viewing: null,
  editing: null,
  message: null,

  setInstance: (instance) => {
    set({ instance });
    void get().load();
  },

  load: async () => {
    if (!isTauri()) return;
    set({ loading: true });
    try {
      const items = await api.listScreenshots(get().instance);
      set({ items });
      // Eksik küçük resimler arka planda, sırayla üretilir
      const missing = items.filter((s) => !s.thumb).map((s) => s.path);
      if (missing.length) void api.generateThumbs(missing);
    } finally {
      set({ loading: false });
    }
  },

  view: (viewing) => set({ viewing }),
  edit: (editing) => set({ editing, viewing: editing ? null : get().viewing }),

  flash: (text, tone = "ok") => {
    set({ message: { text, tone } });
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => set({ message: null }), 3500);
  },

  copy: async (s) => {
    try {
      await api.copyScreenshot(s.path);
      get().flash("Panoya kopyalandı — Discord'a veya herhangi bir yere yapıştırabilirsin");
    } catch (e) {
      get().flash(String(e), "error");
    }
  },

  exportTo: async (s) => {
    const dest = await saveDialog({ defaultPath: s.file, filters: [{ name: "Görüntü", extensions: [s.file.split(".").pop() ?? "png"] }] });
    if (!dest) return;
    try {
      await api.exportScreenshot(s.path, dest);
      get().flash("Dışa aktarıldı");
    } catch (e) {
      get().flash(String(e), "error");
    }
  },

  remove: async (s) => {
    try {
      await api.deleteScreenshot(s.path);
      set((st) => ({ items: st.items.filter((x) => x.path !== s.path), viewing: st.viewing === s.path ? null : st.viewing }));
      get().flash("Çöp kutusuna taşındı");
    } catch (e) {
      get().flash(String(e), "error");
    }
  },

  added: (s) => set((st) => ({ items: [s, ...st.items.filter((x) => x.path !== s.path)] })),

  bindEvents: async () => {
    if (!isTauri()) return () => {};
    const un = await Promise.all([
      events.onThumb(({ path, thumb }) => set((st) => ({ items: st.items.map((s) => (s.path === path ? { ...s, thumb } : s)) }))),
      // Oyunda F2'ye basılınca: dosyanın yazılması için kısa bir gecikmeyle yenile
      events.onScreenshotTaken(() => window.setTimeout(() => void get().load(), 700)),
    ]);
    return () => un.forEach((f) => f());
  },
}));
