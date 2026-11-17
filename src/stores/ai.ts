import { create } from "zustand";
import { api, events, isTauri } from "@/lib/ipc";
import type { AiSetupProgress, AiStatus } from "@/lib/types";
import { useSettings } from "@/stores/settings";
import { useChat } from "@/stores/chat";
import { tx } from "@/lib/i18n";

interface AiState {
  status: AiStatus | null;
  /** Kurulum sürerken son ilerleme; bitince/iptalde null */
  progress: AiSetupProgress | null;
  error: string | null;
  /** "Ashi'yi akıllandıralım mı?" penceresi açık mı */
  asking: boolean;
  refresh: () => Promise<void>;
  ask: (open?: boolean) => void;
  /** Ollama + modeli birlikte kurar (zaten kurulu olanlar atlanır) */
  install: (model?: string) => Promise<void>;
}

let bound = false;

export const useAi = create<AiState>((set, get) => ({
  status: null,
  progress: null,
  error: null,
  asking: false,

  refresh: async () => {
    if (!isTauri()) return;
    set({ status: await api.ollamaStatus().catch(() => null) });
  },

  ask: (open = true) => {
    // Biten kurulumun "hazırım" ekranı yalnızca bir kez gösterilir
    set((s) => ({ asking: open, progress: !open && s.progress?.stage === "done" ? null : s.progress }));
    if (open) void get().refresh();
  },

  install: async (model) => {
    if (!isTauri() || (get().progress && get().progress!.stage !== "done")) return;
    if (!bound) {
      bound = true;
      void events.onOllamaSetup((p) => {
        if (p.stage === "error") set({ progress: null, error: p.error ?? tx("Kurulum durdu") });
        else if (p.stage === "done") {
          set({ progress: p, error: null });
          useChat.setState({ mode: null }); // sonraki mesaj akıllı modla gider
          void get().refresh();
        }
        else set({ progress: p });
      });
    }
    const m = model ?? get().status?.model;
    // Ön yüzdeki ayar kopyası da güncellensin; yoksa sonraki kayıt bunu geri alır
    await useSettings.getState().update({ aiProvider: "ollama", ...(m ? { ollamaModel: m } : {}) });
    set({ error: null, progress: { stage: "download", label: tx("Hazırlanıyor"), completed: 0, total: 0, error: null } });
    try {
      await api.ollamaSetup(m);
    } catch (e) {
      set({ progress: null, error: String(e).replace(/^Error: /, "") });
    }
    await get().refresh();
  },
}));

/** Ashi'nin "akıllı modu" kullanıma hazır mı */
// Ollama kapalıysa ilk mesajda kendiliğinden açılır; o yüzden "kurulu" yeterli
export const aiReady = (s: AiStatus | null) => !!s && s.installed && (!s.running || s.modelInstalled);

export const MODELS = [
  { id: "qwen2.5:3b", name: "Hafif", gb: 1.9, note: tx("8 GB RAM'li bilgisayarlar için. Hızlı, biraz daha basit.") },
  { id: "qwen2.5:7b", name: tx("Akıllı"), gb: 4.7, note: tx("16 GB RAM ve üstü. Türkçeyi ve isteklerini daha iyi anlar.") },
] as const;
