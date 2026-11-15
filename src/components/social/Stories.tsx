import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Eye, Loader2, Plus, Send, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import * as S from "@/lib/social";
import { useWest } from "@/stores/west";
import { useSocial } from "@/stores/social";
import { Modal } from "@/components/Modal";
import { Avatar, ago } from "./PostCard";

const DURATION = 6000;

/** Akışın üstündeki hikâye şeridi. */
export function StoriesBar() {
  const me = useWest((s) => s.account);
  const myProfile = useSocial((s) => s.me);
  const [groups, setGroups] = useState<S.StoryGroup[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [create, setCreate] = useState(false);
  const load = useCallback(() => S.storyGroups(me?.userId ?? null).then(setGroups).catch(() => setGroups([])), [me]);
  useEffect(() => { void load(); }, [load]);
  if (!groups) return null;
  const mineIdx = groups.findIndex((g) => g.author.id === me?.userId);
  return (
    <>
      <div className="stories">
        {me && myProfile && (
          <button className="story-chip" onClick={() => (mineIdx >= 0 ? setOpen(mineIdx) : setCreate(true))}>
            <span className={clsx("story-ring", mineIdx >= 0 && !groups[mineIdx].seen && "new", mineIdx < 0 && "no-story")}>
              <Avatar url={myProfile.avatar_url} name={myProfile.username} size={58} />
              <span className="story-plus" onClick={(e) => { e.stopPropagation(); setCreate(true); }}><Plus size={13} /></span>
            </span>
            <span className="tiny truncate">Hikâyen</span>
          </button>
        )}
        {groups.map((g, i) => g.author.id === me?.userId ? null : (
          <button key={g.author.id} className="story-chip" onClick={() => setOpen(i)}>
            <span className={clsx("story-ring", !g.seen && "new")}><Avatar url={g.author.avatar_url} name={g.author.username} size={58} /></span>
            <span className="tiny truncate">{g.author.display_name || g.author.username}</span>
          </button>
        ))}
        {groups.length === 0 && !me && <span className="muted small" style={{ padding: 12 }}>Henüz hikâye yok.</span>}
      </div>
      <AnimatePresence>
        {open !== null && groups[open] && (
          <StoryViewer groups={groups} start={open} onClose={() => { setOpen(null); void load(); }} />
        )}
      </AnimatePresence>
      <StoryComposer open={create} onClose={() => setCreate(false)} onPosted={() => { setCreate(false); void load(); }} />
    </>
  );
}

function StoryViewer({ groups, start, onClose }: { groups: S.StoryGroup[]; start: number; onClose: () => void }) {
  const navigate = useNavigate();
  const me = useWest((s) => s.account);
  const [g, setG] = useState(start);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewers, setViewers] = useState<Awaited<ReturnType<typeof S.storyViewers>> | null>(null);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const started = useRef(Date.now());
  const elapsed = useRef(0);
  const group = groups[g];
  const story = group?.stories[i];
  const mine = story?.author_id === me?.userId;

  const next = useCallback(() => {
    if (i + 1 < group.stories.length) setI(i + 1);
    else if (g + 1 < groups.length) { setG(g + 1); setI(0); }
    else onClose();
  }, [i, g, group, groups.length, onClose]);
  const prev = () => {
    if (i > 0) setI(i - 1);
    else if (g > 0) { setG(g - 1); setI(groups[g - 1].stories.length - 1); }
  };

  useEffect(() => {
    if (!story) return;
    started.current = Date.now();
    elapsed.current = 0;
    setProgress(0);
    setViewers(null);
    setSent(false);
    if (!mine) void S.markStorySeen(story.id);
  }, [story?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (paused || viewers) return;
    started.current = Date.now() - elapsed.current;
    let raf = 0;
    const tick = () => {
      elapsed.current = Date.now() - started.current;
      const p = elapsed.current / DURATION;
      setProgress(Math.min(1, p));
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, viewers, next, story?.id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!story) return null;
  return (
    <motion.div className="story-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <div className="story-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="story-bars">
          {group.stories.map((s, j) => <span key={s.id}><i style={{ width: `${j < i ? 100 : j === i ? progress * 100 : 0}%` }} /></span>)}
        </div>
        <div className="story-top">
          <button className="row" style={{ gap: 8 }} onClick={() => { onClose(); navigate(`/u/${group.author.username}`); }}>
            <Avatar url={group.author.avatar_url} name={group.author.username} size={32} />
            <strong>{group.author.display_name || group.author.username}</strong>
            <span className="tiny" style={{ opacity: 0.75 }}>{ago(story.created_at)}</span>
          </button>
          <span className="grow" />
          {mine && <button className="icon-btn" title="Sil" onClick={async () => { if (!confirm("Bu hikâye silinsin mi?")) return; await S.deleteStory(story.id); onClose(); }}><Trash2 size={17} /></button>}
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>
        <img src={story.media_url} alt="" referrerPolicy="no-referrer" draggable={false}
          onMouseDown={() => setPaused(true)} onMouseUp={() => setPaused(false)} onMouseLeave={() => setPaused(false)} />
        <button className="story-tap left" onClick={prev} aria-label="Önceki" />
        <button className="story-tap right" onClick={next} aria-label="Sonraki" />
        {story.caption && <p className="story-caption">{story.caption}</p>}
        <div className="story-bottom">
          {mine ? (
            <button className="btn btn-glass" onClick={async () => { setViewers(await S.storyViewers(story.id).catch(() => [])); }}><Eye size={15} /> Görenler</button>
          ) : me ? (
            <form className="story-reply" onSubmit={async (e) => {
              e.preventDefault();
              if (!reply.trim()) return;
              try {
                const conv = await S.startDm(story.author_id);
                await S.sendMessage(conv, `Hikâyene yanıt: ${reply.trim()}`, [{ url: story.media_url }]);
                setReply(""); setSent(true);
              } catch (er) { alert(String(er).replace(/^Error: /, "")); }
            }}>
              <input value={reply} placeholder={sent ? "Gönderildi ✓" : `${group.author.display_name || group.author.username} adlı kişiye yanıt ver`} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} onChange={(e) => setReply(e.target.value)} />
              <button className="icon-btn" type="submit"><Send size={17} /></button>
            </form>
          ) : null}
        </div>
        {viewers && (
          <div className="story-viewers">
            <div className="row" style={{ justifyContent: "space-between" }}><strong><Eye size={15} /> {viewers.length} görüntüleme</strong><button className="icon-btn" onClick={() => setViewers(null)}><X size={16} /></button></div>
            {viewers.map((v) => <div key={v.viewer_id} className="row" style={{ gap: 10, padding: "6px 0" }}><Avatar url={v.profile!.avatar_url} name={v.profile!.username} size={32} /><span className="grow">{v.profile!.display_name || v.profile!.username}</span><span className="muted tiny">{ago(v.viewed_at)}</span></div>)}
            {!viewers.length && <p className="muted small">Henüz kimse görmedi.</p>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function StoryComposer({ open, onClose, onPosted }: { open: boolean; onClose: () => void; onPosted: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFile(null); setCaption(""); setError(null); } }, [open]);
  const pick = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: "Görsel", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    if (typeof p === "string") setFile(p);
  };
  return (
    <Modal open={open} onClose={onClose} title="Hikâye paylaş" width={420}
      footer={<><button className="btn btn-ghost" onClick={onClose}>Vazgeç</button><button className="btn btn-primary" disabled={!file || busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await S.createStory(await api.westUpload(file!, "stories"), caption); onPosted(); } catch (e) { setError(String(e).replace(/^Error: /, "")); } finally { setBusy(false); }
      }}>{busy && <Loader2 size={15} className="spin" />} Paylaş</button></>}>
      <div className="story-new" onClick={() => void pick()}>
        {file ? <img src={isTauri() ? convertFileSrc(file) : file} alt="" /> : <span className="muted"><Plus size={22} /><br />Fotoğraf seç</span>}
      </div>
      <input style={{ width: "100%", marginTop: 10 }} value={caption} maxLength={200} placeholder="Bir şey yaz (isteğe bağlı)" onChange={(e) => setCaption(e.target.value)} />
      <p className="muted tiny" style={{ marginTop: 8 }}>Hikâyeler 24 saat sonra kendiliğinden kaybolur. Gizli hesapsan yalnızca takipçilerin görür.</p>
      {error && <p className="hint error">{error}</p>}
    </Modal>
  );
}
