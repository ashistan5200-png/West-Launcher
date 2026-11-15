/**
 * West sosyal ağı istemcisi. Tüm istekler Rust tarafındaki kısıtlı kapıdan
 * (west_api) geçer; kim neyi görebilir/yapabilir Supabase'teki kurallarla belirlenir.
 */
import { api } from "./ipc";

export interface Profile {
  id: string; username: string; display_name: string | null; bio: string | null; avatar_url: string | null; banner_url: string | null;
  website: string | null; location: string | null; links: { label: string; url: string }[]; mc_username: string | null;
  is_private: boolean; verified: boolean; allow_dms: "everyone" | "followers" | "none"; pinned_post_id: string | null;
  followers_count: number; following_count: number; posts_count: number; created_at: string;
}
export interface Media { url: string; w?: number; h?: number; alt?: string }
export interface Poll { options: string[]; ends_at: string; counts: number[]; my_vote: number | null }
export interface Post {
  id: string; author_id: string; body: string | null; media: Media[]; reply_to: string | null; root_id: string | null;
  repost_of: string | null; quote_of: string | null; audience: "everyone" | "followers"; reply_policy: "everyone" | "following" | "mentioned";
  tags: string[]; mentions: string[]; like_count: number; reply_count: number; repost_count: number; quote_count: number;
  bookmark_count: number; view_count: number; created_at: string; edited_at: string | null;
  username: string; display_name: string | null; avatar_url: string | null; verified: boolean;
  liked: boolean; bookmarked: boolean; reposted: boolean; poll: Poll | null;
}
export interface Notification { id: string; type: string; actor_id: string; post_id: string | null; read: boolean; created_at: string; actor?: Profile; post?: Post | null }

const R = (t: string) => `/rest/v1/${t}`;
/** Kullanıcı metnini filtre ifadesine koymadan önce özel karakterlerden arındır */
const clean = (q: string) => q.replace(/[,()*"\\:.%]/g, " ").trim().slice(0, 60);
const eq = (v: string) => `eq.${v}`;
const inList = (ids: string[]) => `in.(${ids.map((i) => `"${i}"`).join(",")})`;

// ───────── Profil ─────────
export const profileByUsername = async (username: string) =>
  (await api.westApi<Profile[]>("GET", R("profiles"), { query: [["username", `ilike.${clean(username)}`], ["limit", "1"]] }))[0] ?? null;
export const profilesByIds = async (ids: string[]) =>
  ids.length ? api.westApi<Profile[]>("GET", R("profiles"), { query: [["id", inList([...new Set(ids)])]] }) : [];
export const updateProfile = (id: string, patch: Partial<Profile>) =>
  api.westApi<Profile[]>("PATCH", R("profiles"), { query: [["id", eq(id)]], body: patch, prefer: "return=representation" });
export const searchProfiles = (q: string, limit = 20) =>
  api.westApi<Profile[]>("GET", R("profiles"), { query: [["or", `(username.ilike.*${clean(q)}*,display_name.ilike.*${clean(q)}*)`], ["order", "followers_count.desc"], ["limit", String(limit)]] });
export const whoToFollow = (limit = 5) => api.westApi<Profile[]>("POST", R("rpc/who_to_follow"), { body: { p_limit: limit } });

// ───────── Gönderiler ─────────
const enrich = async (posts: Post[]): Promise<Post[]> => {
  // Yeniden paylaşılan / alıntılanan orijinalleri tek istekte getir
  const ids = posts.flatMap((p) => [p.repost_of, p.quote_of]).filter((x): x is string => !!x && !posts.some((p) => p.id === x));
  if (ids.length) {
    const extra = await api.westApi<Post[]>("GET", R("post_view"), { query: [["id", inList([...new Set(ids)])]] });
    cache.push(...extra);
  }
  cache.push(...posts);
  if (cache.length > 2000) cache.splice(0, cache.length - 2000);
  // Görüntülenme sayısı (arka planda)
  const fresh = posts.filter((p) => !viewed.has(p.id)).map((p) => p.repost_of ?? p.id);
  fresh.forEach((id) => viewed.add(id));
  if (fresh.length) void api.westApi("POST", R("rpc/add_views"), { body: { ids: fresh } }).catch(() => {});
  return posts;
};
const viewed = new Set<string>();
const cache: Post[] = [];
export const cachedPost = (id: string | null) => (id ? [...cache].reverse().find((p) => p.id === id) ?? null : null);

export const homeFeed = async (before?: string) => enrich(await api.westApi<Post[]>("POST", R("rpc/home_feed"), { body: { p_before: before ?? new Date().toISOString(), p_limit: 25 } }));
export const exploreFeed = async (offset = 0) => enrich(await api.westApi<Post[]>("POST", R("rpc/explore_feed"), { body: { p_offset: offset, p_limit: 25 } }));
export const latestFeed = async (before?: string) =>
  enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["reply_to", "is.null"], ["created_at", `lt.${before ?? new Date().toISOString()}`], ["order", "created_at.desc"], ["limit", "25"]] }));
export const userPosts = async (authorId: string, kind: "posts" | "replies" | "media" | "likes", before?: string) => {
  const b: [string, string] = ["created_at", `lt.${before ?? new Date().toISOString()}`];
  if (kind === "likes") {
    const likes = await api.westApi<{ post_id: string; created_at: string }[]>("GET", R("likes"), { query: [["user_id", eq(authorId)], b, ["order", "created_at.desc"], ["limit", "25"]] });
    if (!likes.length) return [];
    const posts = await api.westApi<Post[]>("GET", R("post_view"), { query: [["id", inList(likes.map((l) => l.post_id))]] });
    return enrich(likes.map((l) => posts.find((p) => p.id === l.post_id)).filter((p): p is Post => !!p));
  }
  const q: [string, string][] = [["author_id", eq(authorId)], b, ["order", "created_at.desc"], ["limit", "25"]];
  if (kind === "posts") q.push(["reply_to", "is.null"]);
  if (kind === "replies") q.push(["reply_to", "not.is.null"]);
  if (kind === "media") q.push(["media", "neq.[]"]);
  return enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: q }));
};
export const postById = async (id: string) => (await enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["id", eq(id)]] })))[0] ?? null;
export const replies = async (id: string) => enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["reply_to", eq(id)], ["order", "like_count.desc,created_at.asc"], ["limit", "100"]] }));
export const quotes = async (id: string) => enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["quote_of", eq(id)], ["order", "created_at.desc"], ["limit", "50"]] }));
export const tagPosts = async (tag: string, before?: string) =>
  enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["tags", `cs.{${clean(tag).toLowerCase()}}`], ["created_at", `lt.${before ?? new Date().toISOString()}`], ["order", "created_at.desc"], ["limit", "25"]] }));
export const searchPosts = async (q: string) =>
  enrich(await api.westApi<Post[]>("GET", R("post_view"), { query: [["body", `ilike.*${clean(q)}*`], ["order", "created_at.desc"], ["limit", "30"]] }));
export const bookmarks = async () => {
  const b = await api.westApi<{ post_id: string }[]>("GET", R("bookmarks"), { query: [["order", "created_at.desc"], ["limit", "100"]] });
  if (!b.length) return [];
  const posts = await api.westApi<Post[]>("GET", R("post_view"), { query: [["id", inList(b.map((x) => x.post_id))]] });
  return enrich(b.map((x) => posts.find((p) => p.id === x.post_id)).filter((p): p is Post => !!p));
};
export const trendingTags = () => api.westApi<{ tag: string; posts: number }[]>("POST", R("rpc/trending_tags"), { body: { p_limit: 10 } });

export interface NewPost { body?: string; media?: Media[]; reply_to?: string | null; quote_of?: string | null; audience?: Post["audience"]; reply_policy?: Post["reply_policy"]; poll?: { options: string[]; hours: number } | null }
export const createPost = async (p: NewPost) => {
  const { poll, ...row } = p;
  const [created] = await api.westApi<{ id: string }[]>("POST", R("posts"), { body: { ...row, body: row.body?.trim() || null }, prefer: "return=representation" });
  if (poll) {
    await api.westApi("POST", R("polls"), { body: { post_id: created.id, options: poll.options, ends_at: new Date(Date.now() + poll.hours * 3600e3).toISOString() } });
  }
  return postById(created.id);
};
export const editPost = (id: string, body: string) => api.westApi("PATCH", R("posts"), { query: [["id", eq(id)]], body: { body } });
export const deletePost = (id: string) => api.westApi("DELETE", R("posts"), { query: [["id", eq(id)]] });
export const setLike = (me: string, id: string, on: boolean) =>
  on ? api.westApi("POST", R("likes"), { body: { user_id: me, post_id: id } }) : api.westApi("DELETE", R("likes"), { query: [["user_id", eq(me)], ["post_id", eq(id)]] });
export const setBookmark = (me: string, id: string, on: boolean) =>
  on ? api.westApi("POST", R("bookmarks"), { body: { user_id: me, post_id: id } }) : api.westApi("DELETE", R("bookmarks"), { query: [["user_id", eq(me)], ["post_id", eq(id)]] });
export const setRepost = (me: string, id: string, on: boolean) =>
  on ? api.westApi("POST", R("posts"), { body: { repost_of: id } })
     : api.westApi("DELETE", R("posts"), { query: [["author_id", eq(me)], ["repost_of", eq(id)], ["body", "is.null"]] });
export const vote = (me: string, postId: string, option: number) => api.westApi("POST", R("poll_votes"), { body: { post_id: postId, user_id: me, option } });
export const pinPost = (me: string, id: string | null) => updateProfile(me, { pinned_post_id: id });

// ───────── Takip / engel / sessize al / şikâyet ─────────
export const followState = async (me: string, other: string) => {
  const rows = await api.westApi<{ follower_id: string; following_id: string; status: string }[]>("GET", R("follows"), {
    query: [["or", `(and(follower_id.eq.${me},following_id.eq.${other}),and(follower_id.eq.${other},following_id.eq.${me}))`]],
  });
  const out = rows.find((r) => r.follower_id === me);
  const inn = rows.find((r) => r.follower_id === other);
  return { following: out?.status ?? null, followsMe: inn?.status === "accepted" };
};
export const follow = (me: string, other: string) => api.westApi("POST", R("follows"), { body: { follower_id: me, following_id: other } });
export const unfollow = (me: string, other: string) => api.westApi("DELETE", R("follows"), { query: [["follower_id", eq(me)], ["following_id", eq(other)]] });
export const removeFollower = (me: string, other: string) => api.westApi("DELETE", R("follows"), { query: [["follower_id", eq(other)], ["following_id", eq(me)]] });
export const acceptFollow = (me: string, other: string) => api.westApi("PATCH", R("follows"), { query: [["follower_id", eq(other)], ["following_id", eq(me)]], body: { status: "accepted" } });
export const followList = async (userId: string, dir: "followers" | "following" | "requests") => {
  const col = dir === "following" ? "follower_id" : "following_id";
  const other = dir === "following" ? "following_id" : "follower_id";
  const rows = await api.westApi<Record<string, string>[]>("GET", R("follows"), { query: [[col, eq(userId)], ["status", dir === "requests" ? "eq.pending" : "eq.accepted"], ["order", "created_at.desc"], ["limit", "200"]] });
  return profilesByIds(rows.map((r) => r[other]));
};
export const isBlocked = async (me: string, other: string) => (await api.westApi<unknown[]>("GET", R("blocks"), { query: [["blocker_id", eq(me)], ["blocked_id", eq(other)]] })).length > 0;
export const setBlock = (me: string, other: string, on: boolean) =>
  on ? api.westApi("POST", R("blocks"), { body: { blocker_id: me, blocked_id: other } }) : api.westApi("DELETE", R("blocks"), { query: [["blocker_id", eq(me)], ["blocked_id", eq(other)]] });
export const isMuted = async (me: string, other: string) => (await api.westApi<unknown[]>("GET", R("mutes"), { query: [["muter_id", eq(me)], ["muted_id", eq(other)]] })).length > 0;
export const setMute = (me: string, other: string, on: boolean) =>
  on ? api.westApi("POST", R("mutes"), { body: { muter_id: me, muted_id: other } }) : api.westApi("DELETE", R("mutes"), { query: [["muter_id", eq(me)], ["muted_id", eq(other)]] });
export const report = (targetType: "post" | "profile" | "message" | "story", targetId: string, reason: string) =>
  api.westApi("POST", R("reports"), { body: { target_type: targetType, target_id: targetId, reason } });

// ───────── Bildirimler ─────────
export const notifications = async () => {
  const list = await api.westApi<Notification[]>("GET", R("notifications"), { query: [["order", "created_at.desc"], ["limit", "80"]] });
  const actors = await profilesByIds(list.map((n) => n.actor_id));
  const postIds = [...new Set(list.map((n) => n.post_id).filter((x): x is string => !!x))];
  const posts = postIds.length ? await api.westApi<Post[]>("GET", R("post_view"), { query: [["id", inList(postIds)]] }) : [];
  return list.map((n) => ({ ...n, actor: actors.find((a) => a.id === n.actor_id), post: posts.find((p) => p.id === n.post_id) ?? null }));
};
export const markAllRead = (me: string) => api.westApi("PATCH", R("notifications"), { query: [["user_id", eq(me)], ["read", "eq.false"]], body: { read: true } });
export const unreadCounts = () => api.westApi<{ notifications: number; messages: number }>("POST", R("rpc/unread_counts"), { body: {} });

// ───────── Mesajlar (DM) ─────────
export interface Message { id: string; conversation_id: string; sender_id: string; body: string | null; media: Media[]; reply_to: string | null; created_at: string }
export interface Conversation { id: string; is_group: boolean; title: string | null; last_message_at: string; members: { user_id: string; last_read_at: string }[]; others: Profile[]; last: Message | null; unread: boolean }

export const startDm = (other: string) => api.westApi<string>("POST", R("rpc/start_dm"), { body: { other } });
export const conversations = async (me: string): Promise<Conversation[]> => {
  const mine = await api.westApi<{ conversation_id: string; last_read_at: string }[]>("GET", R("conversation_members"), { query: [["user_id", eq(me)]] });
  if (!mine.length) return [];
  const ids = mine.map((m) => m.conversation_id);
  const [convs, members] = await Promise.all([
    api.westApi<{ id: string; is_group: boolean; title: string | null; last_message_at: string }[]>("GET", R("conversations"), { query: [["id", inList(ids)], ["order", "last_message_at.desc"]] }),
    api.westApi<{ conversation_id: string; user_id: string; last_read_at: string }[]>("GET", R("conversation_members"), { query: [["conversation_id", inList(ids)]] }),
  ]);
  const people = await profilesByIds(members.filter((m) => m.user_id !== me).map((m) => m.user_id));
  const lasts = await Promise.all(convs.map((c) => api.westApi<Message[]>("GET", R("messages"), { query: [["conversation_id", eq(c.id)], ["order", "created_at.desc"], ["limit", "1"]] }).then((x) => x[0] ?? null).catch(() => null)));
  return convs.map((c, i) => {
    const ms = members.filter((m) => m.conversation_id === c.id);
    const myRead = mine.find((m) => m.conversation_id === c.id)?.last_read_at ?? c.last_message_at;
    const last = lasts[i];
    return {
      ...c,
      members: ms,
      others: people.filter((p) => ms.some((m) => m.user_id === p.id)),
      last,
      unread: !!last && last.sender_id !== me && new Date(last.created_at) > new Date(myRead),
    };
  });
};
export const messages = (conv: string, before?: string) =>
  api.westApi<Message[]>("GET", R("messages"), { query: [["conversation_id", eq(conv)], ["created_at", `lt.${before ?? new Date(Date.now() + 60000).toISOString()}`], ["order", "created_at.desc"], ["limit", "50"]] }).then((m) => m.reverse());
export const newerMessages = (conv: string, after: string) =>
  api.westApi<Message[]>("GET", R("messages"), { query: [["conversation_id", eq(conv)], ["created_at", `gt.${after}`], ["order", "created_at.asc"], ["limit", "100"]] });
export const sendMessage = async (conv: string, body: string, media: Media[] = [], replyTo: string | null = null) =>
  (await api.westApi<Message[]>("POST", R("messages"), { body: { conversation_id: conv, body: body.trim() || null, media, reply_to: replyTo }, prefer: "return=representation" }))[0];
export const deleteMessage = (id: string) => api.westApi("DELETE", R("messages"), { query: [["id", eq(id)]] });
export const markConversationRead = (conv: string, me: string) =>
  api.westApi("PATCH", R("conversation_members"), { query: [["conversation_id", eq(conv)], ["user_id", eq(me)]], body: { last_read_at: new Date().toISOString() } });
export const conversationMembers = (conv: string) =>
  api.westApi<{ conversation_id: string; user_id: string; last_read_at: string }[]>("GET", R("conversation_members"), { query: [["conversation_id", eq(conv)]] });
export const leaveConversation = (conv: string, me: string) => api.westApi("DELETE", R("conversation_members"), { query: [["conversation_id", eq(conv)], ["user_id", eq(me)]] });

// ───────── Hikâyeler ─────────
export interface Story { id: string; author_id: string; media_url: string; caption: string | null; created_at: string; expires_at: string }
export interface StoryGroup { author: Profile; stories: Story[]; seen: boolean }
export const storyGroups = async (me: string | null): Promise<StoryGroup[]> => {
  const list = await api.westApi<Story[]>("GET", R("stories"), { query: [["expires_at", `gt.${new Date().toISOString()}`], ["order", "created_at.asc"], ["limit", "300"]] });
  if (!list.length) return [];
  const [authors, views] = await Promise.all([
    profilesByIds(list.map((s) => s.author_id)),
    me ? api.westApi<{ story_id: string }[]>("GET", R("story_views"), { query: [["viewer_id", eq(me)], ["story_id", inList(list.map((s) => s.id))]] }) : Promise.resolve([]),
  ]);
  const seen = new Set(views.map((v) => v.story_id));
  const groups = authors.map((a) => {
    const stories = list.filter((s) => s.author_id === a.id);
    return { author: a, stories, seen: stories.every((s) => seen.has(s.id)) };
  });
  // Kendi hikâyen önce, sonra görülmemişler, en yeniler
  return groups.sort((x, y) => Number(y.author.id === me) - Number(x.author.id === me) || Number(x.seen) - Number(y.seen)
    || new Date(y.stories[y.stories.length - 1].created_at).getTime() - new Date(x.stories[x.stories.length - 1].created_at).getTime());
};
export const createStory = (mediaUrl: string, caption: string) => api.westApi("POST", R("stories"), { body: { media_url: mediaUrl, caption: caption.trim() || null } });
export const deleteStory = (id: string) => api.westApi("DELETE", R("stories"), { query: [["id", eq(id)]] });
export const markStorySeen = (id: string) => api.westApi("POST", R("story_views"), { body: { story_id: id }, prefer: "resolution=ignore-duplicates" }).catch(() => {});
export const storyViewers = async (id: string) => {
  const v = await api.westApi<{ viewer_id: string; viewed_at: string }[]>("GET", R("story_views"), { query: [["story_id", eq(id)], ["order", "viewed_at.desc"]] });
  const ps = await profilesByIds(v.map((x) => x.viewer_id));
  return v.map((x) => ({ ...x, profile: ps.find((p) => p.id === x.viewer_id) })).filter((x) => x.profile);
};

// ───────── Gizlilik listeleri ─────────
export const blockedList = async (me: string) => profilesByIds((await api.westApi<{ blocked_id: string }[]>("GET", R("blocks"), { query: [["blocker_id", eq(me)]] })).map((b) => b.blocked_id));
export const mutedList = async (me: string) => profilesByIds((await api.westApi<{ muted_id: string }[]>("GET", R("mutes"), { query: [["muter_id", eq(me)]] })).map((b) => b.muted_id));
