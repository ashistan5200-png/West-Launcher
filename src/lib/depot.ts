/**
 * West Depo istemcisi: Onaylı oyuncuların paylaştığı modlar, kaynak paketleri, shader'lar, dünyalar,
 * şematikler… ve West rolleri (Üye, Onaylı, Moderatör, Yönetici). Kimin ne yapabileceğini
 * Supabase'teki kurallar (supabase/depot.sql) belirler; buradaki kontroller yalnızca arayüz içindir.
 */
import { api } from "./ipc";
import { tx } from "@/lib/i18n";

export type Role = "member" | "approved" | "moderator" | "admin";
export const ROLES: Role[] = ["member", "approved", "moderator", "admin"];
export const roleRank = (r: Role | null | undefined) => (r === "admin" ? 3 : r === "moderator" ? 2 : r === "approved" ? 1 : 0);
export const ROLE_LABEL: Record<Role, string> = {
  member: tx("Üye"),
  approved: tx("Onaylı"),
  moderator: tx("Moderatör"),
  admin: tx("Yönetici"),
};

export type DepotKind = "mod" | "resourcepack" | "shader" | "world" | "schematic" | "datapack" | "modpack" | "other";
export const DEPOT_KINDS: DepotKind[] = ["mod", "resourcepack", "shader", "world", "schematic", "datapack", "modpack", "other"];
export const KIND_LABEL: Record<DepotKind, string> = {
  mod: tx("Mod"),
  resourcepack: tx("Kaynak paketi"),
  shader: tx("Shader"),
  world: tx("Dünya"),
  schematic: tx("Şematik"),
  datapack: tx("Veri paketi"),
  modpack: tx("Modpack"),
  other: tx("Diğer"),
};
/** Kurulunca nereye gider (kullanıcıya gösterilir) */
export const KIND_PLACE: Record<DepotKind, string> = {
  mod: "mods/",
  resourcepack: "resourcepacks/",
  shader: "shaderpacks/",
  world: "saves/",
  schematic: "schematics/",
  datapack: "saves/<dünya>/datapacks/",
  modpack: tx("İndirilenler klasörü"),
  other: tx("İndirilenler klasörü"),
};
/** Instance'a kurulabilen türler (diğerleri İndirilenler'e kaydedilir) */
export const needsInstance = (k: DepotKind) => k !== "modpack" && k !== "other";

export interface DepotItem {
  id: string; author_id: string; kind: DepotKind; title: string; summary: string; description: string; version: string;
  mc_versions: string[]; loaders: string[]; icon_url: string | null; file_path: string; file_name: string; file_size: number; sha256: string;
  downloads: number; removed: boolean; removed_reason: string | null; created_at: string; updated_at: string;
  username: string; display_name: string | null; avatar_url: string | null; verified: boolean; author_role: Role;
}
export interface DepotInspect {
  kind: DepotKind; fileName: string; size: number; sha256: string; title: string | null; version: string | null;
  mcVersions: string[]; loaders: string[]; warnings: string[];
}
export interface DepotUploaded { filePath: string; fileName: string; fileSize: number; sha256: string; kind: DepotKind }
export interface RoleRequest { id: string; user_id: string; message: string; status: "pending" | "approved" | "declined"; created_at: string; decided_at: string | null }
export interface MiniProfile { id: string; username: string; display_name: string | null; avatar_url: string | null; role: Role; verified: boolean }
export interface DepotReport { id: string; reporter_id: string; target_id: string; reason: string; created_at: string; resolved: boolean }

const R = (t: string) => `/rest/v1/${t}`;
const clean = (q: string) => q.replace(/[,()*"\\:.%]/g, " ").trim().slice(0, 60);
const inList = (ids: string[]) => `in.(${ids.map((i) => `"${i}"`).join(",")})`;

export const myRole = async (userId: string): Promise<Role> =>
  ((await api.westApi<{ role: Role }[]>("GET", R("profiles"), { query: [["id", `eq.${userId}`], ["select", "role"]] }))[0]?.role ?? "member");

export const PAGE = 24;
export async function listItems(o: { kind: DepotKind | "all"; q: string; sort: "new" | "popular"; page: number; author?: string; removed?: boolean }) {
  const query: [string, string][] = [["order", o.sort === "popular" ? "downloads.desc,created_at.desc" : "created_at.desc"], ["limit", String(PAGE)], ["offset", String(o.page * PAGE)]];
  if (o.kind !== "all") query.push(["kind", `eq.${o.kind}`]);
  if (o.author) query.push(["author_id", `eq.${o.author}`]);
  else query.push(["removed", `eq.${o.removed ? "true" : "false"}`]);
  const c = clean(o.q);
  if (c) query.push(["or", `(title.ilike.*${c}*,summary.ilike.*${c}*,username.ilike.*${c}*)`]);
  const r = await api.westApi<{ data: DepotItem[]; total: number } | DepotItem[]>("GET", R("depot_view"), { query, prefer: "count=exact" });
  return Array.isArray(r) ? { data: r, total: r.length } : r;
}
export const getItem = async (id: string) => (await api.westApi<DepotItem[]>("GET", R("depot_view"), { query: [["id", `eq.${id}`]] }))[0] ?? null;

export interface NewItem { kind: DepotKind; title: string; summary: string; description: string; version: string; mc_versions: string[]; loaders: string[]; icon_url: string | null; file_path: string; file_name: string; file_size: number; sha256: string }
export const createItem = async (it: NewItem) => (await api.westApi<DepotItem[]>("POST", R("depot_items"), { body: it, prefer: "return=representation" }))[0];
export const updateItem = (id: string, patch: Partial<Pick<DepotItem, "title" | "summary" | "description" | "version" | "mc_versions" | "loaders" | "icon_url">>) =>
  api.westApi("PATCH", R("depot_items"), { query: [["id", `eq.${id}`]], body: patch });
export async function deleteItem(it: Pick<DepotItem, "id" | "file_path">) {
  await api.westApi("DELETE", R("depot_items"), { query: [["id", `eq.${it.id}`]] });
  await api.depotDeleteFile(it.file_path).catch(() => {});
}
export const moderate = (id: string, remove: boolean, reason: string | null) => api.westApi("POST", R("rpc/depot_moderate"), { body: { p_item: id, p_remove: remove, p_reason: reason } });
export const report = (id: string, reason: string) => api.westApi("POST", R("reports"), { body: { target_type: "depot", target_id: id, reason } });

// ───────── Roller ─────────
export const requestApproval = (message: string) => api.westApi("POST", R("rpc/request_approval"), { body: { p_message: message } });
export const myRequests = (userId: string) =>
  api.westApi<RoleRequest[]>("GET", R("role_requests"), { query: [["user_id", `eq.${userId}`], ["order", "created_at.desc"], ["limit", "1"]] });
export const pendingRequests = () => api.westApi<RoleRequest[]>("GET", R("role_requests"), { query: [["status", "eq.pending"], ["order", "created_at.asc"], ["limit", "50"]] });
export const answerRequest = (id: string, approve: boolean) => api.westApi("POST", R("rpc/answer_role_request"), { body: { p_id: id, p_approve: approve } });
export const setRole = (userId: string, role: Role, reason?: string) => api.westApi("POST", R("rpc/set_role"), { body: { p_user: userId, p_role: role, p_reason: reason ?? null } });
export const profiles = (ids: string[]) =>
  ids.length ? api.westApi<MiniProfile[]>("GET", R("profiles"), { query: [["id", inList([...new Set(ids)])], ["select", "id,username,display_name,avatar_url,role,verified"]] }) : Promise.resolve([] as MiniProfile[]);
export const searchUsers = (q: string) =>
  api.westApi<MiniProfile[]>("GET", R("profiles"), { query: [["or", `(username.ilike.*${clean(q)}*,display_name.ilike.*${clean(q)}*)`], ["select", "id,username,display_name,avatar_url,role,verified"], ["limit", "20"]] });
export const staff = () =>
  api.westApi<MiniProfile[]>("GET", R("profiles"), { query: [["role", "neq.member"], ["select", "id,username,display_name,avatar_url,role,verified"], ["order", "username.asc"], ["limit", "200"]] });
export const openReports = () =>
  api.westApi<DepotReport[]>("GET", R("reports"), { query: [["target_type", "eq.depot"], ["resolved", "eq.false"], ["order", "created_at.desc"], ["limit", "50"]] });
export const resolveReports = (targetId: string) => api.westApi("PATCH", R("reports"), { query: [["target_type", "eq.depot"], ["target_id", `eq.${targetId}`]], body: { resolved: true } });
export const itemsByIds = (ids: string[]) => (ids.length ? api.westApi<DepotItem[]>("GET", R("depot_view"), { query: [["id", inList([...new Set(ids)])]] }) : Promise.resolve([] as DepotItem[]));

export const formatSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
