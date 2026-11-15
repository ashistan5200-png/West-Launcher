import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  BookOpen, Bug, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Code2, Download, ExternalLink, Heart, History, Image as ImageIcon,
  Laptop, Loader2, MessageCircle, Scale, Server, X,
} from "lucide-react";
import clsx from "clsx";
import { api } from "@/lib/ipc";
import { markdownToHtml } from "@/lib/markdown";
import { catLabel } from "@/lib/categories";
import { LOADER_LABEL, formatCount, formatRelative } from "@/lib/format";
import type { ContentHit, Instance, ProjectDetail, ProjectVersion } from "@/lib/types";
import { ContentIcon } from "./ContentIcon";
import { InstallMenu } from "./InstallMenu";

type Tab = "about" | "gallery" | "versions";
const dateTR = (iso: string) => new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" });
const SIDE: Record<string, string> = { required: "Gerekli", optional: "İsteğe bağlı", unsupported: "Gerekmez", unknown: "Bilinmiyor" };
const VTYPE: Record<string, string> = { release: "Kararlı", beta: "Beta", alpha: "Alfa" };

/** Dış bağlantıları sistem tarayıcısında açan Markdown görünümü */
function Markdown({ md }: { md: string }) {
  const html = useMemo(() => markdownToHtml(md), [md]);
  return (
    <div
      className="md"
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
  );
}

export function ModDetail({ hit, instances, preferred, onClose }: { hit: ContentHit; instances: Instance[]; preferred: Instance | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("about");
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => {
    api.contentProject(hit.id).then(setP).catch((e) => setError(String(e)));
    api.contentVersions(hit.id).then(setVersions).catch(() => setVersions([]));
  }, [hit.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") (lightbox !== null ? setLightbox(null) : onClose());
      if (lightbox !== null && p) {
        if (e.key === "ArrowRight") setLightbox((i) => ((i ?? 0) + 1) % p.gallery.length);
        if (e.key === "ArrowLeft") setLightbox((i) => ((i ?? 0) - 1 + p.gallery.length) % p.gallery.length);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, lightbox, p]);

  const gallery = useMemo(() => [...(p?.gallery ?? [])].sort((a, b) => Number(b.featured) - Number(a.featured)), [p]);
  const links = p
    ? ([
        p.source_url && { icon: Code2, label: "Kaynak kod", url: p.source_url },
        p.issues_url && { icon: Bug, label: "Hata bildir", url: p.issues_url },
        p.wiki_url && { icon: BookOpen, label: "Wiki", url: p.wiki_url },
        p.discord_url && { icon: MessageCircle, label: "Discord", url: p.discord_url },
        { icon: ExternalLink, label: "Modrinth sayfası", url: hit.url },
      ].filter(Boolean) as { icon: typeof Code2; label: string; url: string }[])
    : [];

  return (
    <motion.div className="mdetail-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
      <motion.div className="mdetail" initial={{ y: 16, opacity: 0, scale: 0.99 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 10, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} onMouseDown={(e) => e.stopPropagation()}>
        {/* Başlık: öne çıkan görsel varsa arka planda */}
        <header className="mdetail-head">
          {gallery[0] && <img className="mdetail-cover" src={gallery[0].url} alt="" referrerPolicy="no-referrer" />}
          <div className="mdetail-shade" />
          <div className="mdetail-head-row">
            <ContentIcon src={hit.icon} title={hit.title} kind={hit.kind} size={76} />
            <div className="grow" style={{ minWidth: 0 }}>
              <h2 className="truncate">{hit.title}</h2>
              <p className="mdetail-summary">{p?.description ?? hit.description}</p>
              <div className="mdetail-stats">
                <span><Download size={14} /> {formatCount(p?.downloads ?? hit.downloads)}</span>
                {p && <span><Heart size={14} /> {formatCount(p.followers)}</span>}
                {p && <span><CalendarDays size={14} /> {formatRelative(p.updated)} güncellendi</span>}
                <span className="muted">· {p?.ownerName ?? hit.author}</span>
              </div>
            </div>
            <div className="mdetail-actions">
              <InstallMenu hit={hit} instances={instances} preferred={preferred} />
              <button className="icon-btn" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
            </div>
          </div>
        </header>

        <nav className="pill-tabs mdetail-tabs">
          <button className={clsx("pill-tab", tab === "about" && "on")} onClick={() => setTab("about")}><BookOpen size={16} /> Açıklama</button>
          {gallery.length > 0 && <button className={clsx("pill-tab", tab === "gallery" && "on")} onClick={() => setTab("gallery")}><ImageIcon size={16} /> Galeri <span className="count">{gallery.length}</span></button>}
          <button className={clsx("pill-tab", tab === "versions" && "on")} onClick={() => setTab("versions")}><History size={16} /> Sürümler ve değişiklikler {versions && <span className="count">{versions.length}</span>}</button>
        </nav>

        <div className="mdetail-body">
          <div className="mdetail-main">
            {error && <div className="banner banner-error">{error}</div>}
            {!p && !error && <div className="center pad muted"><Loader2 size={20} className="spin" /></div>}
            {p && tab === "about" && (
              <>
                {gallery.length > 0 && (
                  <div className="mdetail-strip">
                    {gallery.slice(0, 4).map((g, i) => (
                      <button key={g.url} onClick={() => setLightbox(i)} title={g.title ?? ""}><img src={g.url} alt={g.title ?? ""} loading="lazy" referrerPolicy="no-referrer" /></button>
                    ))}
                    {gallery.length > 4 && <button className="more" onClick={() => setTab("gallery")}>+{gallery.length - 4}</button>}
                  </div>
                )}
                {p.body ? <Markdown md={p.body} /> : <p className="muted">Bu proje için ayrıntılı açıklama yazılmamış.</p>}
              </>
            )}
            {p && tab === "gallery" && (
              <div className="mdetail-gallery">
                {gallery.map((g, i) => (
                  <figure key={g.url} onClick={() => setLightbox(i)}>
                    <img src={g.url} alt={g.title ?? ""} loading="lazy" referrerPolicy="no-referrer" />
                    {(g.title || g.description) && (
                      <figcaption>
                        {g.title && <strong>{g.title}</strong>}
                        {g.description && <span>{g.description}</span>}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {tab === "versions" && <Versions versions={versions} />}
          </div>

          {p && (
            <aside className="mdetail-side">
              <section>
                <h4>Nerede çalışır</h4>
                <div className="kv"><Laptop size={14} /> <span>İstemci (oyuncu)</span><b className={p.client_side}>{SIDE[p.client_side] ?? p.client_side}</b></div>
                <div className="kv"><Server size={14} /> <span>Sunucu</span><b className={p.server_side}>{SIDE[p.server_side] ?? p.server_side}</b></div>
              </section>
              <section>
                <h4>Uyumluluk</h4>
                <div className="chips-wrap">{p.loaders.filter((l) => l in LOADER_LABEL || l === "minecraft").map((l) => <span key={l} className={`rtag loader ${l}`}>{LOADER_LABEL[l] ?? "Vanilla"}</span>)}</div>
                <p className="small muted">Minecraft {versionSpan(p.game_versions)}</p>
              </section>
              {(p.categories.length > 0 || (p.additional_categories ?? []).length > 0) && (
                <section>
                  <h4>Kategoriler</h4>
                  <div className="chips-wrap">{[...p.categories, ...(p.additional_categories ?? [])].filter((c) => !(c in LOADER_LABEL)).map((c) => <span key={c} className="rtag cat">{catLabel(c)}</span>)}</div>
                </section>
              )}
              <section>
                <h4>Bilgiler</h4>
                {p.license && <div className="kv"><Scale size={14} /> <span>Lisans</span><b>{p.license.name || p.license.id}</b></div>}
                <div className="kv"><CalendarDays size={14} /> <span>Yayın</span><b>{dateTR(p.published)}</b></div>
                <div className="kv"><History size={14} /> <span>Güncelleme</span><b>{dateTR(p.updated)}</b></div>
              </section>
              <section>
                <h4>Bağlantılar</h4>
                {links.map((l) => (
                  <button key={l.url} className="mdetail-link" onClick={() => void openUrl(l.url)}><l.icon size={14} /> {l.label} <ExternalLink size={12} className="muted" /></button>
                ))}
              </section>
            </aside>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {lightbox !== null && gallery[lightbox] && (
          <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => { e.stopPropagation(); setLightbox(null); }}>
            <button className="lb-nav left" onMouseDown={(e) => { e.stopPropagation(); setLightbox((lightbox - 1 + gallery.length) % gallery.length); }}><ChevronLeft size={28} /></button>
            <figure onMouseDown={(e) => e.stopPropagation()}>
              <img src={gallery[lightbox].raw_url || gallery[lightbox].url} alt="" referrerPolicy="no-referrer" />
              <figcaption>
                {gallery[lightbox].title && <strong>{gallery[lightbox].title}</strong>}
                {gallery[lightbox].description && <span>{gallery[lightbox].description}</span>}
                <small className="muted">{lightbox + 1} / {gallery.length}</small>
              </figcaption>
            </figure>
            <button className="lb-nav right" onMouseDown={(e) => { e.stopPropagation(); setLightbox((lightbox + 1) % gallery.length); }}><ChevronRight size={28} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function versionSpan(v: string[]) {
  const rel = v.filter((x) => /^\d+\.\d+(\.\d+)?$/.test(x));
  if (!rel.length) return "—";
  return rel.length === 1 ? rel[0] : `${rel[0]} – ${rel[rel.length - 1]}`;
}

/** Sürüm geçmişi: her sürümde neler değişti (değişiklik notları), MC sürümü ve yükleyiciye göre süzülebilir. */
function Versions({ versions }: { versions: ProjectVersion[] | null }) {
  const [mc, setMc] = useState("");
  const [loader, setLoader] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(15);
  const mcs = useMemo(() => {
    const all = new Set<string>();
    (versions ?? []).forEach((v) => v.game_versions.forEach((g) => /^\d+\.\d+(\.\d+)?$/.test(g) && all.add(g)));
    return [...all].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }, [versions]);
  const loaders = useMemo(() => [...new Set((versions ?? []).flatMap((v) => v.loaders))], [versions]);
  const list = useMemo(() => (versions ?? []).filter((v) => (!mc || v.game_versions.includes(mc)) && (!loader || v.loaders.includes(loader))), [versions, mc, loader]);
  useEffect(() => {
    if (list[0]) setOpen(new Set([list[0].id]));
  }, [mc, loader, versions]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!versions) return <div className="center pad muted"><Loader2 size={20} className="spin" /></div>;
  if (!versions.length) return <p className="muted">Sürüm bilgisi bulunamadı.</p>;
  return (
    <div className="vlist">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select className="bf-select" value={mc} onChange={(e) => setMc(e.target.value)} style={{ width: 170 }}>
          <option value="">Tüm Minecraft sürümleri</option>
          {mcs.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        {loaders.length > 1 && (
          <div className="bf-chips">
            {loaders.map((l) => <button key={l} className={clsx("fchip", loader === l && "on")} onClick={() => setLoader(loader === l ? "" : l)}>{LOADER_LABEL[l] ?? l}</button>)}
          </div>
        )}
        <span className="muted small">{list.length} sürüm</span>
      </div>
      {list.slice(0, limit).map((v) => {
        const isOpen = open.has(v.id);
        return (
          <article key={v.id} className={clsx("vitem", isOpen && "open")}>
            <button className="vhead" onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })}>
              <span className={`vtype ${v.version_type}`}>{VTYPE[v.version_type] ?? v.version_type}</span>
              <span className="vname">
                <strong className="truncate">{v.name || v.version_number}</strong>
                <span className="muted tiny truncate">{v.version_number} · {v.loaders.map((l) => LOADER_LABEL[l] ?? l).join(", ")} · MC {versionSpan(v.game_versions)}</span>
              </span>
              <span className="muted tiny vdate">{dateTR(v.date_published)}</span>
              <span className="muted tiny"><Download size={12} /> {formatCount(v.downloads)}</span>
              <ChevronDown size={16} className="vchev" />
            </button>
            {isOpen && (
              <div className="vbody">
                {v.changelog?.trim() ? <Markdown md={v.changelog} /> : <p className="muted small">Bu sürüm için değişiklik notu yazılmamış.</p>}
              </div>
            )}
          </article>
        );
      })}
      {list.length > limit && <button className="btn btn-ghost" style={{ alignSelf: "center" }} onClick={() => setLimit((n) => n + 20)}>Daha eski sürümler</button>}
    </div>
  );
}

