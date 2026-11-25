import { create } from "zustand";
import { api } from "@/lib/ipc";
import type { ContentHit, InstallReport } from "@/lib/types";
import { useInstances } from "./instances";
import { tx } from "@/lib/i18n";
import { errorText } from "@/lib/format";

const key = (h: Pick<ContentHit, "source" | "id">) => `${h.source}:${h.id}`;

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "error";
}

interface ContentState {
  /** "source:id" → kuruluyor */
  installing: Record<string, boolean>;
  /** instanceId → kurulu "source:id" kümesi */
  installed: Record<string, Set<string>>;
  toasts: Toast[];
  loadInstalled: (instanceId: string) => Promise<void>;
  isInstalled: (instanceId: string | null, hit: ContentHit) => boolean;
  /** Mod/shader/RP → seçili instance'a; modpack → yeni instance */
  install: (hit: ContentHit, instanceId: string | null) => Promise<void>;
  dismissToast: (id: number) => void;
}

let toastId = 0;

const summarize = (hit: ContentHit, r: InstallReport): Toast => {
  const deps = r.installed.filter((i) => i.dependencyOf).length;
  if (r.installed.length === 0 && r.skipped.length) return { id: ++toastId, text: r.skipped[0], tone: "warn" };
  const text = deps > 0 ? tx("{0} ve {1} bağımlılık kuruldu", hit.title, deps) : `${hit.title} kuruldu`;
  return { id: ++toastId, text: r.warnings.length ? `${text} · ${r.warnings[0]}` : text, tone: r.warnings.length ? "warn" : "ok" };
};

export const useContent = create<ContentState>((set, get) => ({
  installing: {},
  installed: {},
  toasts: [],

  loadInstalled: async (instanceId) => {
    const items = await api.installedContent(instanceId).catch(() => []);
    set((s) => ({ installed: { ...s.installed, [instanceId]: new Set(items.map((i) => `${i.source}:${i.projectId}`)) } }));
  },

  isInstalled: (instanceId, hit) => !!instanceId && !!get().installed[instanceId]?.has(key(hit)),

  install: async (hit, instanceId) => {
    const k = key(hit);
    set((s) => ({ installing: { ...s.installing, [k]: true } }));
    const push = (t: Toast) => {
      set((s) => ({ toasts: [...s.toasts.slice(-2), t] }));
      window.setTimeout(() => get().dismissToast(t.id), 6000);
    };
    try {
      if (hit.kind === "modpack") {
        const inst = await api.installModpack(hit);
        await useInstances.getState().refresh();
        push({ id: ++toastId, text: `${inst.name} yeni instance olarak kuruldu`, tone: "ok" });
      } else {
        if (!instanceId) throw new Error(tx("Önce bir instance seç"));
        const r = await api.installContent(instanceId, hit.source, hit.id, hit.kind);
        push(summarize(hit, r));
        await get().loadInstalled(instanceId);
      }
    } catch (e) {
      push({ id: ++toastId, text: errorText(e), tone: "error" });
    } finally {
      set((s) => {
        const { [k]: _, ...installing } = s.installing;
        return { installing };
      });
    }
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const contentKey = key;
