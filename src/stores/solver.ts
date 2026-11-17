/** Ashi Çözücü penceresinin durumu (bkz. components/AshiSolver.tsx) */
import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import type { CrashAnalysis } from "@/lib/types";
import { useAshi } from "./ashi";

export interface SolverState {
  open: { instanceId: string; name: string; modCount: number; a: CrashAnalysis | null } | null;
  busy: boolean;
  /** Çökme raporunu çöz ve pencereyi aç. auto: oyun çökünce kendiliğinden (bulunamazsa Suçlu Avı önerilir) */
  solve: (instanceId: string, name: string, opts?: { file?: string; modCount?: number; auto?: boolean }) => Promise<void>;
  close: () => void;
}

export const useSolver = create<SolverState>((set) => ({
  open: null,
  busy: false,
  solve: async (instanceId, name, opts = {}) => {
    if (!isTauri()) return;
    set({ busy: true });
    const a = await api.analyzeCrash(instanceId, opts.file).catch(() => null);
    set({ busy: false });
    const modCount = opts.modCount ?? 0;
    const useful = !!a && (a.culprit !== null || a.cause !== "unknown");
    if (opts.auto && !useful) {
      // Rapordan çıkaramadık: eskisi gibi Suçlu Avı öner (en az iki mod varsa)
      if (modCount >= 2) useAshi.getState().showOffer({ instanceId, name, modCount });
      return;
    }
    set({ open: { instanceId, name, modCount, a } });
  },
  close: () => set({ open: null }),
}));

