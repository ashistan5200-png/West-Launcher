import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  BadgeCheck, BarChart2, Bookmark, Copy, Flag, Heart, Lock, MessageCircle, MoreHorizontal, Pencil, Pin, Quote, Repeat2, Trash2, UserX, VolumeX,
} from "lucide-react";
import clsx from "clsx";
import { Menu } from "@/components/instance/Menu";
import { isTauri } from "@/lib/ipc";
import { formatCount } from "@/lib/format";
import * as S from "@/lib/social";
import type { Post } from "@/lib/social";
import { useSocial } from "@/stores/social";
import { useWest } from "@/stores/west";
import { askConfirm } from "@/components/ConfirmDialog";
import { locale, tx } from "@/lib/i18n";

/** "3 dk", "2 sa", "5 g", tarih */
export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return tx("şimdi");
  if (s < 3600) return `${Math.floor(s / 60)} dk`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} g`;
  return new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

export function Avatar({ url, name, size = 42 }: { url?: string | null; name: string; size?: number }) {
  return url ? (
    <img className="s-avatar" src={url} alt="" style={{ width: size, height: size }} referrerPolicy="no-referrer" />
  ) : (
    <span className="s-avatar ph" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name.slice(0, 1).toUpperCase()}</span>
  );
}

/** #etiket, @kişi ve bağlantıları tıklanabilir yapar */
export function RichText({ text }: { text: string }) {
  const navigate = useNavigate();
  const parts = text.split(/(#[\p{L}\p{N}_]{1,40}|@[A-Za-z0-9_]{3,16}|https?:\/\/[^\s]+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("#") ? <button key={i} className="s-link" onClick={(e) => { e.stopPropagation(); navigate(`/social/tag/${encodeURIComponent(p.slice(1).toLowerCase())}`); }}>{p}</button>
        : p.startsWith("@") ? <button key={i} className="s-link" onClick={(e) => { e.stopPropagation(); navigate(`/u/${p.slice(1)}`); }}>{p}</button>
        : /^https?:\/\//.test(p) ? <button key={i} className="s-link" onClick={(e) => { e.stopPropagation(); void openUrl(p); }}>{p.replace(/^https?:\/\//, "").slice(0, 40)}{p.length > 48 ? "…" : ""}</button>
        : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export function MediaGrid({ media, onOpen }: { media: S.Media[]; onOpen?: (i: number) => void }) {
  if (!media.length) return null;
  return (
    <div className={`s-media n${Math.min(media.length, 4)}`}>
      {media.slice(0, 4).map((m, i) => (
        <button key={m.url} onClick={(e) => { e.stopPropagation(); onOpen?.(i); }}>
          <img src={m.url} alt={m.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
        </button>
      ))}
    </div>
  );
}

function PollView({ post, onVoted }: { post: Post; onVoted: (p: Post) => void }) {
  const me = useWest((s) => s.account);
  const poll = post.poll!;
  const total = poll.counts.reduce((a, b) => a + b, 0);
  const ended = new Date(poll.ends_at).getTime() < Date.now();
  const voted = poll.my_vote !== null && poll.my_vote !== undefined;
  const show = voted || ended || !me;
  return (
    <div className="s-poll" onClick={(e) => e.stopPropagation()}>
      {poll.options.map((o, i) => {
        const pct = total ? Math.round((poll.counts[i] / total) * 100) : 0;
        return show ? (
          <div key={i} className={clsx("s-poll-row", poll.my_vote === i && "mine")}>
            <span className="s-poll-bar" style={{ width: `${pct}%` }} />
            <span className="s-poll-label">{o}</span>
            <strong>{pct}%</strong>
          </div>
        ) : (
          <button key={i} className="s-poll-opt" onClick={async () => {
            await S.vote(me!.userId, post.id, i);
            const fresh = await S.postById(post.id);
            if (fresh) onVoted(fresh);
          }}>{o}</button>
        );
      })}
      <span className="muted tiny">{formatCount(total)} oy · {ended ? tx("Anket bitti") : `${ago(poll.ends_at).replace("şimdi", "az")} sonra bitiyor`.replace(/^(\d)/, "$1")}</span>
    </div>
  );
}

/** Alıntılanan gönderinin küçük gösterimi */
export function QuoteEmbed({ id }: { id: string }) {
  const navigate = useNavigate();
  const q = S.cachedPost(id);
  if (!q) return <div className="s-quote muted small">{tx("Bu gönderi artık görüntülenemiyor.")}</div>;
  return (
    <div className="s-quote" onClick={(e) => { e.stopPropagation(); navigate(`/post/${q.id}`); }}>
      <div className="s-head"><Avatar url={q.avatar_url} name={q.username} size={20} /><strong>{q.display_name || q.username}</strong><span className="muted">@{q.username} · {ago(q.created_at)}</span></div>
      {q.body && <p className="s-body small"><RichText text={q.body} /></p>}
      <MediaGrid media={q.media} />
    </div>
  );
}

export function PostCard({ post: initial, onChanged, onDeleted, onOpenMedia, detail = false }: {
  post: Post; onChanged?: (p: Post) => void; onDeleted?: (id: string) => void; onOpenMedia?: (m: S.Media[], i: number) => void; detail?: boolean;
}) {
  const navigate = useNavigate();
  const me = useWest((s) => s.account);
  const myProfile = useSocial((s) => s.me);
  const openCompose = useSocial((s) => s.openCompose);
  // Saf yeniden paylaşım: içerik orijinal gönderiden gelir
  const isRepost = !!initial.repost_of && !initial.body && !initial.media.length;
  const [post, setPost] = useState<Post>(isRepost ? S.cachedPost(initial.repost_of) ?? initial : initial);
  const [gone, setGone] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  if (gone) return null;
  const mine = me?.userId === post.author_id;
  const update = (p: Post) => { setPost(p); onChanged?.(p); };
  const need = () => { if (!me) { setMsg(tx("Bunun için West hesabına giriş yap.")); return false; } return true; };

  const toggle = async (kind: "like" | "bookmark" | "repost") => {
    if (!need()) return;
    const on = kind === "like" ? !post.liked : kind === "bookmark" ? !post.bookmarked : !post.reposted;
    const key = kind === "like" ? "liked" : kind === "bookmark" ? "bookmarked" : "reposted";
    const count = kind === "like" ? "like_count" : kind === "bookmark" ? "bookmark_count" : "repost_count";
    update({ ...post, [key]: on, [count]: Math.max(0, post[count] + (on ? 1 : -1)) });
    try {
      if (kind === "like") await S.setLike(me!.userId, post.id, on);
      else if (kind === "bookmark") await S.setBookmark(me!.userId, post.id, on);
      else await S.setRepost(me!.userId, post.id, on);
    } catch (e) {
      update(post);
      setMsg(String(e).replace(/^Error: /, ""));
    }
  };

  const copyText = async (t: string) => { try { if (isTauri()) await writeText(t); else await navigator.clipboard.writeText(t); setMsg(tx("Kopyalandı")); } catch { /* yok say */ } };

  return (
    <article className={clsx("s-post", detail && "detail")} onClick={() => !detail && navigate(`/post/${post.id}`)}>
      {isRepost && (
        <div className="s-repost-by"><Repeat2 size={14} /> <button className="s-link plain" onClick={(e) => { e.stopPropagation(); navigate(`/u/${initial.username}`); }}>{initial.author_id === me?.userId ? tx("Sen") : initial.display_name || initial.username}</button> {tx("yeniden paylaştı")}</div>
      )}
      {myProfile?.pinned_post_id === post.id && !isRepost && <div className="s-repost-by"><Pin size={13} /> {tx("Sabitlenmiş")}</div>}
      <div className="s-row">
        <button className="s-avatar-btn" onClick={(e) => { e.stopPropagation(); navigate(`/u/${post.username}`); }}><Avatar url={post.avatar_url} name={post.username} /></button>
        <div className="s-main">
          <div className="s-head">
            <button className="s-name" onClick={(e) => { e.stopPropagation(); navigate(`/u/${post.username}`); }}>
              <strong className="truncate">{post.display_name || post.username}</strong>
              {post.verified && <BadgeCheck size={15} className="s-verified" />}
            </button>
            <span className="muted truncate">@{post.username} · {ago(post.created_at)}{post.edited_at ? tx(" · düzenlendi") : ""}</span>
            {post.audience === "followers" && <Lock size={12} className="muted" />}
            <span className="grow" />
            <div onClick={(e) => e.stopPropagation()}>
              <Menu
                trigger={() => <button className="icon-btn sm" aria-label={tx("Daha fazla")}><MoreHorizontal size={16} /></button>}
                items={[
                  { label: tx("Metni kopyala"), icon: <Copy size={14} />, onClick: () => void copyText(post.body ?? "") },
                  ...(mine
                    ? [
                        { label: tx("Düzenle"), icon: <Pencil size={14} />, onClick: () => setEditing(post.body ?? "") },
                        { label: myProfile?.pinned_post_id === post.id ? tx("Sabitlemeyi kaldır") : tx("Profilime sabitle"), icon: <Pin size={14} />, onClick: async () => { const r = await S.pinPost(me!.userId, myProfile?.pinned_post_id === post.id ? null : post.id); if (r[0]) useSocial.getState().setMe(r[0]); } },
                        { label: tx("Sil"), icon: <Trash2 size={14} />, danger: true, onClick: async () => { if (!await askConfirm(tx("Bu gönderi silinsin mi?"))) return; await S.deletePost(post.id); setGone(true); onDeleted?.(post.id); } },
                      ]
                    : me
                      ? [
                          { label: `@${post.username} adlı kişiyi sessize al`, icon: <VolumeX size={14} />, onClick: async () => { await S.setMute(me.userId, post.author_id, true); setMsg(tx("Sessize alındı; gönderileri akışında görünmeyecek.")); } },
                          { label: `@${post.username} adlı kişiyi engelle`, icon: <UserX size={14} />, danger: true, onClick: async () => { if (!await askConfirm(`@${post.username} engellensin mi? Birbirinizi göremeyeceksiniz.`)) return; await S.setBlock(me.userId, post.author_id, true); setGone(true); } },
                          { label: tx("Gönderiyi şikâyet et"), icon: <Flag size={14} />, danger: true, onClick: async () => { const r = prompt(tx("Şikâyet nedeni (ör. hakaret, spam, uygunsuz içerik):")); if (r?.trim()) { await S.report("post", post.id, r.trim()); setMsg(tx("Şikâyetin alındı. Teşekkürler.")); } } },
                        ]
                      : []),
                ]}
              />
            </div>
          </div>
          {post.reply_to && !detail && <div className="muted tiny">{tx("Yanıt olarak")}</div>}
          {editing !== null ? (
            <div className="s-edit-inline" onClick={(e) => e.stopPropagation()}>
              <textarea value={editing} maxLength={500} rows={3} autoFocus onChange={(e) => setEditing(e.target.value)} />
              <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                <span className="muted tiny grow">{500 - editing.length}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>{tx("Vazgeç")}</button>
                <button className="btn btn-primary btn-sm" disabled={!editing.trim() && !post.media.length} onClick={async () => {
                  try { await S.editPost(post.id, editing.trim()); const f = await S.postById(post.id); if (f) update(f); setEditing(null); } catch (e) { setMsg(String(e).replace(/^Error: /, "")); }
                }}>{tx("Kaydet")}</button>
              </div>
            </div>
          ) : post.body && <p className={clsx("s-body", detail && "big")}><RichText text={post.body} /></p>}
          <MediaGrid media={post.media} onOpen={(i) => onOpenMedia?.(post.media, i)} />
          {post.poll && <PollView post={post} onVoted={update} />}
          {post.quote_of && <QuoteEmbed id={post.quote_of} />}
          {detail && <div className="muted small s-when">{new Date(post.created_at).toLocaleString(locale(), { dateStyle: "long", timeStyle: "short" })} · <b>{formatCount(post.view_count)}</b> {tx("görüntülenme")}</div>}
          <div className="s-actions" onClick={(e) => e.stopPropagation()}>
            <button className="s-act reply" title={tx("Yanıtla")} onClick={() => need() && openCompose({ replyTo: post.id })}><MessageCircle size={17} /> <span>{post.reply_count ? formatCount(post.reply_count) : ""}</span></button>
            <Menu
              align="left"
              trigger={() => <button className={clsx("s-act repost", post.reposted && "on")} title={tx("Yeniden paylaş")}><Repeat2 size={18} /> <span>{post.repost_count + post.quote_count ? formatCount(post.repost_count + post.quote_count) : ""}</span></button>}
              items={[
                { label: post.reposted ? tx("Yeniden paylaşımı geri al") : tx("Yeniden paylaş"), icon: <Repeat2 size={14} />, onClick: () => void toggle("repost") },
                { label: tx("Alıntıla"), icon: <Quote size={14} />, onClick: () => need() && openCompose({ quoteOf: post.id }) },
              ]}
            />
            <button className={clsx("s-act like", post.liked && "on")} title={tx("Beğen")} onClick={() => void toggle("like")}><Heart size={17} fill={post.liked ? "currentColor" : "none"} /> <span>{post.like_count ? formatCount(post.like_count) : ""}</span></button>
            <span className="s-act views" title={tx("Görüntülenme")}><BarChart2 size={17} /> <span>{post.view_count ? formatCount(post.view_count) : ""}</span></span>
            <button className={clsx("s-act bookmark", post.bookmarked && "on")} title={tx("Yer imlerine ekle")} onClick={() => void toggle("bookmark")}><Bookmark size={17} fill={post.bookmarked ? "currentColor" : "none"} /></button>
          </div>
          {msg && <p className="muted tiny" onClick={(e) => { e.stopPropagation(); setMsg(null); }}>{msg}</p>}
        </div>
      </div>
    </article>
  );
}
