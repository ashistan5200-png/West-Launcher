import { useEffect, useMemo, useRef, useState } from "react";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Archive, ChevronRight, File, FileCog, FilePen, FileWarning, Folder, FolderOpen, Globe2, HardDrive, Loader2, Package, ScrollText, Share2, Terminal, Trash2 } from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import { formatRelative, errorText } from "@/lib/format";
import type { ExportReport, FileEntry, Instance, LogFile, World } from "@/lib/types";
import { EDITABLE, FileEditor } from "./FileEditor";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";
import { PackSyncCard } from "@/components/features/PackSyncCard";
import { useSolver } from "@/stores/solver";
import { AshiHead } from "@/components/AshiHead";
import { useInstances } from "@/stores/instances";

const fmtSize = (b: number) => (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fromUnix = (s: number | null) => (s ? new Date(s * 1000).toISOString() : null);
const errText = (e: unknown) => errorText(e);

// ───────── Dünyalar ─────────
export function WorldsTab({ instanceId, locked }: { instanceId: string; locked: boolean }) {
  const [worlds, setWorlds] = useState<World[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => api.listWorlds(instanceId).then(setWorlds).catch(() => setWorlds([]));
  useEffect(() => void load(), [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const backup = async (w: World) => {
    setBusy(w.folder);
    try {
      const p = await api.backupWorld(instanceId, w.folder);
      setMsg({ ok: true, text: tx("\"{0}\" yedeklendi: {1}", w.folder, p.split(/[\\/]/).pop()) });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async (w: World) => {
    if (!await askConfirm(tx("\"{0}\" dünyası çöp kutusuna taşınsın mı? Önce yedek almanı öneririm.", w.folder))) return;
    try {
      await api.deleteWorld(instanceId, w.folder);
      await load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    }
  };

  return (
    <div className="stack">
      <div className="ctab-bar">
        <span className="muted small grow">{worlds ? tx("{0} dünya", worlds.length) : ""}</span>
        <button className="btn-link" onClick={async () => api.openPath(await api.worldBackupsDir(instanceId)).catch(() => setMsg({ ok: false, text: tx("Henüz yedek yok.") }))}><Archive size={16} /> {tx("Yedekler klasörü")}</button>
        <button className="btn-link" onClick={async () => api.openPath(await api.filePath(instanceId, "saves")).catch(() => {})}><FolderOpen size={16} /> {tx("saves klasörü")}</button>
      </div>
      {msg && <div className={clsx("banner", msg.ok ? "banner-ok" : "banner-error")}>{msg.text}</div>}
      {worlds === null ? (
        <div className="ctable-empty"><Loader2 size={18} className="spin" /></div>
      ) : worlds.length === 0 ? (
        <div className="ctable-empty"><Globe2 size={22} className="muted" /><p className="muted">{tx("Bu instance'ta henüz dünya yok.")}</p></div>
      ) : (
        <div className="world-grid">
          {worlds.map((w) => (
            <div key={w.folder} className="world-card">
              {w.icon ? <img src={w.icon} alt="" className="world-icon" /> : <div className="world-icon ph"><Globe2 size={22} /></div>}
              <div className="grow" style={{ minWidth: 0 }}>
                <strong className="truncate" style={{ display: "block" }}>{w.folder}</strong>
                <span className="muted tiny">{formatRelative(fromUnix(w.lastPlayed))} · {fmtSize(w.size)}</span>
              </div>
              <button className="icon-btn" title={tx("Yedekle")} disabled={busy === w.folder} onClick={() => void backup(w)}>{busy === w.folder ? <Loader2 size={17} className="spin" /> : <Archive size={17} />}</button>
              <button className="icon-btn" title={tx("Klasörü aç")} onClick={async () => api.openPath(await api.filePath(instanceId, `saves/${w.folder}`))}><FolderOpen size={17} /></button>
              <button className="icon-btn danger" title={tx("Sil")} disabled={locked} onClick={() => void remove(w)}><Trash2 size={17} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────── Loglar ─────────
const level = (l: string) => (/\b(ERROR|FATAL)\b|Exception|^\s+at /.test(l) ? "err" : /\bWARN\b/.test(l) ? "warn" : "");

export function LogsTab({ instanceId, live }: { instanceId: string; live: { line: string; stderr: boolean }[] }) {
  const [files, setFiles] = useState<LogFile[]>([]);
  const [sel, setSel] = useState<string>("live");
  const [text, setText] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => void api.listLogs(instanceId).then(setFiles).catch(() => setFiles([])), [instanceId]);
  useEffect(() => {
    if (sel === "live") return setText(null);
    setText(null);
    api.readLog(instanceId, sel).then(setText).catch((e) => setText(errText(e)));
  }, [instanceId, sel]);

  const lines = useMemo(() => {
    const src = sel === "live" ? live : (text ?? "").split(/\r?\n/).map((line) => ({ line, stderr: false }));
    const f = filter.trim().toLowerCase();
    return f ? src.filter((l) => l.line.toLowerCase().includes(f)) : src;
  }, [sel, live, text, filter]);

  useEffect(() => {
    if (ref.current && sel === "live") ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, sel]);

  return (
    <div className="logs-split">
      <aside className="logs-list">
        <button className={clsx("logs-item", sel === "live" && "on")} onClick={() => setSel("live")}><Terminal size={15} /> {tx("Canlı konsol")}</button>
        {files.map((f) => (
          <button key={f.path} className={clsx("logs-item", sel === f.path && "on", f.crash && "crash")} onClick={() => setSel(f.path)} title={f.path}>
            {f.crash ? <FileWarning size={15} /> : <ScrollText size={15} />}
            <span className="truncate">{f.path.split("/")[1]}</span>
            <span className="tiny muted">{formatRelative(fromUnix(f.modified))}</span>
          </button>
        ))}
      </aside>
      <div className="stack" style={{ minWidth: 0 }}>
        <div className="ctab-bar">
          <input className="logs-filter" placeholder={tx("Loglarda ara…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {sel !== "live" && (sel.startsWith("crash-reports/") || sel === "logs/latest.log") && (
            <button className="btn btn-primary btn-sm solver-btn" onClick={() => void useSolver.getState().solve(instanceId, useInstances.getState().instances.find((i) => i.id === instanceId)?.name ?? "", { file: sel })}>
              <AshiHead size={16} /> {tx("Ashi'ye çözdür")}
            </button>
          )}
          {sel !== "live" && <button className="btn-link" onClick={async () => api.openPath(await api.filePath(instanceId, sel))}><FolderOpen size={16} /> {tx("Dosyayı aç")}</button>}
        </div>
        <div className="console" ref={ref}>
          {sel !== "live" && text === null ? <Loader2 size={16} className="spin" /> : lines.length === 0 ? (
            <span className="muted">{sel === "live" ? tx("Oyun başlatıldığında loglar burada akacak.") : tx("Eşleşen satır yok.")}</span>
          ) : (
            lines.slice(-6000).map((l, i) => <div key={i} className={clsx("log-line", l.stderr && "stderr", level(l.line))}>{l.line}</div>)
          )}
        </div>
      </div>
    </div>
  );
}

// ───────── Dosyalar ─────────
export function FilesTab({ instanceId }: { instanceId: string }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [hasOptions, setHasOptions] = useState(false);
  useEffect(() => {
    setEntries(null);
    setError(null);
    api.listFiles(instanceId, path).then(setEntries).catch((e) => { setEntries([]); setError(errText(e)); });
  }, [instanceId, path]);
  useEffect(() => {
    api.listFiles(instanceId, "").then((es) => setHasOptions(es.some((e) => e.name === "options.txt"))).catch(() => setHasOptions(false));
  }, [instanceId]);
  const crumbs = path ? path.split("/") : [];
  const rel = (e: FileEntry) => (path ? `${path}/${e.name}` : e.name);
  const open = async (e: FileEntry) => {
    if (e.dir) setPath(rel(e));
    else if (EDITABLE.test(e.name)) setEditing(rel(e));
    else await api.openPath(await api.filePath(instanceId, rel(e))).catch((x) => setError(errText(x)));
  };

  return (
    <div className="stack">
      <div className="ctab-bar">
        <nav className="crumbs grow">
          <button onClick={() => setPath("")}><HardDrive size={15} /> minecraft</button>
          {crumbs.map((c, i) => (
            <span key={i} className="row" style={{ gap: 4 }}>
              <ChevronRight size={14} className="muted" />
              <button onClick={() => setPath(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
            </span>
          ))}
        </nav>
        {hasOptions && <button className="btn-link" onClick={() => setEditing("options.txt")}><FileCog size={16} /> {tx("Oyun ayarları (options.txt)")}</button>}
        <button className="btn-link" onClick={async () => api.openPath(await api.filePath(instanceId, path)).catch((x) => setError(errText(x)))}><FolderOpen size={16} /> {tx("Klasörde aç")}</button>
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <div className="ctable">
        {entries === null ? <div className="ctable-empty"><Loader2 size={18} className="spin" /></div> : entries.length === 0 ? <div className="ctable-empty muted">{tx("Klasör boş.")}</div> : entries.map((e) => (
          <button key={e.name} className="frow" onDoubleClick={() => void open(e)} onClick={() => e.dir && void open(e)}>
            {e.dir ? <Folder size={17} className="accent-fg" /> : EDITABLE.test(e.name) ? <FilePen size={17} className="muted" /> : <File size={17} className="muted" />}
            <span className="grow truncate">{e.name}</span>
            <span className="muted tiny">{e.dir ? "" : fmtSize(e.size)}</span>
            <span className="muted tiny frow-date">{formatRelative(fromUnix(e.modified))}</span>
          </button>
        ))}
      </div>
      <p className="muted tiny">{tx("Ayar dosyalarına (txt, json, toml, cfg…) çift tıklayınca West Client içinde düzenlenir; diğerleri bilgisayarındaki uygulamayla açılır.")}</p>
      <FileEditor instanceId={instanceId} path={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

// ───────── Paylaş ─────────
const EXTRA_CANDIDATES = [
  { path: "config", label: tx("Mod ayarları (config)") },
  { path: "options.txt", label: tx("Oyun ayarları (options.txt)") },
  { path: "defaultconfigs", label: tx("Varsayılan ayarlar (defaultconfigs)") },
  { path: "kubejs", label: tx("KubeJS betikleri") },
  { path: "servers.dat", label: tx("Sunucu listesi") },
];

export function ShareTab({ instance }: { instance: Instance }) {
  const [present, setPresent] = useState<string[]>([]);
  const [extras, setExtras] = useState<string[]>(["config"]);
  const [version, setVersion] = useState("1.0.0");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listFiles(instance.id, "").then((es) => setPresent(es.map((e) => e.name))).catch(() => setPresent([]));
  }, [instance.id]);
  const available = EXTRA_CANDIDATES.filter((c) => present.includes(c.path));

  const run = async () => {
    const dest = await saveDialog({ defaultPath: tx("{0}-{1}.mrpack", instance.name.replace(/[\\/:*?"<>|]/g, ""), version), filters: [{ name: "Modrinth modpack", extensions: ["mrpack"] }] });
    if (!dest) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.exportMrpack(instance.id, dest, version, extras.filter((x) => present.includes(x))));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-grid">
      <PackSyncCard instance={instance} />
      <section className="card stack">
        <h3><Share2 size={17} /> {tx("Modpack olarak paylaş")}</h3>
        <p className="small">
          {tx("Bu instance'ı tek bir")} <code>.mrpack</code> {tx("dosyasına dönüştürür. Modrinth'te bulunan modlar pakete bağlantı olarak eklenir, böylece dosya küçük kalır; bulunamayanlar ve seçtiğin ayarlar pakete gömülür. Arkadaşın dosyayı West Client, Modrinth App ya da Prism Launcher ile açabilir.")}
        </p>
        <label className="field"><span>{tx("Paket sürümü")}</span><input value={version} onChange={(e) => setVersion(e.target.value)} /></label>
        {available.length > 0 && (
          <div className="field">
            <span>{tx("Pakete eklenecekler")}</span>
            {available.map((c) => (
              <label key={c.path} className="check">
                <input type="checkbox" checked={extras.includes(c.path)} onChange={(e) => setExtras((x) => (e.target.checked ? [...x, c.path] : x.filter((y) => y !== c.path)))} /> {c.label}
              </label>
            ))}
          </div>
        )}
        <p className="muted tiny">{tx("Dünyalar, ekran görüntüleri ve hesap bilgilerin pakete eklenmez.")}</p>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !version.trim()} onClick={() => void run()}>{busy ? <Loader2 size={15} className="spin" /> : <Package size={15} />} {tx(".mrpack oluştur")}</button>
        </div>
        {result && (
          <div className="banner banner-ok row">
            <span className="grow">{tx("Hazır:")} {result.linked} {tx("dosya bağlantıyla,")} {result.embedded} {tx("dosya pakete gömülü.")}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => void api.openPath(result.path, true)}><FolderOpen size={14} /> {tx("Göster")}</button>
          </div>
        )}
        {error && <div className="banner banner-error">{error}</div>}
      </section>
    </div>
  );
}
