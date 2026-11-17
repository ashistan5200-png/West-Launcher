import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowLeft, Check, CheckCheck, CornerUpLeft, ImagePlus, Loader2, LogOut, MailPlus, MessagesSquare, Search, Send, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import * as S from "@/lib/social";
import { useWest } from "@/stores/west";
import { useSocial } from "@/stores/social";
import { Modal } from "@/components/Modal";
import { Avatar, RichText, ago } from "./PostCard";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";
import { parseInvite, useInvites } from "@/stores/invites";

const err = (e: unknown) => String(e).replace(/^Error: /, "");
const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date();
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return tx("Bugün");
  if (d.toDateString() === y.toDateString()) return tx("Dün");
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: d.getFullYear() === t.getFullYear() ? undefined : "numeric" });
};

/** Mesajlar: solda sohbetler, sağda seçili sohbet. */
export function MessagesView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = useWest((s) => s.account);
  const refreshUnread = useSocial((s) => s.refreshUnread);
  const [convs, setConvs] = useState<S.Conversation[] | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const load = useCallback(async () => {
    if (!me) return;
    setConvs(await S.conversations(me.userId).catch(() => []));
  }, [me]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(t);
  }, [load]);
  const current = convs?.find((c) => c.id === id) ?? null;

  return (
    <div className={clsx("dm", id && "has-open")}>
      <aside className="dm-list">
        <div className="dm-list-head">
          <h2>{tx("Mesajlar")}</h2>
          <button className="icon-btn" title={tx("Yeni mesaj")} onClick={() => setNewOpen(true)}><MailPlus size={18} /></button>
        </div>
        {convs === null ? <div className="center pad muted"><Loader2 size={18} className="spin" /></div>
          : convs.length === 0 ? <div className="s-empty"><MessagesSquare size={26} /><p>{tx("Henüz mesajın yok.")}</p><button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>{tx("Mesaj yaz")}</button></div>
          : convs.map((c) => {
            const other = c.others[0];
            const name = c.title || c.others.map((o) => o.display_name || o.username).join(", ") || tx("Sohbet");
            return (
              <button key={c.id} className={clsx("dm-conv", c.id === id && "on", c.unread && "unread")} onClick={() => navigate(`/social/messages/${c.id}`)}>
                <Avatar url={other?.avatar_url} name={other?.username ?? "?"} size={44} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row" style={{ gap: 6 }}><strong className="truncate">{name}</strong><span className="muted tiny">{c.last ? ago(c.last.created_at) : ""}</span></span>
                  <span className="muted small truncate">{c.last ? `${c.last.sender_id === me?.userId ? tx("Sen: ") : ""}${parseInvite(c.last.body) ? tx("🎮 Dünya daveti") : c.last.body ?? tx("📷 Fotoğraf")}` : tx("Sohbet başladı")}</span>
                </span>
                {c.unread && <span className="dm-dot" />}
              </button>
            );
          })}
      </aside>
      <section className="dm-chat">
        {current ? <Chat key={current.id} conv={current} onActivity={() => { void load(); void refreshUnread(); }} />
          : <div className="s-empty"><MessagesSquare size={30} /><h3>{tx("Bir sohbet seç")}</h3><p>{tx("Ya da yeni bir mesaj başlat.")}</p><button className="btn btn-primary" onClick={() => setNewOpen(true)}><MailPlus size={15} /> {tx("Yeni mesaj")}</button></div>}
      </section>
      <NewMessageModal open={newOpen} onClose={() => setNewOpen(false)} onStarted={(cid) => { setNewOpen(false); void load(); navigate(`/social/messages/${cid}`); }} />
    </div>
  );
}

function Chat({ conv, onActivity }: { conv: S.Conversation; onActivity: () => void }) {
  const navigate = useNavigate();
  const me = useWest((s) => s.account)!;
  const [msgs, setMsgs] = useState<S.Message[] | null>(null);
  const [members, setMembers] = useState(conv.members);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [reply, setReply] = useState<S.Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const other = conv.others[0];
  const byId = useMemo(() => new Map((msgs ?? []).map((m) => [m.id, m])), [msgs]);

  const toBottom = () => requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
  useEffect(() => {
    S.messages(conv.id).then((m) => { setMsgs(m); setOlder(m.length >= 50); toBottom(); }).catch((e) => { setMsgs([]); setError(err(e)); });
    void S.markConversationRead(conv.id, me.userId).then(onActivity).catch(() => {});
  }, [conv.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Yeni mesajları ve karşı tarafın okuma durumunu birkaç saniyede bir al
  useEffect(() => {
    const t = window.setInterval(async () => {
      if (!msgs) return;
      const last = msgs[msgs.length - 1]?.created_at ?? new Date(0).toISOString();
      const fresh = await S.newerMessages(conv.id, last).catch(() => []);
      setMembers(await S.conversationMembers(conv.id).catch(() => members));
      if (fresh.length) {
        const nearBottom = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop - scroller.current.clientHeight < 120 : true;
        setMsgs((m) => [...(m ?? []), ...fresh.filter((f) => !(m ?? []).some((x) => x.id === f.id))]);
        if (nearBottom) toBottom();
        void S.markConversationRead(conv.id, me.userId).then(onActivity).catch(() => {});
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [msgs, conv.id, me.userId, members, onActivity]);

  const loadOlder = async () => {
    if (!msgs?.length) return;
    const h = scroller.current?.scrollHeight ?? 0;
    const prev = await S.messages(conv.id, msgs[0].created_at);
    setOlder(prev.length >= 50);
    setMsgs([...prev, ...msgs]);
    requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - h; });
  };

  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    setError(null);
    try {
      const media: S.Media[] = [];
      for (const f of files) media.push({ url: await api.westUpload(f, "messages") });
      const m = await S.sendMessage(conv.id, text, media, reply?.id ?? null);
      setMsgs((x) => [...(x ?? []), m]);
      setText(""); setFiles([]); setReply(null);
      toBottom();
      onActivity();
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  const otherRead = members.find((m) => m.user_id !== me.userId)?.last_read_at;
  const myLast = [...(msgs ?? [])].reverse().find((m) => m.sender_id === me.userId);
  const seen = !!myLast && !!otherRead && new Date(otherRead) >= new Date(myLast.created_at);

  return (
    <>
      <header className="dm-chat-head">
        <button className="icon-btn dm-back" onClick={() => navigate("/social/messages")}><ArrowLeft size={18} /></button>
        <button className="row grow" style={{ gap: 10, minWidth: 0, textAlign: "left" }} onClick={() => other && navigate(`/u/${other.username}`)}>
          <Avatar url={other?.avatar_url} name={other?.username ?? "?"} size={36} />
          <span style={{ minWidth: 0 }}><strong className="truncate" style={{ display: "block" }}>{other?.display_name || other?.username}</strong><span className="muted tiny">@{other?.username}</span></span>
        </button>
        <button className="icon-btn" title={tx("Sohbetten ayrıl")} onClick={async () => { if (!await askConfirm(tx("Bu sohbet listenden kaldırılsın mı?"))) return; await S.leaveConversation(conv.id, me.userId); onActivity(); navigate("/social/messages"); }}><LogOut size={17} /></button>
      </header>
      <div className="dm-msgs" ref={scroller}>
        {older && msgs && msgs.length >= 50 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: "center" }} onClick={() => void loadOlder()}>{tx("Daha eski mesajlar")}</button>}
        {msgs === null ? <div className="center pad muted"><Loader2 size={18} className="spin" /></div> : msgs.length === 0 && (
          <div className="dm-intro"><Avatar url={other?.avatar_url} name={other?.username ?? "?"} size={72} /><strong>{other?.display_name || other?.username}</strong><span className="muted small">@{other?.username} {tx("ile sohbetinin başlangıcı")}</span></div>
        )}
        {msgs?.map((m, i) => {
          const mine = m.sender_id === me.userId;
          const newDay = i === 0 || dayLabel(msgs[i - 1].created_at) !== dayLabel(m.created_at);
          const quoted = m.reply_to ? byId.get(m.reply_to) : null;
          return (
            <div key={m.id} className="dm-item">
              {newDay && <div className="dm-day">{dayLabel(m.created_at)}</div>}
              <div className={clsx("dm-msg", mine && "mine")}>
                <div className="dm-bubble">
                  {quoted && <div className="dm-quote">{quoted.body ?? tx("📷 Fotoğraf")}</div>}
                  {m.media.map((x) => <img key={x.url} src={x.url} alt="" referrerPolicy="no-referrer" />)}
                  {m.body && (parseInvite(m.body) ? <InviteBubble msg={m} mine={mine} from={mine ? null : other ?? null} /> : <p><RichText text={m.body} /></p>)}
                  <span className="dm-time">{new Date(m.created_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div className="dm-tools">
                  <button className="icon-btn sm" title={tx("Yanıtla")} onClick={() => setReply(m)}><CornerUpLeft size={14} /></button>
                  {mine && <button className="icon-btn sm" title={tx("Sil")} onClick={async () => { await S.deleteMessage(m.id); setMsgs((x) => x?.filter((y) => y.id !== m.id) ?? null); }}><Trash2 size={14} /></button>}
                </div>
              </div>
            </div>
          );
        })}
        {myLast && msgs?.[msgs.length - 1]?.id === myLast.id && (
          <div className="dm-seen">{seen ? <><CheckCheck size={14} /> {tx("Görüldü")}</> : <><Check size={14} /> {tx("Gönderildi")}</>}</div>
        )}
      </div>
      {error && <p className="hint error" style={{ padding: "0 16px" }}>{error}</p>}
      {reply && <div className="dm-replying"><CornerUpLeft size={14} /> <span className="truncate grow">{reply.body ?? tx("Fotoğraf")}</span><button className="icon-btn sm" onClick={() => setReply(null)}><X size={14} /></button></div>}
      {files.length > 0 && <div className="dm-files">{files.map((f, i) => <span key={f} className="s-chip">{f.split(/[\\/]/).pop()} <button onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={12} /></button></span>)}</div>}
      <form className="dm-input" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <button type="button" className="icon-btn accent" title={tx("Fotoğraf")} onClick={async () => {
          const p = await openDialog({ multiple: true, filters: [{ name: tx("Görsel"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
          const list = Array.isArray(p) ? p : p ? [p] : [];
          setFiles((x) => [...x, ...list].slice(0, 4));
        }}><ImagePlus size={18} /></button>
        <textarea rows={1} value={text} maxLength={2000} placeholder={tx("Bir mesaj yaz")} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="icon-btn accent" type="submit" disabled={busy || (!text.trim() && !files.length)} title={tx("Gönder (Enter)")}>{busy ? <Loader2 size={18} className="spin" /> : <Send size={18} />}</button>
      </form>
    </>
  );
}

function NewMessageModal({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (id: string) => void }) {
  const me = useWest((s) => s.account);
  const [q, setQ] = useState("");
  const [list, setList] = useState<S.Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    const t = window.setTimeout(() => {
      (q.trim() ? S.searchProfiles(q.trim(), 12) : me ? S.followList(me.userId, "following") : Promise.resolve([])).then((l) => setList(l.filter((p) => p.id !== me?.userId))).catch(() => setList([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, open, me]);
  return (
    <Modal open={open} onClose={onClose} title={tx("Yeni mesaj")} width={440}>
      <div className="s-search" style={{ marginBottom: 8 }}><Search size={15} /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tx("Kişi ara")} /></div>
      {error && <p className="hint error">{error}</p>}
      <div className="s-follow-list">
        {list.map((p) => (
          <button key={p.id} className="s-user" style={{ width: "100%" }} onClick={async () => { try { onStarted(await S.startDm(p.id)); } catch (e) { setError(err(e)); } }}>
            <Avatar url={p.avatar_url} name={p.username} size={40} />
            <span className="grow" style={{ minWidth: 0, textAlign: "left" }}><strong className="truncate">{p.display_name || p.username}</strong><span className="muted tiny">@{p.username}</span></span>
          </button>
        ))}
        {!list.length && <p className="muted center pad small">{q ? tx("Kimse bulunamadı.") : tx("Bir kullanıcı adı yaz.")}</p>}
      </div>
    </Modal>
  );
}

/** Sohbetteki dünya daveti: ham metin yerine tıklanabilir kart */
function InviteBubble({ msg, mine, from }: { msg: S.Message; mine: boolean; from: S.Profile | null }) {
  const d = parseInvite(msg.body)!;
  const open = useInvites((s) => s.open);
  const fresh = Date.now() - new Date(msg.created_at).getTime() < 2 * 60 * 60 * 1000;
  return (
    <div className="dm-invite">
      <span className="invite-eyebrow">{tx("Dünya daveti")}</span>
      <strong>{d.world}</strong>
      <span className="muted tiny">{d.version ? `${d.loader ? d.loader + " " : ""}${d.version}` : tx("Sürüm bilinmiyor")}</span>
      {mine ? (
        <span className="muted tiny">{tx("Davet gönderildi")}</span>
      ) : fresh ? (
        <button className="btn btn-primary btn-sm" onClick={() => open({ ...d, id: msg.id, conversationId: msg.conversation_id, from, fromId: msg.sender_id, at: msg.created_at })}>{tx("Katıl")}</button>
      ) : (
        <span className="muted tiny">{tx("Bu davetin süresi doldu")}</span>
      )}
    </div>
  );
}
