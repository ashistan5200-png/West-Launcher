import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NavLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  ArrowLeft, AtSign, BadgeCheck, Bell, Bookmark, CalendarDays, Check, ChevronLeft, ChevronRight, Flag, Globe2, Hash, Heart, Home, ImagePlus,
  Link2, Loader2, Lock, Mail, MapPin, MessageCircle, MoreHorizontal, PenSquare, Quote, Repeat2, Search, Shield, UserCheck, UserPlus, UserRound, UserX, VolumeX, X,
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import * as S from "@/lib/social";
import type { Post, Profile } from "@/lib/social";
import { useWest } from "@/stores/west";
import { useSocial } from "@/stores/social";
import { pickCropped } from "@/components/ImageCropper";
import { Avatar, PostCard, RichText, ago } from "@/components/social/PostCard";
import { Composer, ComposeModal } from "@/components/social/Composer";
import { WestAccountCard } from "@/components/WestAccountCard";
import { StoriesBar } from "@/components/social/Stories";
import { MessagesView } from "@/components/social/Messages";
import { Modal } from "@/components/Modal";
import { Menu } from "@/components/instance/Menu";
import { formatCount } from "@/lib/format";

const err = (e: unknown) => String(e).replace(/^Error: /, "");

// ───────── Ortak düzen ─────────
export function SocialLayout({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const account = useWest((s) => s.account);
  const loaded = useWest((s) => s.loaded);
  const { me, loadMe, unread, refreshUnread, openCompose } = useSocial();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  useEffect(() => { if (account && !me) void loadMe(); }, [account, me, loadMe]);
  useEffect(() => {
    void refreshUnread();
    const t = window.setInterval(() => void refreshUnread(), 30000);
    return () => window.clearInterval(t);
  }, [refreshUnread, account]);

  if (loaded && !account) {
    return (
      <div className="s-gate">
        <h1>West sosyal</h1>
        <p className="muted">Gönderi paylaşmak, takip etmek ve profil oluşturmak için bir West hesabıyla giriş yap.</p>
        <div style={{ width: "min(460px, 100%)" }}><WestAccountCard /></div>
      </div>
    );
  }
  const nav = [
    { to: "/social", icon: Home, label: "Akış", end: true },
    { to: "/social/search", icon: Search, label: "Keşfet" },
    { to: "/social/notifications", icon: Bell, label: "Bildirimler", badge: unread.notifications },
    { to: "/social/messages", icon: Mail, label: "Mesajlar", badge: unread.messages },
    { to: "/social/bookmarks", icon: Bookmark, label: "Yer imleri" },
    ...(me ? [{ to: `/u/${me.username}`, icon: UserRound, label: "Profil" }] : []),
    { to: "/social/settings", icon: Shield, label: "Gizlilik" },
  ];
  return (
    <div className={clsx("s-layout", wide && "wide")}>
      <aside className="s-nav">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => clsx("s-nav-item", isActive && "on")}>
            <n.icon size={20} /> <span>{n.label}</span>
            {!!n.badge && <em className="s-badge">{n.badge > 99 ? "99+" : n.badge}</em>}
          </NavLink>
        ))}
        <button className="btn btn-primary s-post-btn" onClick={() => openCompose()}><PenSquare size={17} /> <span>Gönderi paylaş</span></button>
        {me && (
          <button className="s-me" onClick={() => navigate(`/u/${me.username}`)}>
            <Avatar url={me.avatar_url} name={me.username} size={36} />
            <span className="grow" style={{ minWidth: 0 }}><strong className="truncate">{me.display_name || me.username}</strong><span className="muted tiny truncate">@{me.username}</span></span>
          </button>
        )}
      </aside>
      <main className="s-center">{children}</main>
      {!wide && <aside className="s-rail">
        <form className="s-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/social/search?q=${encodeURIComponent(q.trim())}`); }}>
          <Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="West'te ara" />
        </form>
        <Trending />
        <WhoToFollow />
      </aside>}
      <ComposeModal />
    </div>
  );
}

function Trending() {
  const [tags, setTags] = useState<{ tag: string; posts: number }[] | null>(null);
  const navigate = useNavigate();
  useEffect(() => { S.trendingTags().then(setTags).catch(() => setTags([])); }, []);
  if (!tags?.length) return null;
  return (
    <section className="s-box">
      <h3>Gündem</h3>
      {tags.map((t, i) => (
        <button key={t.tag} className="s-trend" onClick={() => navigate(`/social/tag/${encodeURIComponent(t.tag)}`)}>
          <span className="muted tiny">{i + 1} · Gündemde</span>
          <strong>#{t.tag}</strong>
          <span className="muted tiny">{formatCount(t.posts)} gönderi</span>
        </button>
      ))}
    </section>
  );
}

function WhoToFollow() {
  const [list, setList] = useState<Profile[] | null>(null);
  const me = useWest((s) => s.account);
  useEffect(() => { S.whoToFollow(4).then(setList).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  return (
    <section className="s-box">
      <h3>Kimi takip etmeli</h3>
      {list.map((p) => <UserRow key={p.id} p={p} me={me?.userId} />)}
    </section>
  );
}

export function UserRow({ p, me, extra }: { p: Profile; me?: string; extra?: ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<"none" | "accepted" | "pending">("none");
  return (
    <div className="s-user" onClick={() => navigate(`/u/${p.username}`)}>
      <Avatar url={p.avatar_url} name={p.username} size={40} />
      <div className="grow" style={{ minWidth: 0 }}>
        <strong className="truncate row" style={{ gap: 4 }}>{p.display_name || p.username}{p.verified && <BadgeCheck size={14} className="s-verified" />}</strong>
        <span className="muted tiny truncate">@{p.username}</span>
        {p.bio && <span className="tiny clamp-2">{p.bio}</span>}
      </div>
      {extra}
      {me && me !== p.id && !extra && (
        <button className={clsx("btn btn-sm", state === "none" ? "btn-primary" : "btn-ghost")} onClick={async (e) => {
          e.stopPropagation();
          if (state === "none") { await S.follow(me, p.id); setState(p.is_private ? "pending" : "accepted"); }
          else { await S.unfollow(me, p.id); setState("none"); }
        }}>{state === "none" ? "Takip et" : state === "pending" ? "İstek gönderildi" : "Takip ediliyor"}</button>
      )}
    </div>
  );
}

// ───────── Akış listesi (sonsuz kaydırma) ─────────
function PostList({ load, empty, deps = [] }: { load: (cursor: Post | null, n: number) => Promise<Post[]>; empty: ReactNode; deps?: unknown[] }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ m: S.Media[]; i: number } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const reset = useCallback(async () => {
    setPosts(null);
    setMore(true);
    setError(null);
    try {
      const p = await load(null, 0);
      setPosts(p);
      setMore(p.length >= 20);
    } catch (e) {
      setError(err(e));
      setPosts([]);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void reset(); }, [reset]);
  useEffect(() => {
    const h = () => void reset();
    window.addEventListener("west:posted", h);
    return () => window.removeEventListener("west:posted", h);
  }, [reset]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || busy || !more || !posts?.length) return;
      setBusy(true);
      try {
        const next = await load(posts[posts.length - 1], posts.length);
        const seen = new Set(posts.map((p) => p.id));
        setPosts([...posts, ...next.filter((p) => !seen.has(p.id))]);
        setMore(next.length >= 20);
      } catch { setMore(false); } finally { setBusy(false); }
    }, { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [posts, more, busy, load]);

  return (
    <>
      {error && <div className="banner banner-error">{error}</div>}
      {posts === null ? <div className="center pad muted"><Loader2 size={20} className="spin" /></div>
        : posts.length === 0 ? <div className="s-empty">{empty}</div>
        : posts.map((p) => <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((x) => x?.filter((y) => y.id !== id) ?? null)} onOpenMedia={(m, i) => setViewer({ m, i })} />)}
      <div ref={sentinel} />
      {busy && <div className="center pad muted"><Loader2 size={16} className="spin" /></div>}
      <MediaViewer v={viewer} onClose={() => setViewer(null)} />
    </>
  );
}

export function MediaViewer({ v, onClose }: { v: { m: S.Media[]; i: number } | null; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (v) setI(v.i); }, [v]);
  useEffect(() => {
    if (!v) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => (x + 1) % v.m.length);
      if (e.key === "ArrowLeft") setI((x) => (x - 1 + v.m.length) % v.m.length);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [v, onClose]);
  return (
    <AnimatePresence>
      {v && (
        <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          {v.m.length > 1 && <button className="lb-nav left" onMouseDown={(e) => { e.stopPropagation(); setI((i - 1 + v.m.length) % v.m.length); }}><ChevronLeft size={28} /></button>}
          <figure onMouseDown={(e) => e.stopPropagation()}><img src={v.m[i]?.url} alt="" referrerPolicy="no-referrer" />{v.m.length > 1 && <figcaption><small className="muted">{i + 1} / {v.m.length}</small></figcaption>}</figure>
          {v.m.length > 1 && <button className="lb-nav right" onMouseDown={(e) => { e.stopPropagation(); setI((i + 1) % v.m.length); }}><ChevronRight size={28} /></button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────── Akış ─────────
export function SocialFeedPage() {
  const [tab, setTab] = useState<"foryou" | "following" | "latest">("foryou");
  const load = useCallback(
    (c: Post | null, n: number) => (tab === "foryou" ? S.exploreFeed(n) : tab === "following" ? S.homeFeed(c?.created_at) : S.latestFeed(c?.created_at)),
    [tab],
  );
  return (
    <SocialLayout>
      <div className="s-tabs sticky">
        {([["foryou", "Senin için"], ["following", "Takip edilenler"], ["latest", "En yeni"]] as const).map(([k, l]) => (
          <button key={k} className={clsx(tab === k && "on")} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <StoriesBar />
      <Composer onPosted={() => window.dispatchEvent(new CustomEvent("west:posted"))} />
      <PostList load={load} deps={[tab]} empty={tab === "following" ? <><UserPlus size={26} /><p>Takip ettiğin kişilerin gönderileri burada görünür. Sağdaki önerilerden birini takip et!</p></> : <><Globe2 size={26} /><p>Henüz gönderi yok. İlk paylaşan sen ol!</p></>} />
    </SocialLayout>
  );
}

// ───────── Bildirimler ─────────
const N_TEXT: Record<string, string> = {
  like: "gönderini beğendi", reply: "gönderine yanıt verdi", repost: "gönderini yeniden paylaştı", quote: "gönderini alıntıladı",
  mention: "senden bahsetti", follow: "seni takip etmeye başladı", follow_request: "seni takip etmek istiyor", follow_accept: "takip isteğini kabul etti",
  message: "sana mesaj gönderdi", poll_vote: "anketine oy verdi",
};
const N_ICON: Record<string, typeof Heart> = { like: Heart, reply: MessageCircle, repost: Repeat2, quote: Quote, mention: AtSign, follow: UserPlus, follow_request: Lock, follow_accept: UserCheck, message: MessageCircle, poll_vote: Check };

export function NotificationsPage() {
  const me = useWest((s) => s.account);
  const refreshUnread = useSocial((s) => s.refreshUnread);
  const navigate = useNavigate();
  const [list, setList] = useState<S.Notification[] | null>(null);
  const [requests, setRequests] = useState<Profile[]>([]);
  const [tab, setTab] = useState<"all" | "mentions">("all");
  useEffect(() => {
    if (!me) return;
    S.notifications().then(setList).catch(() => setList([]));
    S.followList(me.userId, "requests").then(setRequests).catch(() => {});
    void S.markAllRead(me.userId).then(() => refreshUnread()).catch(() => {});
  }, [me, refreshUnread]);
  const shown = (list ?? []).filter((n) => tab === "all" || n.type === "mention" || n.type === "reply");
  return (
    <SocialLayout>
      <div className="s-tabs sticky">
        <button className={clsx(tab === "all" && "on")} onClick={() => setTab("all")}>Tümü</button>
        <button className={clsx(tab === "mentions" && "on")} onClick={() => setTab("mentions")}>Bahsetmeler ve yanıtlar</button>
      </div>
      {requests.length > 0 && (
        <section className="s-requests">
          <h3><Lock size={15} /> Takip istekleri ({requests.length})</h3>
          {requests.map((p) => (
            <UserRow key={p.id} p={p} extra={
              <div className="row" style={{ gap: 6 }} onClick={(e) => e.stopPropagation()}>
                <button className="btn btn-primary btn-sm" onClick={async () => { await S.acceptFollow(me!.userId, p.id); setRequests((r) => r.filter((x) => x.id !== p.id)); }}>Onayla</button>
                <button className="btn btn-ghost btn-sm" onClick={async () => { await S.removeFollower(me!.userId, p.id); setRequests((r) => r.filter((x) => x.id !== p.id)); }}>Reddet</button>
              </div>
            } />
          ))}
        </section>
      )}
      {list === null ? <div className="center pad muted"><Loader2 size={20} className="spin" /></div>
        : shown.length === 0 ? <div className="s-empty"><Bell size={26} /><p>Henüz bildirim yok.</p></div>
        : shown.map((n) => {
          const Icon = N_ICON[n.type] ?? Bell;
          return (
            <button key={n.id} className={clsx("s-notif", !n.read && "unread", n.type)} onClick={() => (n.type === "message" ? navigate("/social/messages") : n.post_id ? navigate(`/post/${n.post_id}`) : n.actor && navigate(`/u/${n.actor.username}`))}>
              <Icon size={20} className="s-notif-ico" fill={n.type === "like" ? "currentColor" : "none"} />
              <div className="grow" style={{ minWidth: 0 }}>
                <Avatar url={n.actor?.avatar_url} name={n.actor?.username ?? "?"} size={30} />
                <p><strong>{n.actor?.display_name || n.actor?.username || "Biri"}</strong> {N_TEXT[n.type] ?? n.type} <span className="muted tiny">· {ago(n.created_at)}</span></p>
                {n.post?.body && <p className="muted small clamp-2">{n.post.body}</p>}
              </div>
            </button>
          );
        })}
    </SocialLayout>
  );
}

// ───────── Yer imleri ─────────
export function BookmarksPage() {
  const load = useCallback(async (c: Post | null) => (c ? [] : S.bookmarks()), []);
  return (
    <SocialLayout>
      <div className="s-title"><h2>Yer imleri</h2><span className="muted tiny">Yalnızca sen görürsün</span></div>
      <PostList load={load} empty={<><Bookmark size={26} /><p>Kaydettiğin gönderiler burada. Bir gönderideki yer imi simgesine tıkla.</p></>} />
    </SocialLayout>
  );
}

// ───────── Keşfet / ara / etiket ─────────
export function SocialSearchPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [tab, setTab] = useState<"posts" | "people">("posts");
  const [people, setPeople] = useState<Profile[] | null>(null);
  const me = useWest((s) => s.account);
  useEffect(() => { setInput(q); if (q) S.searchProfiles(q).then(setPeople).catch(() => setPeople([])); }, [q]);
  const load = useCallback((c: Post | null, n: number) => (q ? (c ? Promise.resolve([]) : S.searchPosts(q)) : S.exploreFeed(n)), [q]);
  return (
    <SocialLayout>
      <form className="s-search big" onSubmit={(e) => { e.preventDefault(); setParams(input.trim() ? { q: input.trim() } : {}); }}>
        <Search size={17} /><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Kişi, gönderi ya da #etiket ara" autoFocus />
      </form>
      {q.startsWith("#") && <TagRedirect tag={q.slice(1)} />}
      {q && (
        <div className="s-tabs">
          <button className={clsx(tab === "posts" && "on")} onClick={() => setTab("posts")}>Gönderiler</button>
          <button className={clsx(tab === "people" && "on")} onClick={() => setTab("people")}>Kişiler {people && `(${people.length})`}</button>
        </div>
      )}
      {!q && <div className="s-title"><h2>Keşfet</h2><span className="muted tiny">Son 7 günün öne çıkanları</span></div>}
      {tab === "people" && q ? (people ?? []).map((p) => <UserRow key={p.id} p={p} me={me?.userId} />)
        : <PostList load={load} deps={[q]} empty={<><Search size={26} /><p>“{q}” için gönderi bulunamadı.</p></>} />}
    </SocialLayout>
  );
}
function TagRedirect({ tag }: { tag: string }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(`/social/tag/${encodeURIComponent(tag)}`, { replace: true }); }, [tag, navigate]);
  return null;
}

export function TagPage() {
  const { tag = "" } = useParams();
  const load = useCallback((c: Post | null) => S.tagPosts(tag, c?.created_at), [tag]);
  return (
    <SocialLayout>
      <div className="s-title"><h2><Hash size={20} /> {tag}</h2></div>
      <PostList load={load} deps={[tag]} empty={<><Hash size={26} /><p>#{tag} etiketiyle henüz gönderi yok.</p></>} />
    </SocialLayout>
  );
}

// ───────── Gönderi ayrıntısı ─────────
export function PostPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null | undefined>(undefined);
  const [parents, setParents] = useState<Post[]>([]);
  const [replies, setReplies] = useState<Post[] | null>(null);
  const [viewer, setViewer] = useState<{ m: S.Media[]; i: number } | null>(null);
  const loadAll = useCallback(async () => {
    const p = await S.postById(id).catch(() => null);
    setPost(p);
    if (!p) return;
    const chain: Post[] = [];
    let cur = p.reply_to;
    while (cur && chain.length < 8) {
      const parent = await S.postById(cur).catch(() => null);
      if (!parent) break;
      chain.unshift(parent);
      cur = parent.reply_to;
    }
    setParents(chain);
    setReplies(await S.replies(p.id).catch(() => []));
  }, [id]);
  useEffect(() => { setPost(undefined); setReplies(null); void loadAll(); }, [loadAll]);
  useEffect(() => {
    const h = () => void loadAll();
    window.addEventListener("west:posted", h);
    return () => window.removeEventListener("west:posted", h);
  }, [loadAll]);
  return (
    <SocialLayout>
      <div className="s-title"><button className="icon-btn" onClick={() => navigate(-1)}><ArrowLeft size={18} /></button><h2>Gönderi</h2></div>
      {post === undefined ? <div className="center pad muted"><Loader2 size={20} className="spin" /></div>
        : post === null ? <div className="s-empty"><X size={26} /><p>Bu gönderi silinmiş ya da görme iznin yok.</p></div>
        : (
          <>
            {parents.map((p) => <div key={p.id} className="s-thread-parent"><PostCard post={p} onOpenMedia={(m, i) => setViewer({ m, i })} /></div>)}
            <PostCard key={post.id} post={post} detail onOpenMedia={(m, i) => setViewer({ m, i })} />
            <Composer replyTo={post.id} compact onPosted={(r) => setReplies((x) => [...(x ?? []), r])} />
            {replies === null ? <div className="center pad muted"><Loader2 size={16} className="spin" /></div>
              : replies.map((r) => <PostCard key={r.id} post={r} onOpenMedia={(m, i) => setViewer({ m, i })} onDeleted={(rid) => setReplies((x) => x?.filter((y) => y.id !== rid) ?? null)} />)}
          </>
        )}
      <MediaViewer v={viewer} onClose={() => setViewer(null)} />
    </SocialLayout>
  );
}

// ───────── Profil ─────────
export function ProfilePage() {
  const { username = "" } = useParams();
  const navigate = useNavigate();
  const account = useWest((s) => s.account);
  const { me: myProfile, setMe } = useSocial();
  const [p, setP] = useState<Profile | null | undefined>(undefined);
  const [rel, setRel] = useState<{ following: string | null; followsMe: boolean }>({ following: null, followsMe: false });
  const [tab, setTab] = useState<"posts" | "replies" | "media" | "likes">("posts");
  const [edit, setEdit] = useState(false);
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pinned, setPinned] = useState<Post | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mine = !!account && p?.id === account.userId;

  useEffect(() => {
    setP(undefined);
    S.profileByUsername(username).then(async (x) => {
      setP(x);
      if (x && account && x.id !== account.userId) {
        setRel(await S.followState(account.userId, x.id).catch(() => ({ following: null, followsMe: false })));
        setBlocked(await S.isBlocked(account.userId, x.id).catch(() => false));
        setMuted(await S.isMuted(account.userId, x.id).catch(() => false));
      }
      setPinned(x?.pinned_post_id ? await S.postById(x.pinned_post_id).catch(() => null) : null);
    }).catch(() => setP(null));
  }, [username, account]);
  const load = useCallback((c: Post | null) => (p ? S.userPosts(p.id, tab, c?.created_at) : Promise.resolve([])), [p, tab]);

  if (p === undefined) return <SocialLayout><div className="center pad muted"><Loader2 size={20} className="spin" /></div></SocialLayout>;
  if (p === null) return <SocialLayout><div className="s-empty"><UserX size={26} /><p>@{username} adında bir West hesabı yok.</p></div></SocialLayout>;

  const hidden = p.is_private && !mine && rel.following !== "accepted";
  const doFollow = async () => {
    if (!account) return;
    try {
      if (rel.following) { await S.unfollow(account.userId, p.id); setRel({ ...rel, following: null }); setP({ ...p, followers_count: p.followers_count - (rel.following === "accepted" ? 1 : 0) }); }
      else { await S.follow(account.userId, p.id); const st = p.is_private ? "pending" : "accepted"; setRel({ ...rel, following: st }); if (st === "accepted") setP({ ...p, followers_count: p.followers_count + 1 }); }
    } catch (e) { setNotice(err(e)); }
  };
  const joined = new Date(p.created_at).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });

  return (
    <SocialLayout>
      <div className="s-title"><button className="icon-btn" onClick={() => navigate(-1)}><ArrowLeft size={18} /></button><div><h2 className="row" style={{ gap: 6 }}>{p.display_name || p.username}{p.verified && <BadgeCheck size={18} className="s-verified" />}</h2><span className="muted tiny">{formatCount(p.posts_count)} gönderi</span></div></div>
      <div className="s-profile">
        <div className="s-banner">{p.banner_url ? <img src={p.banner_url} alt="" referrerPolicy="no-referrer" /> : <div className="s-banner-ph" />}</div>
        <div className="s-profile-top">
          <div className="s-profile-avatar"><Avatar url={p.avatar_url} name={p.username} size={112} /></div>
          <div className="row" style={{ gap: 8 }}>
            {mine ? (
              <button className="btn btn-ghost" onClick={() => setEdit(true)}>Profili düzenle</button>
            ) : account && (
              <>
                <Menu
                  trigger={() => <button className="round-btn sm" aria-label="Daha fazla"><MoreHorizontal size={18} /></button>}
                  items={[
                    { label: muted ? "Sessizden çıkar" : "Sessize al", icon: <VolumeX size={14} />, onClick: async () => { await S.setMute(account.userId, p.id, !muted); setMuted(!muted); } },
                    { label: blocked ? "Engeli kaldır" : "Engelle", icon: <UserX size={14} />, danger: !blocked, onClick: async () => { if (!blocked && !confirm(`@${p.username} engellensin mi?`)) return; await S.setBlock(account.userId, p.id, !blocked); setBlocked(!blocked); setRel({ following: null, followsMe: false }); } },
                    { label: "Şikâyet et", icon: <Flag size={14} />, danger: true, onClick: async () => { const r = prompt("Şikâyet nedeni:"); if (r?.trim()) { await S.report("profile", p.id, r.trim()); setNotice("Şikâyetin alındı."); } } },
                  ]}
                />
                {!blocked && (
                  <button className="round-btn sm" title="Mesaj gönder" onClick={async () => { try { navigate(`/social/messages/${await S.startDm(p.id)}`); } catch (e) { setNotice(err(e)); } }}><Mail size={17} /></button>
                )}
                {!blocked && (
                  <button className={clsx("btn", rel.following ? "btn-ghost follow-on" : "btn-primary")} onClick={() => void doFollow()}>
                    {rel.following === "accepted" ? <span className="follow-label"><span>Takip ediliyor</span><span>Takibi bırak</span></span> : rel.following === "pending" ? "İstek gönderildi" : rel.followsMe ? "Sen de takip et" : "Takip et"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="s-profile-info">
          <h1 className="row" style={{ gap: 6 }}>{p.display_name || p.username}{p.verified && <BadgeCheck size={20} className="s-verified" />}{p.is_private && <Lock size={16} className="muted" />}</h1>
          <span className="muted">@{p.username} {rel.followsMe && <span className="s-follows-you">Seni takip ediyor</span>}</span>
          {p.bio && <p className="s-bio"><RichText text={p.bio} /></p>}
          <div className="s-meta">
            {p.location && <span><MapPin size={14} /> {p.location}</span>}
            {p.website && <button className="s-link" onClick={() => void openUrl(p.website!.startsWith("http") ? p.website! : `https://${p.website}`)}><Link2 size={14} /> {p.website.replace(/^https?:\/\//, "")}</button>}
            {p.mc_username && <span>⛏ Minecraft: <b>{p.mc_username}</b></span>}
            <span><CalendarDays size={14} /> {joined} tarihinde katıldı</span>
          </div>
          {p.links?.length > 0 && (
            <div className="s-links">{p.links.map((l) => <button key={l.url} className="s-chip" onClick={() => void openUrl(l.url)}><Link2 size={12} /> {l.label || l.url.replace(/^https?:\/\//, "")}</button>)}</div>
          )}
          <div className="s-counts">
            <button onClick={() => !hidden && setList("following")}><b>{formatCount(p.following_count)}</b> Takip edilen</button>
            <button onClick={() => !hidden && setList("followers")}><b>{formatCount(p.followers_count)}</b> Takipçi</button>
          </div>
          {notice && <p className="muted tiny">{notice}</p>}
        </div>
      </div>
      {blocked ? <div className="s-empty"><UserX size={26} /><p>@{p.username} adlı kişiyi engelledin.</p></div>
        : hidden ? <div className="s-empty"><Lock size={26} /><p>Bu hesap gizli. Gönderilerini görmek için takip et; isteğin onaylanınca görürsün.</p></div>
        : (
          <>
            <div className="s-tabs">
              {([["posts", "Gönderiler"], ["replies", "Yanıtlar"], ["media", "Medya"], ["likes", "Beğeniler"]] as const).map(([k, l]) => (
                <button key={k} className={clsx(tab === k && "on")} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {tab === "posts" && pinned && <PostCard post={pinned} />}
            <PostList load={load} deps={[p.id, tab]} empty={<><MessageCircle size={26} /><p>{tab === "media" ? "Henüz fotoğraf paylaşılmamış." : tab === "likes" ? "Henüz beğeni yok." : "Henüz gönderi yok."}</p></>} />
          </>
        )}
      {mine && <EditProfileModal open={edit} onClose={() => setEdit(false)} profile={p} onSaved={(np) => { setP(np); setMe(np); }} />}
      <FollowListModal userId={p.id} dir={list} onClose={() => setList(null)} />
      {myProfile && null}
    </SocialLayout>
  );
}

function FollowListModal({ userId, dir, onClose }: { userId: string; dir: "followers" | "following" | null; onClose: () => void }) {
  const me = useWest((s) => s.account);
  const [list, setList] = useState<Profile[] | null>(null);
  useEffect(() => { if (dir) { setList(null); S.followList(userId, dir).then(setList).catch(() => setList([])); } }, [userId, dir]);
  return (
    <Modal open={!!dir} onClose={onClose} title={dir === "followers" ? "Takipçiler" : "Takip edilenler"} width={460}>
      <div className="s-follow-list">
        {list === null ? <div className="center pad muted"><Loader2 size={18} className="spin" /></div> : list.length === 0 ? <p className="muted center pad">Kimse yok.</p>
          : list.map((p) => <div key={p.id} onClick={onClose}><UserRow p={p} me={me?.userId} /></div>)}
      </div>
    </Modal>
  );
}

function EditProfileModal({ open, onClose, profile, onSaved }: { open: boolean; onClose: () => void; profile: Profile; onSaved: (p: Profile) => void }) {
  const [d, setD] = useState(profile);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setD(profile); setError(null); } }, [open, profile]);
  const upload = async (field: "avatar_url" | "banner_url") => {
    const avatar = field === "avatar_url";
    try {
      // Önce kırpma penceresi: konum, yakınlaştırma, döndürme
      const path = await pickCropped(avatar
        ? { aspect: 1, round: true, title: "Profil fotoğrafını ayarla", outWidth: 512 }
        : { aspect: 3, title: "Banner'ı ayarla", outWidth: 1500 });
      if (!path) return;
      setBusy(field);
      const url = await api.westUpload(path, avatar ? "avatars" : "banners");
      setD((cur) => ({ ...cur, [field]: url }));
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const links = useMemo(() => (d.links?.length ? d.links : []), [d.links]);
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const [np] = await S.updateProfile(profile.id, {
        display_name: d.display_name?.trim() || null, bio: d.bio?.trim() || null, location: d.location?.trim() || null, website: d.website?.trim() || null,
        mc_username: d.mc_username?.trim() || null, avatar_url: d.avatar_url, banner_url: d.banner_url, is_private: d.is_private, allow_dms: d.allow_dms,
        links: links.filter((l) => /^https?:\/\//.test(l.url.trim())).map((l) => ({ label: l.label.trim().slice(0, 30), url: l.url.trim() })).slice(0, 5),
      });
      onSaved(np);
      onClose();
    } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Profili düzenle" width={620}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={!!busy} onClick={() => void save()}>{busy === "save" && <Loader2 size={15} className="spin" />} Kaydet</button></>}>
      <div className="s-edit">
        <div className="s-edit-head">
          <button type="button" className="s-edit-banner" onClick={() => void upload("banner_url")} disabled={!!busy} aria-label="Banner'ı değiştir">
            {d.banner_url ? <img src={d.banner_url} alt="" referrerPolicy="no-referrer" /> : <div className="s-banner-ph" />}
            <span className="s-edit-cam">{busy === "banner_url" ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />} Banner'ı değiştir</span>
          </button>
          {d.banner_url && <button type="button" className="s-edit-rm" title="Banner'ı kaldır" onClick={() => setD({ ...d, banner_url: null })}><X size={14} /></button>}
          <button type="button" className="s-edit-avatar" onClick={() => void upload("avatar_url")} disabled={!!busy} aria-label="Profil fotoğrafını değiştir">
            <Avatar url={d.avatar_url} name={d.username} size={96} />
            <span className="s-edit-cam round">{busy === "avatar_url" ? <Loader2 size={18} className="spin" /> : <ImagePlus size={18} />}</span>
          </button>
          {d.avatar_url && <button type="button" className="s-edit-rm avatar" title="Fotoğrafı kaldır" onClick={() => setD({ ...d, avatar_url: null })}><X size={12} /></button>}
        </div>
        <label className="field"><span>Görünen ad</span><input value={d.display_name ?? ""} maxLength={40} placeholder={d.username} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></label>
        <label className="field"><span>Biyografi <span className="muted">({(d.bio ?? "").length}/300)</span></span><textarea rows={4} maxLength={300} value={d.bio ?? ""} placeholder="Kendinden bahset: hangi modları seversin, ne oynarsın…" onChange={(e) => setD({ ...d, bio: e.target.value })} /></label>
        <div className="row" style={{ gap: 10 }}>
          <label className="field grow"><span>Konum</span><input value={d.location ?? ""} maxLength={40} onChange={(e) => setD({ ...d, location: e.target.value })} /></label>
          <label className="field grow"><span>Minecraft adı</span><input value={d.mc_username ?? ""} maxLength={16} onChange={(e) => setD({ ...d, mc_username: e.target.value.replace(/[^A-Za-z0-9_]/g, "") })} /></label>
        </div>
        <label className="field"><span>Web sitesi</span><input value={d.website ?? ""} maxLength={200} placeholder="https://" onChange={(e) => setD({ ...d, website: e.target.value })} /></label>
        <div className="field">
          <span>Bağlantılar (YouTube, Twitch, Discord sunucusu…)</span>
          {links.map((l, i) => (
            <div key={i} className="row" style={{ gap: 6, marginTop: 6 }}>
              <input style={{ width: 140 }} value={l.label} placeholder="Ad" maxLength={30} onChange={(e) => setD({ ...d, links: links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="grow" value={l.url} placeholder="https://" onChange={(e) => setD({ ...d, links: links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <button className="icon-btn" onClick={() => setD({ ...d, links: links.filter((_, j) => j !== i) })}><X size={14} /></button>
            </div>
          ))}
          {links.length < 5 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setD({ ...d, links: [...links, { label: "", url: "" }] })}><Link2 size={13} /> Bağlantı ekle</button>}
        </div>
        <label className="check"><input type="checkbox" checked={d.is_private} onChange={(e) => setD({ ...d, is_private: e.target.checked })} /> <Lock size={14} /> Gizli hesap: gönderilerimi yalnızca onayladığım takipçiler görsün</label>
        <label className="field"><span>Kimler mesaj atabilir</span>
          <select value={d.allow_dms} onChange={(e) => setD({ ...d, allow_dms: e.target.value as Profile["allow_dms"] })}>
            <option value="everyone">Herkes</option><option value="followers">Yalnızca takip ettiklerim</option><option value="none">Kimse</option>
          </select>
        </label>
        {error && <p className="hint error">{error}</p>}
      </div>
    </Modal>
  );
}

// ───────── Mesajlar ─────────
export function MessagesPage() {
  return <SocialLayout wide><MessagesView /></SocialLayout>;
}

// ───────── Gizlilik ve güvenlik ─────────
export function PrivacyPage() {
  const account = useWest((s) => s.account);
  const { me, setMe } = useSocial();
  const [blocked, setBlocked] = useState<Profile[] | null>(null);
  const [muted, setMuted] = useState<Profile[] | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    if (!account) return;
    S.blockedList(account.userId).then(setBlocked).catch(() => setBlocked([]));
    S.mutedList(account.userId).then(setMuted).catch(() => setMuted([]));
  }, [account]);
  const patch = async (p: Partial<Profile>) => {
    if (!me) return;
    try { const [np] = await S.updateProfile(me.id, p); setMe(np); setSaved("Kaydedildi"); } catch (e) { setSaved(err(e)); }
  };
  return (
    <SocialLayout>
      <div className="s-title"><h2><Shield size={20} /> Gizlilik ve güvenlik</h2></div>
      {me && (
        <section className="s-settings">
          <label className="s-set-row">
            <span><strong><Lock size={15} /> Gizli hesap</strong><span className="muted small">Gönderilerini ve hikâyelerini yalnızca onayladığın takipçiler görür. Yeni takipçiler istek gönderir.</span></span>
            <input type="checkbox" className="switch-cb" checked={me.is_private} onChange={(e) => void patch({ is_private: e.target.checked })} />
          </label>
          <label className="s-set-row">
            <span><strong><Mail size={15} /> Kimler mesaj atabilir</strong><span className="muted small">Mevcut sohbetler etkilenmez.</span></span>
            <select value={me.allow_dms} onChange={(e) => void patch({ allow_dms: e.target.value as Profile["allow_dms"] })}>
              <option value="everyone">Herkes</option><option value="followers">Takip ettiklerim</option><option value="none">Kimse</option>
            </select>
          </label>
          {saved && <p className="muted tiny">{saved}</p>}
        </section>
      )}
      <section className="s-settings">
        <h3><UserX size={16} /> Engellenenler</h3>
        <p className="muted small">Engellediğin kişiler seni göremez, takip edemez ve mesaj atamaz; sen de onları görmezsin.</p>
        {blocked === null ? <Loader2 size={16} className="spin" /> : blocked.length === 0 ? <p className="muted small">Kimseyi engellemedin.</p>
          : blocked.map((p) => <UserRow key={p.id} p={p} extra={<button className="btn btn-ghost btn-sm" onClick={async (e) => { e.stopPropagation(); await S.setBlock(account!.userId, p.id, false); setBlocked((b) => b?.filter((x) => x.id !== p.id) ?? null); }}>Engeli kaldır</button>} />)}
      </section>
      <section className="s-settings">
        <h3><VolumeX size={16} /> Sessize alınanlar</h3>
        <p className="muted small">Sessize aldığın kişilerin gönderileri akışında görünmez ve senden haberi olmaz.</p>
        {muted === null ? <Loader2 size={16} className="spin" /> : muted.length === 0 ? <p className="muted small">Kimseyi sessize almadın.</p>
          : muted.map((p) => <UserRow key={p.id} p={p} extra={<button className="btn btn-ghost btn-sm" onClick={async (e) => { e.stopPropagation(); await S.setMute(account!.userId, p.id, false); setMuted((b) => b?.filter((x) => x.id !== p.id) ?? null); }}>Sesi aç</button>} />)}
      </section>
      <section className="s-settings">
        <h3><Flag size={16} /> Güvenli kal</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Şifreni, e-postanı ya da Minecraft hesap bilgilerini kimseyle paylaşma.</li>
          <li>Rahatsız eden birini gönderi menüsünden ya da profilinden engelleyebilir ve şikâyet edebilirsin.</li>
          <li>Tanımadığın kişilerden gelen bağlantılara dikkat et.</li>
        </ul>
      </section>
    </SocialLayout>
  );
}
