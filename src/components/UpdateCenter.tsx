import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpCircle, Check, ExternalLink, Loader2, X } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Modal } from "./Modal";
import { useUpdate } from "@/stores/update";
import { locale, tx } from "@/lib/i18n";

const fmtMB = (b: number) => `${(b / 1_048_576).toFixed(1)} MB`;

/** Commit mesajından gelen sürüm notlarını sade bir listeye çevirir. */
function Notes({ text }: { text: string }) {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l.trim()));
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={`u${blocks.length}`}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>);
    list = [];
  };
  lines.forEach((raw, i) => {
    const l = raw.trim();
    if (/^[-*•]\s+/.test(l)) {
      list.push(l.replace(/^[-*•]\s+/, ""));
    } else if (/^\s{2,}\S/.test(raw) && list.length) {
      list[list.length - 1] += " " + l; // devam satırı
    } else {
      flush();
      if (l) blocks.push(i === 0 ? <p key={i} className="update-headline">{l}</p> : <p key={i}>{l}</p>);
    }
  });
  flush();
  return <div className="update-notes">{blocks.length ? blocks : <p className="muted">{tx("Bu sürüm için not eklenmemiş.")}</p>}</div>;
}

/** Başlık çubuğundaki güncelleme düğmesi — yalnızca yeni sürüm varken görünür. */
export function UpdateButton() {
  const { status, setOpen, bind } = useUpdate();
  useEffect(() => {
    const un = bind();
    return () => void un.then((f) => f());
  }, [bind]);

  const info = status?.info;
  return (
    <AnimatePresence>
      {info && (
        <motion.button
          className={`update-pill ${status.downloaded ? "ready" : ""}`}
          onClick={() => setOpen(true)}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          title={tx("West Client {0} hazır", info.version)}
        >
          {status.downloading ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={14} />}
          <span>{status.downloaded ? tx("Güncelle") : tx("Güncelleme")} · v{info.version}</span>
          <span className="update-dot" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}

export function UpdateModal() {
  const { status, open, setOpen, install, installing, error } = useUpdate();
  const info = status?.info;
  if (!info) return null;
  const pct = status.total ? Math.round((status.received / status.total) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={() => !installing && setOpen(false)}
      title={tx("Yeni sürüm hazır")}
      width={500}
      footer={
        <>
          <button className="btn btn-ghost" disabled={installing} onClick={() => openUrl(info.pageUrl)}>
            <ExternalLink size={14} /> {tx("GitHub'da gör")}
          </button>
          <span className="grow" />
          <button className="btn btn-ghost" disabled={installing} onClick={() => setOpen(false)}>{tx("Sonra")}</button>
          <button className="btn btn-primary" disabled={installing || status.downloading} onClick={() => void install()}>
            {installing ? <Loader2 size={15} className="spin" /> : <ArrowUpCircle size={15} />}
            {installing ? tx("Kuruluyor…") : status.downloaded ? tx("Güncelle ve yeniden başlat") : tx("İndir ve güncelle")}
          </button>
        </>
      }
    >
      <div className="update-versions">
        <div><span className="muted tiny">{tx("Şu anki")}</span><strong>v{info.current}</strong></div>
        <span className="update-arrow">→</span>
        <div><span className="muted tiny">{tx("Yeni")}</span><strong className="accent">v{info.version}</strong></div>
        <span className="grow" />
        <span className="muted tiny">
          {info.publishedAt ? new Date(info.publishedAt).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }) : ""}
          {info.size ? ` · ${fmtMB(info.size)}` : ""}
        </span>
      </div>

      <h4 className="update-title">{tx("Neler yeni")}</h4>
      <Notes text={info.notes} />

      {status.downloading && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny muted">{tx("İndiriliyor… %")}{pct}</span>
          <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {status.downloaded && !installing && (
        <p className="hint ok"><Check size={13} /> {tx("İndirildi ve doğrulandı. Güncelleme birkaç saniye sürer; launcher kapanıp yeni sürümle açılır.")}</p>
      )}
      {(error || status.error) && <p className="hint error">{error ?? status.error}</p>}
    </Modal>
  );
}

/** Ayarlar'daki "Güncellemeler" kartı. */

const SKIP_KEY = "west.update.later";

/**
 * Başlık çubuğunun altında, yeni sürüm bulununca kendiliğinden açılan şerit. Kurulum yalnızca kullanıcı
 * "Güncelle" deyince başlar; "Sonra" o sürüm için şeridi kapatır (başlıktaki düğme kalır).
 */
export function UpdateBanner() {
  const { status, setOpen, install, installing } = useUpdate();
  const info = status?.info;
  const [later, setLater] = useState<string | null>(() => { try { return localStorage.getItem(SKIP_KEY); } catch { return null; } });
  const show = !!info && later !== info.version;
  const pct = status?.total ? Math.round((status.received / status.total) * 100) : 0;
  const first = info?.notes.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !/^(Co-Authored-By|Claude-Session):/i.test(l)) ?? "";
  return (
    <AnimatePresence>
      {show && info && (
        <motion.div className="update-banner" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="update-banner-in">
            <ArrowUpCircle size={16} />
            <strong>{tx("West Client v{0} çıktı", info.version)}</strong>
            <span className="muted small truncate">{first}</span>
            <span className="grow" />
            {status?.downloading && <span className="muted tiny">{tx("İndiriliyor… %")}{pct}</span>}
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{tx("Neler yeni")}</button>
            <button className="btn btn-primary btn-sm" disabled={installing || status?.downloading} onClick={() => (status?.downloaded ? void install() : setOpen(true))}>
              {installing ? <Loader2 size={14} className="spin" /> : null} {status?.downloaded ? tx("Şimdi güncelle") : tx("Güncelle")}
            </button>
            <button className="icon-btn" title={tx("Sonra")} onClick={() => { try { localStorage.setItem(SKIP_KEY, info.version); } catch { /* yok say */ } setLater(info.version); }}><X size={15} /></button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
