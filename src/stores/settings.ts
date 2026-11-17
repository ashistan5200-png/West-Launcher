import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import { applyTheme, DEFAULT_ACCENT, LEGACY_DEFAULT_ACCENT } from "@/lib/theme";
import type { Settings, ThemeSettings } from "@/lib/types";
import { detectLang, getLang, setLang, type Lang } from "@/lib/i18n";


const DEFAULT: Settings = {
  theme: { accent: DEFAULT_ACCENT, blur: 14, opacity: 0.96, windowEffect: "mica", density: "compact", reduceMotion: false, cursorTrail: true },
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
  autoUpdate: true,
  music: true,
  musicInGame: true,
  shaders: false,
  language: "",
  accessibility: {
    performanceMode: false, westMenus: true, westHud: true, gameAnimations: true,
    smoothFont: true, perfMods: false, lowGraphics: false, launcherEffects: true,
  },
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
    let settings = isTauri() ? await api.getSettings() : DEFAULT;
    // West Client tasarımına geçiş: eski varsayılan vurgu bir kez yeni varsayılana çevrilir
    let migrated = false;
    try {
      migrated = localStorage.getItem("west.accentV2") === "1";
      localStorage.setItem("west.accentV2", "1");
    } catch { /* depolama yoksa her açılışta kontrol edilir */ }
    if (!migrated && settings.theme.accent.toLowerCase() === LEGACY_DEFAULT_ACCENT) {
      settings = { ...settings, theme: { ...settings.theme, accent: DEFAULT_ACCENT } };
      if (isTauri()) void api.saveSettings(settings);
    }
    settings = { ...DEFAULT, ...settings, accessibility: { ...DEFAULT.accessibility, ...(settings.accessibility ?? {}) } };
    // Dil: ilk açılışta sistem dilinden seç ve kaydet (oyun içi West arayüzü de bunu kullanır)
    if (!settings.language) {
      settings = { ...settings, language: detectLang() };
      if (isTauri()) void api.saveSettings(settings);
    }
    if (settings.language !== getLang()) {
      setLang(settings.language as Lang);
      // Arayüz bu dil ile baştan kurulsun
      location.reload();
      return;
    }
    applyTheme(settings.theme);
    document.documentElement.dataset.effects = settings.accessibility.launcherEffects ? "on" : "off";
    set({ settings, loaded: true });
  },

  update: async (patch) => {
    const settings = { ...get().settings, ...patch };
    document.documentElement.dataset.effects = settings.accessibility.launcherEffects ? "on" : "off";
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
