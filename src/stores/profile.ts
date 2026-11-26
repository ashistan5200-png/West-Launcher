import { create } from "zustand";
import { isTauri } from "@/lib/ipc";
import { profileByUsername, type Profile } from "@/lib/profile";
import { useWest } from "./west";

/** Giriş yapmış West hesabının profili (başlık çubuğu ve Hesap sayfası) */
interface ProfileState {
  me: Profile | null;
  loadMe: () => Promise<void>;
  setMe: (p: Profile) => void;
}

export const useProfile = create<ProfileState>((set) => ({
  me: null,
  loadMe: async () => {
    const acc = useWest.getState().account;
    if (!acc || !isTauri()) return set({ me: null });
    const me = await profileByUsername(acc.username).catch(() => null);
    set({ me });
  },
  setMe: (me) => set({ me }),
}));
