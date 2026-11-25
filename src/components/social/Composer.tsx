import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BarChart3, Globe2, ImagePlus, Loader2, Lock, MessageSquare, Plus, X } from "lucide-react";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import * as S from "@/lib/social";
import { useSocial } from "@/stores/social";
import { Avatar, QuoteEmbed } from "./PostCard";
import { tx } from "@/lib/i18n";
import { errorText } from "@/lib/format";

const MAX = 500;
const HOURS = [{ h: 1, l: tx("1 saat") }, { h: 24, l: tx("1 gün") }, { h: 72, l: tx("3 gün") }, { h: 168, l: tx("7 gün") }];
const POLICY: Record<S.Post["reply_policy"], string> = { everyone: tx("Herkes yanıtlayabilir"), following: tx("Takip ettiklerim yanıtlayabilir"), mentioned: tx("Yalnızca bahsettiklerim yanıtlayabilir") };

/** Gönderi yazma kutusu (akışın üstünde ya da pencere olarak). */
export function Composer({ replyTo, quoteOf, onPosted, autoFocus, compact }: { replyTo?: string; quoteOf?: string; onPosted?: (p: S.Post) => void; autoFocus?: boolean; compact?: boolean }) {
  const me = useSocial((s) => s.me);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [hours, setHours] = useState(24);
  const [audience, setAudience] = useState<S.Post["audience"]>("everyone");
  const [policy, setPolicy] = useState<S.Post["reply_policy"]>("everyone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = MAX - text.length;
  const pollOk = !poll || (poll.filter((o) => o.trim()).length >= 2 && poll.every((o) => o.length <= 25));
  const can = !busy && left >= 0 && pollOk && (text.trim().length > 0 || files.length > 0);

  const pick = async () => {
    const p = await openDialog({ multiple: true, filters: [{ name: tx("Görsel"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    const list = Array.isArray(p) ? p : p ? [p] : [];
    setFiles((f) => [...f, ...list].slice(0, 4));
    setPoll(null);
  };

  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    try {
      const media: S.Media[] = [];
      for (const f of files) media.push({ url: await api.westUpload(f, "posts") });
      const post = await S.createPost({
        body: text, media, reply_to: replyTo ?? null, quote_of: quoteOf ?? null, audience, reply_policy: policy,
        poll: poll ? { options: poll.map((o) => o.trim()).filter(Boolean), hours } : null,
      });
      setText(""); setFiles([]); setPoll(null);
      if (post) onPosted?.(post);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!me) return null;
  return (
    <div className={clsx("composer", compact && "compact")}>
      <Avatar url={me.avatar_url} name={me.username} />
      <div className="composer-main">
        <textarea
          value={text}
          autoFocus={autoFocus}
          placeholder={replyTo ? tx("Yanıtını yaz") : quoteOf ? tx("Bir yorum ekle") : tx("Neler oluyor? #etiket ve @kişi kullanabilirsin")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(); }}
          rows={compact ? 2 : 3}
        />
        {quoteOf && <QuoteEmbed id={quoteOf} />}
        {files.length > 0 && (
          <div className={tx("s-media n{0} edit", files.length)}>
            {files.map((f, i) => (
              <div key={f + i} className="composer-img">
                <img src={isTauri() ? convertFileSrc(f) : f} alt="" />
                <button className="composer-x" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label={tx("Kaldır")}><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {poll && (
          <div className="composer-poll">
            {poll.map((o, i) => (
              <input key={i} value={o} maxLength={25} placeholder={tx("Seçenek {0}", i + 1)} onChange={(e) => setPoll(poll.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            <div className="row">
              {poll.length < 4 && <button className="btn btn-ghost btn-sm" onClick={() => setPoll([...poll, ""])}><Plus size={14} /> {tx("Seçenek")}</button>}
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{HOURS.map((h) => <option key={h.h} value={h.h}>{h.l}</option>)}</select>
              <button className="btn-link" onClick={() => setPoll(null)}>{tx("Anketi kaldır")}</button>
            </div>
          </div>
        )}
        {!replyTo && (
          <div className="composer-opts">
            <button className="composer-opt" onClick={() => setAudience(audience === "everyone" ? "followers" : "everyone")}>
              {audience === "everyone" ? <><Globe2 size={13} /> {tx("Herkes görebilir")}</> : <><Lock size={13} /> {tx("Yalnızca takipçilerim")}</>}
            </button>
            <button className="composer-opt" onClick={() => setPolicy(policy === "everyone" ? "following" : policy === "following" ? "mentioned" : "everyone")}>
              <MessageSquare size={13} /> {POLICY[policy]}
            </button>
          </div>
        )}
        {error && <p className="hint error">{error}</p>}
        <div className="composer-bar">
          <button className="icon-btn accent" title={tx("Fotoğraf ekle (en fazla 4)")} disabled={files.length >= 4 || !!poll} onClick={() => void pick()}><ImagePlus size={18} /></button>
          {!replyTo && <button className="icon-btn accent" title={tx("Anket")} disabled={files.length > 0 || !!poll} onClick={() => setPoll(["", ""])}><BarChart3 size={18} /></button>}
          <span className="grow" />
          {text.length > 0 && (
            <span className={clsx("composer-count", left < 20 && "warn", left < 0 && "over")}>
              <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" className="trk" /><circle cx="11" cy="11" r="9" className="val" style={{ strokeDasharray: `${Math.min(1, text.length / MAX) * 56.5} 56.5` }} /></svg>
              {left < 20 && <span>{left}</span>}
            </span>
          )}
          <button className="btn btn-primary" disabled={!can} onClick={() => void submit()}>
            {busy && <Loader2 size={15} className="spin" />} {replyTo ? tx("Yanıtla") : tx("Paylaş")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Yanıt / alıntı / yeni gönderi penceresi (her yerden açılabilir). */
export function ComposeModal() {
  const { composeOpen, composeCtx, closeCompose } = useSocial();
  const target = composeCtx?.replyTo ? S.cachedPost(composeCtx.replyTo) : null;
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeCompose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [closeCompose]);
  return (
    <AnimatePresence>
      {composeOpen && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={closeCompose}>
          <motion.div className="compose-modal" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{composeCtx?.replyTo ? tx("Yanıtla") : composeCtx?.quoteOf ? tx("Alıntıla") : tx("Yeni gönderi")}</strong>
              <button className="icon-btn" onClick={closeCompose} aria-label={tx("Kapat")}><X size={17} /></button>
            </div>
            {target && (
              <div className="compose-target">
                <Avatar url={target.avatar_url} name={target.username} size={32} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <strong>{target.display_name || target.username}</strong> <span className="muted">@{target.username}</span>
                  <p className="small muted clamp-2">{target.body}</p>
                  <span className="tiny muted">@{target.username} {tx("adlı kişiye yanıt")}</span>
                </div>
              </div>
            )}
            <Composer replyTo={composeCtx?.replyTo} quoteOf={composeCtx?.quoteOf} autoFocus onPosted={() => { closeCompose(); window.dispatchEvent(new CustomEvent("west:posted")); }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
