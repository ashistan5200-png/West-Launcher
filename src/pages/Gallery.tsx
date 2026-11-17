import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Copy, Download, FolderOpen, Grid3x3, Images, List, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { useGallery } from "@/stores/gallery";
import { useInstances } from "@/stores/instances";
import { api, isTauri } from "@/lib/ipc";
import type { Screenshot } from "@/lib/types";
import { ScreenshotEditor } from "@/components/ScreenshotEditor";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";

const src = (p: string) => (isTauri() ? convertFileSrc(p) : p);
const fmtSize = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (diff === 0) return tx("Bugün");
  if (diff === 1) return tx("Dün");
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: today.getFullYear() === d.getFullYear() ? undefined : "numeric" });
}

export function GalleryPage() {
  const g = useGallery();
  const allInstances = useInstances((s) => s.instances);
  const instances = useMemo(() => allInstances.filter((i) => !i.isTemplate), [allInstances]);
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");

  useEffect(() => {
    void g.load();
    const un = g.bindEvents();
    return () => void un.then((f) => f());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? g.items.filter((s) => s.file.toLowerCase().includes(q) || s.instanceName.toLowerCase().includes(q)) : g.items;
  }, [g.items, query]);

  const groups = useMemo(() => {
    const m = new Map<string, Screenshot[]>();
    for (const s of filtered) {
      const k = dayLabel(s.modified);
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()];
  }, [filtered]);

  const viewing = filtered.find((s) => s.path === g.viewing) ?? null;
  const editing = g.items.find((s) => s.path === g.editing) ?? null;

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="search grow">
          <Images size={15} />
          <input placeholder={tx("Dosya adı veya instance ara…")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select-sm" value={g.instance ?? ""} onChange={(e) => g.setInstance(e.target.value || null)}>
          <option value="">{tx("Tüm instance'lar")}</option>
          {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
        <div className="segmented mini">
          <button className={clsx(layout === "grid" && "active")} onClick={() => setLayout("grid")} title={tx("Izgara")}><Grid3x3 size={14} /></button>
          <button className={clsx(layout === "list" && "active")} onClick={() => setLayout("list")} title={tx("Liste")}><List size={14} /></button>
        </div>
        <button className="icon-btn" title={tx("Yenile")} onClick={() => g.load()}><RefreshCw size={15} className={clsx(g.loading && "spin")} /></button>
        {g.instance && (
          <button className="icon-btn" title={tx("Klasörü aç")} onClick={async () => api.openPath(await api.screenshotsFolder(g.instance!))}><FolderOpen size={15} /></button>
        )}
      </div>

      {filtered.length === 0 && !g.loading && (
        <div className="empty small-empty">
          <Images size={34} />
          <p className="muted">{tx("Henüz ekran görüntüsü yok. Oyunda")} <kbd>F2</kbd>{tx("'ye bas; yeni görüntüler burada kendiliğinden belirir.")}</p>
        </div>
      )}

      {groups.map(([day, items]) => (
        <section key={day} className="stack" style={{ gap: 8 }}>
          <h3 className="gallery-day">{day} <span className="muted tiny">{items.length}</span></h3>
          <div className={layout === "grid" ? "shot-grid" : "shot-list"}>
            {items.map((s) => <ShotCard key={s.path} s={s} layout={layout} />)}
          </div>
        </section>
      ))}

      <AnimatePresence>{viewing && <Lightbox key="lb" shot={viewing} list={filtered} />}</AnimatePresence>
      <AnimatePresence>{editing && <ScreenshotEditor key={editing.path} shot={editing} />}</AnimatePresence>
      <AnimatePresence>
        {g.message && (
          <motion.div className={`gallery-flash ${g.message.tone}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {g.message.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Actions({ s, dark = false }: { s: Screenshot; dark?: boolean }) {
  const g = useGallery();
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className={clsx("shot-actions", dark && "dark")}>
      <button title={tx("Düzenle")} onClick={stop(() => g.edit(s.path))}><Pencil size={14} /></button>
      <button title={tx("Panoya kopyala / paylaş")} onClick={stop(() => g.copy(s))}><Copy size={14} /></button>
      <button title={tx("Dışa aktar")} onClick={stop(() => g.exportTo(s))}><Download size={14} /></button>
      <button title={tx("Sil (çöp kutusuna)")} className="danger" onClick={stop(async () => await askConfirm(tx("{0} çöp kutusuna taşınsın mı?", s.file)) && g.remove(s))}><Trash2 size={14} /></button>
    </div>
  );
}

function ShotCard({ s, layout }: { s: Screenshot; layout: "grid" | "list" }) {
  const view = useGallery((st) => st.view);
  const [loaded, setLoaded] = useState(false);
  return (
    <motion.div layout className={clsx("shot", layout)} onClick={() => view(s.path)}>
      <div className={clsx("shot-img", !loaded && "loading")}>
        {s.thumb && <img src={src(s.thumb)} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} draggable={false} />}
        {s.edited && <span className="shot-badge">{tx("Düzenlendi")}</span>}
        {layout === "grid" && <Actions s={s} dark />}
      </div>
      <div className="shot-meta">
        <span className="truncate small">{s.file}</span>
        <span className="muted tiny">{s.instanceName} · {new Date(s.modified).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · {fmtSize(s.size)}</span>
      </div>
      {layout === "list" && <Actions s={s} />}
    </motion.div>
  );
}

function Lightbox({ shot, list }: { shot: Screenshot; list: Screenshot[] }) {
  const g = useGallery();
  const i = list.findIndex((s) => s.path === shot.path);
  const go = (d: number) => {
    const n = list[(i + d + list.length) % list.length];
    if (n) g.view(n.path);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") g.view(null);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => g.view(null)}>
      <button className="lb-nav left" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label={tx("Önceki")}><ChevronLeft size={22} /></button>
      <motion.img
        key={shot.path}
        src={src(shot.path)}
        alt={shot.file}
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
      />
      <button className="lb-nav right" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label={tx("Sonraki")}><ChevronRight size={22} /></button>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <div className="grow">
          <strong className="truncate">{shot.file}</strong>
          <span className="muted tiny">{shot.instanceName} · {new Date(shot.modified).toLocaleString("tr-TR")} · {fmtSize(shot.size)} · {i + 1}/{list.length}</span>
        </div>
        <Actions s={shot} />
        <button className="icon-btn" title={tx("Klasörde göster")} onClick={async () => api.openPath(await api.screenshotsFolder(shot.instanceId))}><FolderOpen size={15} /></button>
        <button className="icon-btn" title={tx("Kapat")} onClick={() => g.view(null)}><X size={16} /></button>
      </div>
    </motion.div>
  );
}
