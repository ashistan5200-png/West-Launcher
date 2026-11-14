import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import type { FoundInstance } from "@/lib/types";
import { useSettings } from "./settings";

interface OnboardingState {
  splashDone: boolean;
  touring: boolean;
  wizardOpen: boolean;
  found: FoundInstance[] | null;
  scanning: boolean;
  finishSplash: () => void;
  startTour: () => void;
  endTour: () => Promise<void>;
  openWizard: () => void;
  closeWizard: () => void;
  scan: () => Promise<void>;
}

export const useOnboarding = create<OnboardingState>((set, get) => ({
  splashDone: false,
  touring: false,
  wizardOpen: false,
  found: null,
  scanning: false,

  finishSplash: () => {
    if (get().splashDone) return;
    set({ splashDone: true });
    maybeStart();
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

/** İlk açılışta tur, hem açılış animasyonu bitip hem ayarlar yüklendiğinde bir kez başlar. */
let started = false;
function maybeStart() {
  const o = useOnboarding.getState();
  const s = useSettings.getState();
  if (started || !o.splashDone || !s.loaded || s.settings.onboardingDone) return;
  started = true;
  o.startTour();
}
useSettings.subscribe(maybeStart);
