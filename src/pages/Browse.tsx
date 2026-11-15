import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  Check, ChevronDown, Download, ExternalLink, Laptop, Loader2, Monitor, RotateCcw, Search, Server, SlidersHorizontal, X,
} from "lucide-react";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import type { ContentHit, ContentKind, ContentTags, Instance, SearchQuery } from "@/lib/types";
import { useInstances } from "@/stores/instances";
import { ContentIcon } from "@/components/ContentIcon";
import { Menu } from "@/components/instance/Menu";
import { InstallMenu } from "@/components/InstallMenu";
import { ModDetail } from "@/components/ModDetail";
import { AnimatePresence } from "framer-motion";
import { LOADER_LABEL, formatCount, formatRelative } from "@/lib/format";
import { catLabel } from "@/lib/categories";

const KINDS: { id: ContentKind; label: string }[] = [
  { id: "mod", label: "Modlar" },
  { id: "modpack", label: "Modpack'ler" },
  { id: "resourcepack", label: "Resource Pack'ler" },
  { id: "shader", label: "Shader'lar" },
];
const LOADERS = ["fabric", "neoforge", "forge", "quilt"] as const;
type Env = "all" | "client" | "server" | "both";
const ENVS: { id: Env; label: string; hint: string; icon: typeof Laptop }[] = [
  { id: "all", label: "Hepsi", hint: "", icon: SlidersHorizontal },
  { id: "client", label: "Yalnız istemci", hint: "Sunucuda gerekmez (ör. Sodium, minimap)", icon: Laptop },
  { id: "server", label: "Yalnız sunucu", hint: "Oyuncuların kurmasına gerek yok", icon: Server },
  { id: "both", label: "İkisinde de", hint: "Hem oyuncuda hem sunucuda olmalı", icon: Monitor },
];
const SORTS: { id: NonNullable<SearchQuery["sort"]>; label: string }[] = [
  { id: "relevance", label: "En alakalı" },
  { id: "downloads", label: "En çok indirilen" },
  { id: "follows", label: "En çok takip edilen" },
  { id: "newest", label: "En yeni" },
  { id: "updated", label: "Son güncellenen" },
];


const PAGE = 24;

const sideLabel = (h: ContentHit) => {
  const c = h.clientSide, s = h.serverSide;
  if (!c || !s || c === "unknown" || s === "unknown") return null;
  if (s === "unsupported") return { icon: Laptop, text: "İstemci" };
  if (c === "unsupported") return { icon: Server, text: "Sunucu" };
  if (c === "required" && s === "required") return { icon: Monitor, text: "İstemci + sunucu" };
  return { icon: Monitor, text: c === "optional" ? "Sunucu (istemcide isteğe bağlı)" : "İstemci (sunucuda isteğe bağlı)" };
};

const versionRange = (v: string[] | undefined) => {
  const rel = (v ?? []).filter((x) => /^\d+\.\d+(\.\d+)?$/.test(x));
  if (!rel.length) return null;
  return rel.length === 1 ? rel[0] : `${rel[0]} – ${rel[rel.length - 1]}`;
};


export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  const allInstances = useInstances((s) => s.instances);
  const instances = useMemo(() => allInstances.filter((i) => !i.isTemplate), [allInstances]);
  const fromInstance = instances.find((i) => i.id === params.get("instance")) ?? null;

  const kind = (params.get("kind") as ContentKind) || "mod";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [version, setVersion] = useState<string>(fromInstance?.mcVersion ?? "");
  const [loader, setLoader] = useState<string>(fromInstance && fromInstance.loader.kind !== "vanilla" ? fromInstance.loader.kind : "");
  const [env, setEnv] = useState<Env>("all");
  const [cats, setCats] = useState<string[]>([]);
  const [sort, setSort] = useState<NonNullable<SearchQuery["sort"]>>("relevance");
  const [snapshots, setSnapshots] = useState(false);
  const [tags, setTags] = useState<ContentTags | null>(null);
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);
  const [detail, setDetail] = useState<ContentHit | null>(null);

  useEffect(() => {
    if (isTauri()) api.contentTags().then(setTags).catch(() => {});
  }, []);
  useEffect(() => setCats([]), [kind]);

  const categoryGroups = useMemo(() => {
    const list = (tags?.categories ?? []).filter((c) => c.projectType === kind && !LOADERS.includes(c.name as never));
    const groups = new Map<string, string[]>();
    for (const c of list) groups.set(c.header, [...(groups.get(c.header) ?? []), c.name]);
    return [...groups.entries()];
  }, [tags, kind]);
  const versions = useMemo(
    () => (tags?.gameVersions ?? []).filter((v) => snapshots || v.versionType === "release").map((v) => v.version),
    [tags, snapshots],
  );

  const baseQuery = useMemo<SearchQuery>(
    () => ({
      query: query.trim(),
      kind,
      gameVersion: version || null,
      loader: kind === "mod" || kind === "modpack" ? loader || null : null,
      sort,
      limit: PAGE,
      sources: ["modrinth"],
      categories: cats.length ? cats : null,
      environment: kind === "mod" && env !== "all" ? env : null,
    }),
    [query, kind, version, loader, sort, cats, env],
  );

  useEffect(() => {
    if (!isTauri()) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await api.searchContent({ ...baseQuery, offset: 0 });
        if (id !== reqId.current) return;
        setHits(r.hits);
        setTotal(r.total);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError(String(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [baseQuery]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const r = await api.searchContent({ ...baseQuery, offset: hits.length });
      const seen = new Set(hits.map((h) => h.id));
      setHits((prev) => [...prev, ...r.hits.filter((h) => !seen.has(h.id))]);
    } finally {
      setLoading(false);
    }
  };

  const activeFilters = (version ? 1 : 0) + (loader ? 1 : 0) + (env !== "all" ? 1 : 0) + cats.length;
  const reset = () => {
    setVersion("");
    setLoader("");
    setEnv("all");
    setCats([]);
  };

  return (
    <div className="browse">
      <aside className="bfilters">
        <div className="bf-head">
          <strong><SlidersHorizontal size={15} /> Filtreler</strong>
          {activeFilters > 0 && <button className="btn-link" onClick={reset}><RotateCcw size={13} /> Temizle</button>}
        </div>

        <section className="bf-sec">
          <h4>Minecraft sürümü</h4>
          <select className="bf-select" value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="">Tüm sürümler</option>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="check tiny"><input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> Snapshot'ları da göster</label>
        </section>

        {(kind === "mod" || kind === "modpack") && (
          <section className="bf-sec">
            <h4>Yükleyici</h4>
            <div className="bf-chips">
              {LOADERS.map((l) => (
                <button key={l} className={clsx("fchip", loader === l && "on")} onClick={() => setLoader(loader === l ? "" : l)}>{LOADER_LABEL[l]}</button>
              ))}
            </div>
          </section>
        )}

        {kind === "mod" && (
          <section className="bf-sec">
            <h4>Çalıştığı yer</h4>
            <div className="bf-env">
              {ENVS.map((e) => (
                <button key={e.id} className={clsx("bf-env-item", env === e.id && "on")} onClick={() => setEnv(e.id)} title={e.hint}>
                  <e.icon size={15} /> <span>{e.label}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {categoryGroups.map(([header, names]) => (
          <section key={header} className="bf-sec">
            <h4>{header === "categories" ? "Kategori" : header === "features" ? "Özellikler" : header === "resolutions" ? "Çözünürlük" : header === "performance impact" ? "Performans etkisi" : catLabel(header)}</h4>
            <div className="bf-cats">
              {names.map((n) => (
                <label key={n} className={clsx("bf-cat", cats.includes(n) && "on")}>
                  <input type="checkbox" checked={cats.includes(n)} onChange={() => setCats((c) => (c.includes(n) ? c.filter((x) => x !== n) : [...c, n]))} />
                  <span>{catLabel(n)}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
        {!tags && <p className="muted tiny"><Loader2 size={12} className="spin" /> Kategoriler yükleniyor…</p>}
      </aside>

      <div className="bmain">
        <div className="ctab-bar">
          <label className="ctab-search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`${KINDS.find((k) => k.id === kind)!.label} içinde ara…`} autoFocus />
            {query && <button className="icon-btn sm" onClick={() => setQuery("")} aria-label="Temizle"><X size={14} /></button>}
          </label>
          <Menu
            trigger={(open) => <button className={clsx("btn btn-ghost lg", open && "pressed")}>{SORTS.find((s) => s.id === sort)!.label} <ChevronDown size={14} /></button>}
            items={SORTS.map((s) => ({ label: s.label, active: s.id === sort, icon: s.id === sort ? <Check size={14} /> : <span className="menu-gap" />, onClick: () => setSort(s.id) }))}
          />
        </div>

        <nav className="pill-tabs">
          {KINDS.map((k) => (
            <button key={k.id} className={clsx("pill-tab", kind === k.id && "on")} onClick={() => setParams({ kind: k.id, ...(fromInstance ? { instance: fromInstance.id } : {}) })}>{k.label}</button>
          ))}
        </nav>

        <div className="bmeta muted small">
          {loading && hits.length === 0 ? "Aranıyor…" : `${formatCount(total)} sonuç`}
          {fromInstance && <span> · <strong>{fromInstance.name}</strong> için filtreler önceden seçildi</span>}
          {kind === "modpack" && <span> · Modpack'ler kendi sürümüyle yeni bir instance olarak kurulur</span>}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        <div className="bresults">
          {hits.map((h) => <ResultCard key={h.id} hit={h} instances={instances} preferred={fromInstance} onOpen={() => setDetail(h)} />)}
        </div>

        {loading && hits.length === 0 && <div className="center pad muted"><Loader2 className="spin" size={18} /></div>}
        {!loading && hits.length === 0 && !error && <p className="muted center pad">Sonuç yok. Filtreleri gevşetmeyi dene.</p>}
        {hits.length > 0 && hits.length < total && (
          <button className="btn btn-ghost" style={{ alignSelf: "center" }} disabled={loading} onClick={loadMore}>
            {loading ? <Loader2 size={14} className="spin" /> : null} Daha fazla göster
          </button>
        )}
      </div>
      <AnimatePresence>
        {detail && <ModDetail hit={detail} instances={instances} preferred={fromInstance} onClose={() => setDetail(null)} />}
      </AnimatePresence>
    </div>
  );
}

function ResultCard({ hit, instances, preferred, onOpen }: { hit: ContentHit; instances: Instance[]; preferred: Instance | null; onOpen: () => void }) {
  const side = sideLabel(hit);
  const range = versionRange(hit.versions);
  const shots = hit.gallery ?? [];
  return (
    <article className="rcard clickable" onClick={onOpen} title="Ayrıntılar, galeri ve sürüm notları">
      <ContentIcon key={hit.icon ?? hit.id} src={hit.icon} title={hit.title} kind={hit.kind} size={64} />
      <div className="rcard-main">
        <div className="rcard-title">
          <strong className="truncate">{hit.title}</strong>
          <span className="muted small truncate">{hit.author}</span>
        </div>
        <p className="rcard-desc clamp-2">{hit.description}</p>
        <div className="rcard-tags">
          {side && <span className="rtag side"><side.icon size={12} /> {side.text}</span>}
          {(hit.loaders ?? []).filter((l) => l in LOADER_LABEL).slice(0, 4).map((l) => <span key={l} className={`rtag loader ${l}`}>{LOADER_LABEL[l]}</span>)}
          {range && <span className="rtag">{range}</span>}
          {hit.categories.slice(0, 3).map((c) => <span key={c} className="rtag cat">{catLabel(c)}</span>)}
        </div>
      </div>
      {shots.length > 0 && (
        <div className="rcard-shots" aria-label="Görseller">
          {shots.slice(0, 3).map((g) => <img key={g} src={g} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
        </div>
      )}
      <div className="rcard-side" onClick={(e) => e.stopPropagation()}>
        <span className="rstat"><Download size={13} /> {formatCount(hit.downloads)}</span>
        {hit.updated && <span className="rstat muted">{formatRelative(hit.updated)}</span>}
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" title="Modrinth sayfası" onClick={() => void openUrl(hit.url)}><ExternalLink size={16} /></button>
          <InstallMenu hit={hit} instances={instances} preferred={preferred} />
        </div>
      </div>
    </article>
  );
}
