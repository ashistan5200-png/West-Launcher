import { useEffect, useMemo, useRef, useState } from "react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Download, ExternalLink, Loader2, Pause, Play, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import { formatCount } from "@/lib/format";
import type { AssetDiff, ManifestEntry, ModUpdate, NewSound, NewTexture, PatchNote } from "@/lib/types";
import { ContentIcon } from "@/components/ContentIcon";
import { tx } from "@/lib/i18n";

type Tab = "minecraft" | "mods" | "assets";
const dateTR = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });

/** Mojang'ın sürüm notu HTML'ini güvenli hale getirir: betik, iframe ve olay öznitelikleri atılır. */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(tx("script, style, iframe, object, embed, form, link, meta")).forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const a of [...el.attributes]) {
      const v = a.value.trim().toLowerCase();
      if (a.name.startsWith("on") || ((a.name === "href" || a.name === "src") && v.startsWith("javascript:"))) el.removeAttribute(a.name);
    }
    if (el.tagName === "IMG") {
      const src = el.getAttribute("src") ?? "";
      if (src.startsWith("/")) el.setAttribute("src", `https://launchercontent.mojang.com${src}`);
      el.setAttribute("loading", "lazy");
    }
    if (el.tagName === "A") el.setAttribute("data-external", el.getAttribute("href") ?? "");
  });
  return doc.body.innerHTML;
}

export function NewsPage() {
  const [tab, setTab] = useState<Tab>("minecraft");
  return (
    <div className="stack">
      <div className="tabs">
        {([["minecraft", tx("Minecraft güncellemeleri")], ["mods", tx("Mod güncellemeleri")], ["assets", tx("Yeni bloklar ve sesler")]] as const).map(([id, label]) => (
          <button key={id} className={clsx("tab", tab === id && "active")} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "minecraft" && <PatchNotes />}
      {tab === "mods" && <ModUpdates />}
      {tab === "assets" && <AssetExplorer />}
    </div>
  );
}

// ───────── Minecraft sürüm notları ─────────

function PatchNotes() {
  const [notes, setNotes] = useState<PatchNote[] | null>(null);
  const [filter, setFilter] = useState<"all" | "release" | "snapshot">("all");
  const [reading, setReading] = useState<PatchNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri()) api.newsPatchNotes().then(setNotes).catch((e) => setError(String(e)));
  }, []);
  const list = useMemo(() => (notes ?? []).filter((n) => filter === "all" || n.kind === filter), [notes, filter]);

  return (
    <>
      <div className="pills">
        {(["all", "release", "snapshot"] as const).map((f) => (
          <button key={f} className={clsx("pill", filter === f && "active")} onClick={() => setFilter(f)}>
            {f === "all" ? tx("Tümü") : f === "release" ? tx("Tam sürümler") : tx("Snapshot'lar")}
          </button>
        ))}
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      {!notes && !error && <div className="center pad muted"><Loader2 className="spin" size={18} /></div>}
      <div className="note-grid">
        {list.map((n) => (
          <button key={n.id} className="note-card" onClick={() => setReading(n)}>
            {n.image ? <img src={n.image} alt="" loading="lazy" /> : <div className="note-img-blank" />}
            <div className="note-meta">
              <span className={clsx("chip", n.kind === "release" && "chip-accent")}>{n.kind === "release" ? tx("Tam sürüm") : tx("Snapshot")}</span>
              <span className="muted tiny">{dateTR(n.date)}</span>
            </div>
            <strong>{n.title}</strong>
            <p className="clamp-3">{n.summary}</p>
          </button>
        ))}
      </div>
      <AnimatePresence>{reading && <NoteReader key={reading.id} note={reading} onClose={() => setReading(null)} />}</AnimatePresence>
    </>
  );
}

function NoteReader({ note, onClose }: { note: PatchNote; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    api.newsPatchBody(note.contentPath).then((b) => setHtml(sanitize(b))).catch((e) => setHtml(`<p>${String(e)}</p>`));
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [note, onClose]);
  return (
    <motion.div className="reader-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.article className="reader" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="reader-head">
          <div className="grow">
            <span className="muted tiny">{note.kind === "release" ? tx("Tam sürüm") : tx("Snapshot")} · {dateTR(note.date)}</span>
            <h2>{note.title}</h2>
          </div>
          <button className="icon-btn" title={tx("Kapat")} onClick={onClose}><X size={17} /></button>
        </header>
        {note.image && <img className="reader-hero" src={note.image} alt="" />}
        {html === null ? (
          <div className="center pad muted"><Loader2 className="spin" size={18} /></div>
        ) : (
          <div
            className="reader-body"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(e) => {
              const a = (e.target as Element).closest("a[data-external]");
              if (a) {
                e.preventDefault();
                const href = a.getAttribute("data-external") ?? "";
                if (/^https?:\/\//.test(href)) void openUrl(href);
              }
            }}
          />
        )}
      </motion.article>
    </motion.div>
  );
}

// ───────── Bilinen modların güncellemeleri ─────────

function ModUpdates() {
  const [mods, setMods] = useState<ModUpdate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri()) api.newsModUpdates().then(setMods).catch((e) => setError(String(e)));
  }, []);
  return (
    <>
      <p className="muted tiny">{tx("Modrinth'te en çok indirilen 40 modun en son yayınlanan sürümleri, yeniden eskiye.")}</p>
      {error && <div className="banner banner-error">{error}</div>}
      {!mods && !error && <div className="center pad muted"><Loader2 className="spin" size={18} /></div>}
      <div className="content-list">
        {(mods ?? []).map((m) => (
          <div key={m.projectId} className="content-row mod-update">
            <ContentIcon src={m.icon} title={m.title} kind="mod" size={44} />
            <div className="content-meta">
              <div className="content-title">
                <strong className="truncate">{m.title}</strong>
                <span className="chip">{m.versionNumber}</span>
              </div>
              <span className="muted tiny">
                {dateTR(m.date)} {tx("· Minecraft")} {m.gameVersions.join(", ")} · {m.loaders.join(", ")} · {formatCount(m.downloads)} indirme
              </span>
              {m.changelog && (
                <button className="link tiny" style={{ alignSelf: "flex-start" }} onClick={() => setOpen(open === m.projectId ? null : m.projectId)}>
                  {open === m.projectId ? tx("Değişiklikleri gizle") : tx("Neler değişti?")}
                </button>
              )}
              {open === m.projectId && <pre className="changelog">{m.changelog}</pre>}
            </div>
            <button className="icon-btn" title={tx("Modrinth'te aç")} onClick={() => openUrl(m.url)}><ExternalLink size={15} /></button>
          </div>
        ))}
      </div>
    </>
  );
}

// ───────── Yeni bloklar ve sesler ─────────

function AssetExplorer() {
  const [versions, setVersions] = useState<ManifestEntry[]>([]);
  const [version, setVersion] = useState("");
  const [base, setBase] = useState("");
  const [diff, setDiff] = useState<AssetDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    api.listMcVersions(true).then((v) => {
      setVersions(v.slice(0, 120));
      setVersion(v.find((x) => x.type === "release")?.id ?? v[0]?.id ?? "");
    });
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await api.newsAssetDiff(version, base || null);
      setDiff(d);
      if (!base) setBase(d.base);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const ql = q.trim().toLowerCase();
  const textures = (diff?.textures ?? []).filter((t) => !ql || t.name.includes(ql) || t.category.includes(ql));
  const sounds = (diff?.sounds ?? []).filter((s) => !ql || s.name.includes(ql) || s.group.includes(ql));

  const exportFile = async (name: string, ext: string, file: { version?: string; path?: string; hash?: string }) => {
    const dest = await saveDialog({ defaultPath: `${name}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!dest) return;
    try {
      await api.newsExport(dest, file);
      setFlash(tx("{0}.{1} kaydedildi", name, ext));
    } catch (e) {
      setFlash(String(e));
    }
    window.setTimeout(() => setFlash(null), 3000);
  };

  return (
    <>
      <div className="toolbar">
        <label className="field-inline">
          <span className="muted tiny">{tx("Sürüm")}</span>
          <select className="select-sm" value={version} onChange={(e) => { setVersion(e.target.value); setBase(""); setDiff(null); }}>
            {versions.map((v) => <option key={v.id} value={v.id}>{v.id}{v.type !== "release" ? " (snapshot)" : ""}</option>)}
          </select>
        </label>
        <label className="field-inline">
          <span className="muted tiny">{tx("şununla karşılaştır")}</span>
          <select className="select-sm" value={base} onChange={(e) => { setBase(e.target.value); setDiff(null); }}>
            <option value="">{tx("Önceki sürüm (otomatik)")}</option>
            {versions.filter((v) => v.id !== version).map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}
          </select>
        </label>
        <button className="btn btn-primary btn-sm" disabled={!version || busy} onClick={run}>
          {busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} {busy ? tx("Sürüm dosyaları hazırlanıyor…") : tx("Yenileri bul")}
        </button>
        {diff && (
          <div className="search grow">
            <Search size={15} />
            <input placeholder={tx("Ad veya kategoriye göre filtrele…")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
      </div>
      <p className="muted tiny">{tx("İki sürümün resmi oyun dosyaları karşılaştırılır; ilk seferde her sürüm için yaklaşık 25 MB indirilir.")}</p>
      {error && <div className="banner banner-error">{error}</div>}

      {diff && (
        <>
          <section className="stack" style={{ gap: 10 }}>
            <h3>{tx("Yeni dokular")} <span className="muted tiny">{textures.length} · {diff.base} → {diff.version}</span></h3>
            {textures.length === 0 ? <p className="muted small">{tx("Bu iki sürüm arasında yeni doku yok.")}</p> : (
              <div className="tex-grid">
                {textures.map((t) => <TextureTile key={t.path} version={diff.version} t={t} onSave={() => exportFile(t.name, "png", { version: diff.version, path: t.path })} />)}
              </div>
            )}
          </section>
          <section className="stack" style={{ gap: 10 }}>
            <h3>{tx("Yeni sesler")} <span className="muted tiny">{sounds.length}</span></h3>
            {sounds.length === 0 ? <p className="muted small">{tx("Bu iki sürüm arasında yeni ses yok.")}</p> : (
              <div className="sound-list">
                {sounds.map((s) => <SoundRow key={s.path} s={s} onSave={() => exportFile(s.name, "ogg", { hash: s.hash })} />)}
              </div>
            )}
          </section>
        </>
      )}
      <AnimatePresence>
        {flash && <motion.div className="gallery-flash" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{flash}</motion.div>}
      </AnimatePresence>
    </>
  );
}

function TextureTile({ version, t, onSave }: { version: string; t: NewTexture; onSave: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let created = "";
    // Yalnızca görünür olunca yükle
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || created) return;
      io.disconnect();
      api.newsTexture(version, t.path).then((buf) => {
        created = URL.createObjectURL(new Blob([buf], { type: "image/png" }));
        setUrl(created);
      }).catch(() => {});
    });
    if (ref.current) io.observe(ref.current);
    return () => { io.disconnect(); if (created) URL.revokeObjectURL(created); };
  }, [version, t.path]);
  return (
    <div className="tex-tile" ref={ref} title={t.path.replace("assets/minecraft/", "")}>
      <div className="tex-img">{url ? <img src={url} alt={t.name} /> : <Loader2 size={14} className="spin" />}</div>
      <span className="truncate tiny">{t.name}</span>
      <span className="muted tiny">{t.category}</span>
      <button className="icon-btn tex-save" title={tx("PNG olarak indir")} onClick={onSave}><Download size={14} /></button>
    </div>
  );
}

let playing: HTMLAudioElement | null = null;

function SoundRow({ s, onSave }: { s: NewSound; onSave: () => void }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const toggle = async () => {
    if (state === "playing") {
      audio.current?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      if (!audio.current) {
        const buf = await api.newsSound(s.hash);
        audio.current = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/ogg" })));
        audio.current.onended = () => setState("idle");
        audio.current.onpause = () => setState("idle");
      }
      if (playing && playing !== audio.current) playing.pause();
      playing = audio.current;
      audio.current.currentTime = 0;
      await audio.current.play();
      setState("playing");
    } catch {
      setState("idle");
    }
  };
  useEffect(() => () => { audio.current?.pause(); }, []);
  return (
    <div className="sound-row">
      <button className={clsx("play-btn", state === "playing" && "on")} onClick={toggle} aria-label={state === "playing" ? tx("Durdur") : tx("Dinle")}>
        {state === "loading" ? <Loader2 size={14} className="spin" /> : state === "playing" ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="grow" style={{ minWidth: 0 }}>
        <span className="truncate small">{s.name}</span>
        <span className="truncate muted tiny">{s.group} · {(s.size / 1024).toFixed(0)} KB</span>
      </div>
      <button className="icon-btn" title={tx("OGG olarak indir")} onClick={onSave}><Download size={14} /></button>
    </div>
  );
}
