/**
 * Dünya davetleri: arkadaşın oyunda "Dünyayı paylaş" dediğinde sana bir mesaj olarak gelir
 * ("[west-davet] {json}"). Launcher bunları birkaç saniyede bir yoklar, sağ altta kart olarak gösterir;
 * karta tıklayınca hangi instance ile katılacağını seçersin ve oyun doğrudan arkadaşının dünyasına bağlanır.
 */
import { create } from "zustand";
import { api, isTauri } from "@/lib/ipc";
import { profilesByIds, type Profile } from "@/lib/social";
import { useWest } from "./west";

export const INVITE_TAG = "[west-davet]";

export interface WorldInvite {
  id: string;
  conversationId: string;
  from: Profile | null;
  fromId: string;
  world: string;
  address: string;
  /** "tunnel" (her ağdan), "upnp" (modem portu), "lan" (yalnızca aynı ağ) */
  kind: string;
  /** Davet edenin Minecraft sürümü ("" = eski davet, bilinmiyor) */
  version: string;
  loader: string;
  /** Offline (Microsoft'suz) hesaplar da girebilir mi */
  offline: boolean;
  at: string;
}

/** Mesaj gövdesi bir davet mi? Öyleyse içeriğini çöz. */
export function parseInvite(body: string | null | undefined): Omit<WorldInvite, "id" | "conversationId" | "from" | "fromId" | "at"> | null {
  if (!body || !body.startsWith(INVITE_TAG)) return null;
  try {
    const d = JSON.parse(body.slice(INVITE_TAG.length).trim()) as Record<string, unknown>;
    const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
    if (!s("address")) return null;
    return { world: s("world") || "Dünya", address: s("address"), kind: s("kind"), version: s("version"), loader: s("loader"), offline: d.offline === true };
  } catch {
    return null;
  }
}

/** Davetler bu süreden eskiyse gösterilmez (dünya büyük ihtimalle kapanmıştır) */
const FRESH_MS = 2 * 60 * 60 * 1000;
const SEEN_KEY = "west.invites.handled";

function loadHandled(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveHandled(s: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s].slice(-200)));
  } catch { /* depolama yoksa bu oturumla sınırlı */ }
}

interface InvitesState {
  /** Yanıt bekleyen (kart olarak gösterilen) davetler, yeniden eskiye */
  pending: WorldInvite[];
  /** Instance seçme penceresi açık olan davet */
  joining: WorldInvite | null;
  handled: Set<string>;
  poll: () => Promise<void>;
  open: (inv: WorldInvite) => void;
  close: () => void;
  dismiss: (id: string) => void;
}

export const useInvites = create<InvitesState>((set, get) => ({
  pending: [],
  joining: null,
  handled: loadHandled(),

  poll: async () => {
    const acc = useWest.getState().account;
    if (!acc || !isTauri()) return set({ pending: [] });
    const since = new Date(Date.now() - FRESH_MS).toISOString();
    const rows = await api
      .westApi<{ id: string; conversation_id: string; sender_id: string; body: string | null; created_at: string }[]>("GET", "/rest/v1/messages", {
        query: [
          ["select", "id,conversation_id,sender_id,body,created_at"],
          ["body", `like.${INVITE_TAG}*`],
          ["sender_id", `neq.${acc.userId}`],
          ["created_at", `gt.${since}`],
          ["order", "created_at.desc"],
          ["limit", "20"],
        ],
      })
      .catch(() => null);
    if (!rows) return;
    const handled = get().handled;
    const fresh = rows.filter((r) => !handled.has(r.id));
    const people = fresh.length ? await profilesByIds([...new Set(fresh.map((r) => r.sender_id))]).catch(() => [] as Profile[]) : [];
    const pending: WorldInvite[] = [];
    const seenSender = new Set<string>();
    for (const r of fresh) {
      const d = parseInvite(r.body);
      // Aynı kişiden yalnızca en yeni davet
      if (!d || seenSender.has(r.sender_id)) continue;
      seenSender.add(r.sender_id);
      pending.push({ ...d, id: r.id, conversationId: r.conversation_id, fromId: r.sender_id, from: people.find((p) => p.id === r.sender_id) ?? null, at: r.created_at });
    }
    set({ pending });
  },

  open: (inv) => set({ joining: inv }),
  close: () => set({ joining: null }),

  dismiss: (id) => {
    const handled = new Set(get().handled);
    handled.add(id);
    saveHandled(handled);
    set((s) => ({ handled, pending: s.pending.filter((p) => p.id !== id), joining: s.joining?.id === id ? null : s.joining }));
  },
}));

/** Davetleri yoklamaya başla (uygulama açılınca bir kez) */
let timer: number | undefined;
export function startInvitePolling() {
  if (timer) return;
  const tick = () => void useInvites.getState().poll();
  tick();
  timer = window.setInterval(tick, 8000);
  // Hesap değişince hemen yokla
  useWest.subscribe((s, prev) => {
    if (s.account?.userId !== prev.account?.userId) tick();
  });
}
