/**
 * West profili: ad, fotoğraf, banner, biyografi ve bağlantılar. İstekler Rust tarafındaki kısıtlı
 * kapıdan (west_api) geçer; kişi yalnızca kendi profilini değiştirebilir (Supabase kuralları).
 */
import { api } from "./ipc";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  website: string | null;
  location: string | null;
  links: { label: string; url: string }[];
  mc_username: string | null;
  verified: boolean;
  created_at: string;
}

const R = (t: string) => `/rest/v1/${t}`;
/** Kullanıcı metnini filtre ifadesine koymadan önce özel karakterlerden arındır */
const clean = (q: string) => q.replace(/[,()*"\\:.%]/g, " ").trim().slice(0, 60);

export const profileByUsername = async (username: string) =>
  (await api.westApi<Profile[]>("GET", R("profiles"), { query: [["username", `ilike.${clean(username)}`], ["limit", "1"]] }))[0] ?? null;

export const updateProfile = (id: string, patch: Partial<Profile>) =>
  api.westApi<Profile[]>("PATCH", R("profiles"), { query: [["id", `eq.${id}`]], body: patch, prefer: "return=representation" });
