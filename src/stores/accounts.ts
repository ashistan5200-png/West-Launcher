import { create } from "zustand";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, events, isTauri } from "@/lib/ipc";
import type { AccountView, DeviceCode, Skin } from "@/lib/types";

/** Klasik skinlerde sağ kolun 4. sütunu (x=54..55, y=20..31) doludur; slim'de saydamdır. */
async function detectSlim(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.height !== 64) return resolve(false);
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(54, 20, 2, 12).data;
      let transparent = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] === 0) transparent++;
      resolve(transparent >= 20); // 24 pikselin neredeyse tamamı saydam
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

interface AccountsState {
  accounts: AccountView[];
  skins: Skin[];
  /** Önizlemede gösterilen skin (arşivden ya da hesabın kendisinden) */
  previewId: string | null;
  login: DeviceCode | null;
  loginError: string | null;
  busy: string | null;
  error: string | null;
  notice: string | null;

  active: () => AccountView | null;
  load: () => Promise<void>;
  addOffline: (name: string) => Promise<void>;
  setActive: (uuid: string) => Promise<void>;
  remove: (uuid: string) => Promise<void>;
  startLogin: () => Promise<void>;
  cancelLogin: () => Promise<void>;
  bindEvents: () => Promise<() => void>;

  setPreview: (id: string | null) => void;
  importFile: () => Promise<void>;
  importPlayer: (name: string) => Promise<void>;
  toggleFavorite: (s: Skin) => Promise<void>;
  setSlim: (s: Skin, slim: boolean) => Promise<void>;
  rename: (s: Skin, name: string) => Promise<void>;
  removeSkin: (s: Skin) => Promise<void>;
  apply: (s: Skin) => Promise<void>;
  syncAccountSkin: () => Promise<void>;
  clearMessages: () => void;
}

export const useAccounts = create<AccountsState>((set, get) => {
  /** Uzun işlemler için ortak sarmalayıcı: meşgul etiketi + hata yakalama. */
  const run = async (label: string, fn: () => Promise<void>) => {
    set({ busy: label, error: null, notice: null });
    try {
      await fn();
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: null });
    }
  };
  const upsertSkin = (s: Skin) => set((st) => ({ skins: [s, ...st.skins.filter((x) => x.id !== s.id)] }));

  return {
    accounts: [],
    skins: [],
    previewId: null,
    login: null,
    loginError: null,
    busy: null,
    error: null,
    notice: null,

    active: () => get().accounts.find((a) => a.active) ?? null,

    load: async () => {
      if (!isTauri()) return;
      const [accounts, skins] = await Promise.all([api.listAccounts(), api.listSkins()]);
      const activeSkin = accounts.find((a) => a.active)?.skinId ?? null;
      set({ accounts, skins, previewId: get().previewId ?? activeSkin ?? skins[0]?.id ?? null });
    },

    addOffline: (name) => run("offline", async () => set({ accounts: await api.addOfflineAccount(name) })),
    setActive: (uuid) =>
      run("switch", async () => {
        const accounts = await api.setActiveAccount(uuid);
        set({ accounts, previewId: accounts.find((a) => a.active)?.skinId ?? get().previewId });
      }),
    remove: (uuid) => run("remove", async () => set({ accounts: await api.removeAccount(uuid) })),

    startLogin: async () => {
      set({ loginError: null });
      try {
        set({ login: await api.msLoginStart() });
      } catch (e) {
        set({ loginError: String(e) });
      }
    },
    cancelLogin: async () => {
      await api.msLoginCancel().catch(() => {});
      set({ login: null });
    },

    bindEvents: async () => {
      if (!isTauri()) return () => {};
      const un = await events.onMsLogin(async (e) => {
        if (e.status === "done") {
          set({ login: null, notice: `${e.username} hesabı eklendi` });
          await get().load();
          await get().syncAccountSkin();
        } else if (e.status === "error") {
          set({ loginError: e.message });
        }
      });
      return un;
    },

    setPreview: (previewId) => set({ previewId }),

    importFile: () =>
      run("import", async () => {
        const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "Minecraft skin", extensions: ["png"] }] });
        if (typeof path !== "string") return;
        let skin = await api.importSkinFile(path);
        const slim = await detectSlim(skin.dataUrl);
        if (slim !== skin.slim) skin = await api.updateSkin(skin.id, { slim });
        upsertSkin(skin);
        set({ previewId: skin.id, notice: `${skin.name} arşive eklendi (${slim ? "ince" : "klasik"} kol)` });
      }),

    importPlayer: (name) =>
      run("player", async () => {
        const skin = await api.importSkinPlayer(name);
        upsertSkin(skin);
        set({ previewId: skin.id, notice: `${name} oyuncusunun skini arşive eklendi` });
      }),

    toggleFavorite: async (s) => upsertSkin(await api.updateSkin(s.id, { favorite: !s.favorite })),
    setSlim: async (s, slim) => upsertSkin(await api.updateSkin(s.id, { slim })),
    rename: async (s, name) => upsertSkin(await api.updateSkin(s.id, { name })),

    removeSkin: (s) =>
      run("delete", async () => {
        await api.deleteSkin(s.id);
        set((st) => ({ skins: st.skins.filter((x) => x.id !== s.id), previewId: st.previewId === s.id ? null : st.previewId }));
      }),

    apply: (s) =>
      run("apply", async () => {
        const acc = get().active();
        if (!acc) throw new Error("Önce bir hesap ekle veya seç");
        const r = await api.applySkin(s.id, acc.uuid);
        set({
          accounts: r.accounts,
          notice: r.uploaded
            ? `${s.name} Microsoft hesabına yüklendi; oyunda ve sunucularda birkaç dakika içinde görünür.`
            : `${s.name} ${acc.username} için etkin skin oldu.`,
        });
        await get().load();
      }),

    syncAccountSkin: async () => {
      const acc = get().active();
      if (!acc || acc.kind !== "microsoft") return;
      const skin = await api.accountSkin(acc.uuid).catch(() => null);
      if (skin) {
        upsertSkin(skin);
        set({ previewId: skin.id });
      }
    },

    clearMessages: () => set({ error: null, notice: null }),
  };
});
