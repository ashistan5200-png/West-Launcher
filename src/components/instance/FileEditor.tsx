import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2, RotateCcw, Save, Search, Table2, X } from "lucide-react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";
import { errorText } from "@/lib/format";

/** Uygulama içinde düzenlenebilen metin dosyaları */
export const EDITABLE = /\.(txt|json|json5|toml|cfg|conf|properties|ini|ya?ml|snbt|md|js|mcmeta)$/i;

const err = (e: unknown) => errorText(e);

/** options.txt satırları "anahtar:değer" biçimindedir. Değerde de ":" olabilir, ilkinden bölünür. */
type Line = { key: string; value: string } | { raw: string };
const parseOptions = (text: string): Line[] =>
  text.split(/\r?\n/).map((raw) => {
    const i = raw.indexOf(":");
    return i > 0 ? { key: raw.slice(0, i), value: raw.slice(i + 1) } : { raw };
  });
const joinOptions = (lines: Line[]) => lines.map((l) => ("raw" in l ? l.raw : `${l.key}:${l.value}`)).join("\n");

/** Tuş atamalarını okunur yapar: "key.keyboard.left.shift" → "Sol Shift", "key.mouse.left" → "Sol tık" */
const MOUSE: Record<string, string> = { "key.mouse.left": tx("Sol tık"), "key.mouse.right": tx("Sağ tık"), "key.mouse.middle": tx("Orta tık") };
const prettyKey = (v: string) => {
  if (v === "key.keyboard.unknown") return tx("— atanmadı —");
  if (MOUSE[v]) return MOUSE[v];
  const k = v
    .replace(/^key\.(keyboard|mouse)\./, "")
    .replace(/^left\./, "Sol ").replace(/^right\./, "Sağ ")
    .replace("control", "Ctrl").replace("shift", "Shift").replace("alt", "Alt");
  return k.length === 1 ? k.toUpperCase() : k;
};

export function FileEditor({ instanceId, path, onClose }: { instanceId: string; path: string | null; onClose: () => void }) {
  const running = useInstances((s) => s.running[instanceId] !== undefined);
  const [orig, setOrig] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOptions = !!path && /(^|\/)options(of)?\.txt$/i.test(path);
  const [table, setTable] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!path) return;
    setOrig(null); setError(null); setSaved(false); setQ("");
    api.readInstanceText(instanceId, path).then((t) => { setOrig(t); setText(t); }).catch((e) => setError(err(e)));
  }, [instanceId, path]);

  const lines = useMemo(() => (isOptions ? parseOptions(text) : []), [isOptions, text]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !("raw" in l) && (!needle || l.key.toLowerCase().includes(needle) || l.value.toLowerCase().includes(needle)));
  }, [lines, q]);
  const dirty = orig !== null && text !== orig;

  const setValue = (index: number, value: string) => {
    const next = [...lines];
    const l = next[index];
    if ("raw" in l) return;
    next[index] = { ...l, value };
    setText(joinOptions(next));
    setSaved(false);
  };

  const save = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try {
      await api.writeInstanceText(instanceId, path, text);
      setOrig(text);
      setSaved(true);
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };

  const close = async () => {
    if (dirty && !await askConfirm(tx("Kaydedilmemiş değişiklikler kaybolacak. Kapatılsın mı?"))) return;
    onClose();
  };

  return (
    <AnimatePresence>
      {path && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}>
          <motion.div className="fedit" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (dirty) void save(); } }}>
            <header className="fedit-head">
              <FileText size={17} className="accent-fg" />
              <strong className="grow truncate">{path}</strong>
              {isOptions && (
                <div className="segmented mini">
                  <button className={clsx(table && "active")} onClick={() => setTable(true)}><Table2 size={13} /> {tx("Ayarlar")}</button>
                  <button className={clsx(!table && "active")} onClick={() => setTable(false)}><FileText size={13} /> {tx("Metin")}</button>
                </div>
              )}
              <button className="icon-btn" onClick={close} aria-label={tx("Kapat")}><X size={17} /></button>
            </header>

            {running && <div className="banner banner-warn">{tx("Oyun açık. Minecraft kapanırken options.txt'yi yeniden yazar; değişikliklerin kaybolmaması için önce oyunu kapat.")}</div>}
            {error && <div className="banner banner-error">{error}</div>}

            {orig === null && !error ? (
              <div className="center pad"><Loader2 className="spin" size={18} /></div>
            ) : isOptions && table ? (
              <div className="fedit-table">
                <label className="ctab-search"><Search size={15} /><input value={q} autoFocus placeholder={tx("Ayar ara: fov, key_, guiScale…")} onChange={(e) => setQ(e.target.value)} /></label>
                <div className="fedit-rows">
                  {shown.map(({ l, i }) => {
                    if ("raw" in l) return null;
                    const isKey = l.key.startsWith("key_");
                    return (
                      <label key={i} className="fedit-row">
                        <span className="truncate" title={l.key}>{isKey ? <><kbd>⌨</kbd> {l.key.replace(/^key_key\./, "").replace(/^key_/, "")}</> : l.key}</span>
                        <input value={l.value} spellCheck={false} onChange={(e) => setValue(i, e.target.value)} />
                        {isKey && <span className="muted tiny truncate">{prettyKey(l.value)}</span>}
                      </label>
                    );
                  })}
                  {!shown.length && <p className="muted small pad">{tx("Eşleşen ayar yok.")}</p>}
                </div>
              </div>
            ) : (
              <textarea className="fedit-text" value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setSaved(false); }} />
            )}

            <footer className="fedit-foot">
              <span className="muted tiny grow">{saved ? tx("Kaydedildi ✓") : dirty ? tx("Kaydedilmemiş değişiklikler var · Ctrl+S") : tx("Değişiklik yok")}</span>
              <button className="btn btn-ghost btn-sm" disabled={!dirty} onClick={() => { setText(orig ?? ""); setSaved(false); }}><RotateCcw size={14} /> {tx("Geri al")}</button>
              <button className="btn btn-primary btn-sm" disabled={!dirty || busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {tx("Kaydet")}</button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
