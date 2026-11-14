import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpCircle, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { Modal } from "./Modal";
import { useUpdate } from "@/stores/update";

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
  return <div className="update-notes">{blocks.length ? blocks : <p className="muted">Bu sürüm için not eklenmemiş.</p>}</div>;
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
          title={`West Launcher ${info.version} hazır`}
        >
          {status.downloading ? <Loader2 size={13} className="spin" /> : <ArrowUpCircle size={14} />}
          <span>{status.downloaded ? "Güncelle" : "Güncelleme"} · v{info.version}</span>
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
      title="Yeni sürüm hazır"
      width={500}
      footer={
        <>
          <button className="btn btn-ghost" disabled={installing} onClick={() => openUrl(info.pageUrl)}>
            <ExternalLink size={14} /> GitHub'da gör
          </button>
          <span className="grow" />
          <button className="btn btn-ghost" disabled={installing} onClick={() => setOpen(false)}>Sonra</button>
          <button className="btn btn-primary" disabled={installing || status.downloading} onClick={() => void install()}>
            {installing ? <Loader2 size={15} className="spin" /> : <ArrowUpCircle size={15} />}
            {installing ? "Kuruluyor…" : status.downloaded ? "Güncelle ve yeniden başlat" : "İndir ve güncelle"}
          </button>
        </>
      }
    >
      <div className="update-versions">
        <div><span className="muted tiny">Şu anki</span><strong>v{info.current}</strong></div>
        <span className="update-arrow">→</span>
        <div><span className="muted tiny">Yeni</span><strong className="accent">v{info.version}</strong></div>
        <span className="grow" />
        <span className="muted tiny">
          {info.publishedAt ? new Date(info.publishedAt).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) : ""}
          {info.size ? ` · ${fmtMB(info.size)}` : ""}
        </span>
      </div>

      <h4 className="update-title">Neler yeni</h4>
      <Notes text={info.notes} />

      {status.downloading && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny muted">İndiriliyor… %{pct}</span>
          <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {status.downloaded && !installing && (
        <p className="hint ok"><Check size={13} /> İndirildi ve doğrulandı. Güncelleme birkaç saniye sürer; launcher kapanıp yeni sürümle açılır.</p>
      )}
      {(error || status.error) && <p className="hint error">{error ?? status.error}</p>}
    </Modal>
  );
}

/** Ayarlar'daki "Güncellemeler" kartı. */
export function UpdateSettings({ autoUpdate, onToggle }: { autoUpdate: boolean; onToggle: (v: boolean) => void }) {
  const { status, check, checking, setOpen, error } = useUpdate();
  const info = status?.info;
  return (
    <section className="card stack">
      <h3>Güncellemeler</h3>
      <div className="row">
        <span className="grow small">
          West Launcher <strong>v{status?.current ?? "…"}</strong>
          {info ? <> · <span className="accent">v{info.version} hazır</span></> : status && !checking ? " · en güncel sürüm" : ""}
        </span>
        {info ? (
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><ArrowUpCircle size={14} /> Güncelle</button>
        ) : (
          <button className="btn btn-ghost btn-sm" disabled={checking} onClick={() => void check()}>
            <RefreshCw size={14} className={checking ? "spin" : ""} /> Denetle
          </button>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={autoUpdate} onChange={(e) => onToggle(e.target.checked)} />
        Yeni sürümleri arka planda indir (kurulum için yine onayın istenir)
      </label>
      {error && <p className="hint error">{error}</p>}
    </section>
  );
}
