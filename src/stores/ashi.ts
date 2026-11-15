import { create } from "zustand";
import { api, events, isTauri } from "@/lib/ipc";
import { ashiLines, randomLine, type AshiMood } from "@/lib/ashi";
import type { AshiEvent, AshiSkin, HuntPlan, HuntVerdict } from "@/lib/types";
import fallbackSkin from "@/assets/ashi/ashi-skin.png";

export interface HuntView {
  instanceId: string;
  status: "running" | "done" | "cancelled" | "error";
  round: number;
  maxRounds: number;
  totalMods: number;
  enabled: number;
  suspects: number;
  phase: AshiEvent["phase"];
  line: string;
  mood: AshiMood;
  /** Son turun sonucu: Ashi kısa bir tepki verir (bonk / sevinç) ve yazı olarak kalır */
  reaction: string | null;
  reactMood: AshiMood | null;
  reactAt: number;
  verdict: HuntVerdict | null;
  message: string | null;
  startedAt: number;
}

interface Offer {
  instanceId: string;
  name: string;
  modCount: number;
  line: string;
}

interface AshiState {
  skin: AshiSkin;
  offer: Offer | null;
  confirm: { instanceId: string; name: string; plan: HuntPlan } | null;
  hunts: Record<string, HuntView>;
  busy: boolean;

  loadSkin: () => Promise<void>;
  showOffer: (o: Omit<Offer, "line">) => void;
  dismissOffer: () => void;
  openConfirm: (instanceId: string, name: string) => Promise<void>;
  closeConfirm: () => void;
  start: (instanceId: string, offlineName: string) => Promise<void>;
  cancel: (instanceId: string) => Promise<void>;
  disable: (instanceId: string, files: string[]) => Promise<void>;
  close: (instanceId: string) => void;
  bindEvents: (nameOf: (id: string) => string) => Promise<() => void>;
}

let seed = 0;
const nextSeed = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);

export const useAshi = create<AshiState>((set, get) => ({
  // Mojang'dan gelene kadar (veya çevrimdışıyken) paketli AshiWest skini
  skin: { dataUrl: fallbackSkin, slim: true },
  offer: null,
  confirm: null,
  hunts: {},
  busy: false,

  loadSkin: async () => {
    if (!isTauri()) return;
    try {
      const skin = await api.ashiSkin();
      if (skin?.dataUrl) set({ skin });
    } catch {
      /* paketli skinle devam */
    }
  },

  showOffer: (o) => set({ offer: { ...o, line: ashiLines.offer(o.name, nextSeed()) } }),
  dismissOffer: () => set({ offer: null }),

  openConfirm: async (instanceId, name) => {
    const plan = isTauri() ? await api.planHunt(instanceId) : { modCount: 120, maxRounds: 9 };
    set({ confirm: { instanceId, name, plan }, offer: null });
  },
  closeConfirm: () => set({ confirm: null }),

  start: async (instanceId, offlineName) => {
    set({ busy: true });
    try {
      const plan = await api.startHunt(instanceId, offlineName);
      set((s) => ({
        confirm: null,
        hunts: {
          ...s.hunts,
          [instanceId]: {
            instanceId,
            status: "running",
            round: 0,
            maxRounds: plan.maxRounds,
            totalMods: plan.modCount,
            enabled: plan.modCount,
            suspects: plan.modCount,
            phase: "baseline",
            line: randomLine(ashiLines.baseline, nextSeed()),
            mood: "search",
            reaction: null,
            reactMood: null,
            reactAt: 0,
            verdict: null,
            message: null,
            startedAt: Date.now(),
          },
        },
      }));
    } finally {
      set({ busy: false });
    }
  },

  cancel: async (instanceId) => {
    await api.cancelHunt(instanceId);
  },

  disable: async (instanceId, files) => {
    await api.disableMods(instanceId, files);
    get().close(instanceId);
  },

  close: (instanceId) =>
    set((s) => {
      const { [instanceId]: _, ...hunts } = s.hunts;
      return { hunts };
    }),

  bindEvents: async (nameOf) => {
    if (!isTauri()) return () => {};
    const un = await Promise.all([
      events.onGameExit((x) => {
        if (x.crashed && !x.duringHunt && x.modCount >= 2 && !get().hunts[x.instanceId]) {
          get().showOffer({ instanceId: x.instanceId, name: nameOf(x.instanceId), modCount: x.modCount });
        }
      }),
      events.onAshi((e) => {
        set((s) => {
          const prev = s.hunts[e.instanceId];
          if (!prev && e.kind !== "started") return s;
          const base: HuntView = prev ?? {
            instanceId: e.instanceId, status: "running", round: 0, maxRounds: e.maxRounds, totalMods: e.totalMods,
            enabled: e.enabled, suspects: e.suspects, phase: "baseline", line: randomLine(ashiLines.baseline, nextSeed()),
            mood: "search", reaction: null, reactMood: null, reactAt: 0, verdict: null, message: null, startedAt: Date.now(),
          };
          const next: HuntView = { ...base, round: e.round, maxRounds: e.maxRounds, enabled: e.enabled, suspects: e.suspects, phase: e.phase ?? base.phase };

          switch (e.kind) {
            case "testing":
              next.mood = "search";
              next.line = randomLine(e.phase === "baseline" ? ashiLines.baseline : e.phase === "verify" ? ashiLines.verify : ashiLines.testing, nextSeed());
              break;
            case "tested":
              next.reactMood = e.outcome === "crash" ? "bonk" : e.outcome === "other" ? "think" : "wave";
              next.reactAt = Date.now();
              next.reaction = e.message ?? randomLine(e.outcome === "crash" ? ashiLines.crashed : e.outcome === "other" ? ashiLines.other : ashiLines.survived, nextSeed());
              break;
            case "done":
              next.status = "done";
              next.reaction = null;
              next.verdict = e.verdict;
              next.mood = e.verdict?.kind === "culprit" ? "celebrate" : e.verdict?.kind === "combination" || e.verdict?.kind === "dependency" ? "think" : "sad";
              next.line =
                e.verdict?.kind === "culprit" ? (e.verdict.mods.every((m) => m.library) ? ashiLines.libraryCulprit : ashiLines.culprit(e.verdict.mods.length))
                : e.verdict?.kind === "combination" ? ashiLines.combination
                : e.verdict?.kind === "dependency" ? ashiLines.dependency
                : ashiLines.notReproduced;
              break;
            case "cancelled":
              next.status = "cancelled";
              next.mood = "wave";
              next.line = ashiLines.cancelled;
              break;
            case "error":
              next.status = "error";
              next.mood = "sad";
              next.line = ashiLines.error;
              next.message = e.message;
              break;
          }
          return { hunts: { ...s.hunts, [e.instanceId]: next } };
        });
      }),
    ]);
    return () => un.forEach((f) => f());
  },
}));

/** Bir instance'ta av sürüyor mu? (Oyna düğmesini kilitlemek için) */
export const useHuntRunning = (id: string) => useAshi((s) => s.hunts[id]?.status === "running");
