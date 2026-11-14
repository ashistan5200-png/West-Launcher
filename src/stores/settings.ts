import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import { applyTheme } from "@/lib/theme";
import type { Settings, ThemeSettings } from "@/lib/types";

const DEFAULT: Settings = {
  theme: { accent: "#7fa7c9", blur: 12, opacity: 0.94, windowEffect: "mica", density: "compact", reduceMotion: false },
  defaultMemoryMb: null,
  autoJava: true,
  maxConcurrentDownloads: 24,
  backupOnExit: true,
  backupDir: null,
  backupKeep: 10,
  closeOnLaunch: false,
  microsoftClientId: null,
  aiProvider: "ollama",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:7b",
  onboardingDone: false,
  companionEnabled: true,
  discordRpc: true,
  discordClientId: null,
};

interface SettingsState {
  settings: Settings;
  offlineName: string;
  loaded: boolean;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
  updateTheme: (patch: Partial<ThemeSettings>) => void;
  setOfflineName: (n: string) => void;
}

let saveTimer: number | undefined;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT,
  offlineName: localStorage.getItem("offlineName") ?? "Player",
  loaded: false,

  load: async () => {
    const settings = isTauri() ? await api.getSettings() : DEFAULT;
    applyTheme(settings.theme);
    set({ settings, loaded: true });
  },

  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    if (isTauri()) await api.saveSettings(settings);
  },

  /** Canlı önizleme: CSS anında, disk yazımı 300 ms debounce. */
  updateTheme: (patch) => {
    const prev = get().settings;
    const theme = { ...prev.theme, ...patch };
    applyTheme(theme);
    const settings = { ...prev, theme };
    set({ settings });
    if (patch.windowEffect && isTauri()) void api.setWindowEffect(patch.windowEffect);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => isTauri() && api.saveSettings(get().settings), 300);
  },

  setOfflineName: (n) => {
    localStorage.setItem("offlineName", n);
    set({ offlineName: n });
  },
}));
