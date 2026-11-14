import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import type { FoundInstance } from "@/lib/types";
import { useSettings } from "./settings";

interface OnboardingState {
  splashDone: boolean;
  /** İlk kurulum sihirbazı (giriş adımlı) açık mı */
  setupOpen: boolean;
  /** Launcher şifreyle kilitli ve henüz açılmadı */
  locked: boolean | null;
  touring: boolean;
  wizardOpen: boolean;
  found: FoundInstance[] | null;
  scanning: boolean;
  finishSplash: () => void;
  setLocked: (v: boolean) => void;
  finishSetup: (opts: { tour: boolean; importAfter: boolean }) => Promise<void>;
  startTour: () => void;
  endTour: () => Promise<void>;
  openWizard: () => void;
  closeWizard: () => void;
  scan: () => Promise<void>;
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  splashDone: false,
  setupOpen: false,
  locked: null,
  touring: false,
  wizardOpen: false,
  found: null,
  scanning: false,

  finishSplash: () => {
    if (get().splashDone) return;
    set({ splashDone: true });
    maybeStart();
  },

  setLocked: (locked) => {
    set({ locked });
    maybeStart();
  },

  finishSetup: async ({ tour, importAfter }) => {
    set({ setupOpen: false });
    await useSettings.getState().update({ onboardingDone: true });
    if (importAfter) get().openWizard();
    else if (tour) get().startTour();
  },

  startTour: () => {
    set({ touring: true });
    void get().scan(); // tur sürerken arka planda diğer launcher'ları tara
  },

  endTour: async () => {
    set({ touring: false });
    await useSettings.getState().update({ onboardingDone: true });
  },

  openWizard: () => {
    set({ wizardOpen: true });
    if (!get().found) void get().scan();
  },
  closeWizard: () => set({ wizardOpen: false }),

  scan: async () => {
    if (!isTauri() || get().scanning) return;
    set({ scanning: true });
    try {
      set({ found: await api.detectLaunchers() });
    } finally {
      set({ scanning: false });
    }
  },
}));

/**
 * İlk açılışta kurulum sihirbazı; açılış animasyonu bitmiş, ayarlar yüklenmiş ve
 * (varsa) launcher kilidi açılmış olmalı. Yalnızca bir kez başlar.
 */
let started = false;
function maybeStart() {
  const o = useOnboarding.getState();
  const s = useSettings.getState();
  if (started || !o.splashDone || !s.loaded || o.locked !== false || s.settings.onboardingDone) return;
  started = true;
  useOnboarding.setState({ setupOpen: true });
  void o.scan(); // sihirbaz sürerken diğer launcher'ları tara
}
useSettings.subscribe(maybeStart);
