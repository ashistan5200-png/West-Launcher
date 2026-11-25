import { create } from "zustand";
import { api, events, isTauri } from "@/lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./settings";
import type { GameExit, Instance, NewInstance, Progress } from "@/lib/types";
import { errorText } from "@/lib/format";

const MAX_LOG = 5000;

interface InstancesState {
  instances: Instance[];
  running: Record<string, number>; // id → pid
  launching: Record<string, boolean>;
  progress: Record<string, Progress>;
  logs: Record<string, { line: string; stderr: boolean }[]>;
  lastExit: Record<string, GameExit>;
  error: string | null;

  refresh: () => Promise<void>;
  create: (req: NewInstance) => Promise<Instance>;
  launch: (id: string, offlineName: string, joinServer?: string) => Promise<void>;
  kill: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clone: (id: string, name: string, includeWorlds: boolean) => Promise<void>;
  clearError: () => void;
  bindEvents: () => Promise<() => void>;
}

export const useInstances = create<InstancesState>((set, get) => ({
  instances: [],
  running: {},
  launching: {},
  progress: {},
  logs: {},
  lastExit: {},
  error: null,

  refresh: async () => {
    if (!isTauri()) return;
    const [instances, running] = await Promise.all([api.listInstances(), api.running()]);
    set({ instances, running: Object.fromEntries(running.map((r) => [r.instanceId, r.pid])) });
  },

  create: async (req) => {
    const inst = await api.createInstance(req);
    await get().refresh();
    return inst;
  },

  launch: async (id, offlineName, joinServer) => {
    set((s) => ({ launching: { ...s.launching, [id]: true }, logs: { ...s.logs, [id]: [] }, error: null }));
    try {
      const pid = await api.launch(id, { offlineName, joinServer });
      set((s) => ({ running: { ...s.running, [id]: pid } }));
    } catch (e) {
      set({ error: errorText(e) });
    } finally {
      set((s) => {
        const { [id]: _l, ...launching } = s.launching;
        const { [id]: _p, ...progress } = s.progress;
        return { launching, progress };
      });
    }
  },

  kill: async (id) => {
    await api.kill(id);
  },

  remove: async (id) => {
    await api.deleteInstance(id);
    await get().refresh();
  },

  clone: async (id, name, includeWorlds) => {
    await api.cloneInstance(id, name, includeWorlds);
    await get().refresh();
  },

  clearError: () => set({ error: null }),

  /** Rust olaylarını store'a bağlar; log satırları rAF ile toplu işlenir. */
  bindEvents: async () => {
    if (!isTauri()) return () => {};
    let pending: Record<string, { line: string; stderr: boolean }[]> = {};
    let raf = 0;
    const flush = () => {
      raf = 0;
      const batch = pending;
      pending = {};
      set((s) => {
        const logs = { ...s.logs };
        for (const [id, lines] of Object.entries(batch)) {
          const merged = (logs[id] ?? []).concat(lines);
          logs[id] = merged.length > MAX_LOG ? merged.slice(-MAX_LOG) : merged;
        }
        return { logs };
      });
    };

    const un = await Promise.all([
      // Oyun içi mod merkezi: "Uygula ve yeniden başlat" → değişiklikler uygulandı, aynı dünyaya/sunucuya geri aç
      listen<{ instanceId: string; join: string | null }>("live-relaunch", (e) => {
        const { instanceId, join } = e.payload;
        window.setTimeout(() => {
          void get().launch(instanceId, useSettings.getState().offlineName, join ?? undefined).catch(() => undefined);
        }, 400);
      }),
      // Mod merkezi yeni oturumu hazır komutla ya da arka planda açtı: "çalışıyor" durumunu güncelle
      listen<{ instanceId: string; pid: number }>("live-relaunched", (e) => {
        const { instanceId, pid } = e.payload;
        set((s) => ({ running: { ...s.running, [instanceId]: pid } }));
      }),
      events.onProgress((p) => set((s) => ({ progress: { ...s.progress, [p.task]: p } }))),
      events.onGameLog((l) => {
        // Pencere gizli/küçükken kare çizilmez (flush bekler): birikim sınırlı kalsın
        const q = (pending[l.instanceId] ??= []);
        q.push({ line: l.line, stderr: l.stderr });
        if (q.length > MAX_LOG) q.splice(0, q.length - MAX_LOG);
        if (!raf) raf = requestAnimationFrame(flush);
      }),
      events.onGameExit((x) => {
        set((s) => {
          const { [x.instanceId]: _, ...running } = s.running;
          return { running, lastExit: { ...s.lastExit, [x.instanceId]: x } };
        });
        void get().refresh();
      }),
    ]);
    return () => un.forEach((f) => f());
  },
}));
