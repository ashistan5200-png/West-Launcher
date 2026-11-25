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
import { useContent } from "@/stores/content";
import { ContentIcon } from "@/components/ContentIcon";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Menu } from "@/components/instance/Menu";
import { InstallMenu } from "@/components/InstallMenu";
import { Pagination } from "@/components/Pagination";
import { ModDetail } from "@/components/ModDetail";
import { AnimatePresence } from "framer-motion";
import { LOADER_LABEL, formatCount, formatRelative, errorText } from "@/lib/format";
import { catLabel } from "@/lib/categories";
import { locale, tx } from "@/lib/i18n";

const KINDS: { id: ContentKind; label: string }[] = [
  { id: "mod", label: tx("Modlar") },
  { id: "modpack", label: tx("Modpack'ler") },
  { id: "resourcepack", label: tx("Resource Pack'ler") },
  { id: "shader", label: tx("Shader'lar") },
];
const LOADERS = ["fabric", "neoforge", "forge", "quilt"] as const;
type Env = "all" | "client" | "server" | "both";
const ENVS: { id: Env; label: string; hint: string; icon: typeof Laptop }[] = [
  { id: "all", label: tx("Hepsi"), hint: "", icon: SlidersHorizontal },
  { id: "client", label: tx("Yalnız istemci"), hint: tx("Sunucuda gerekmez (ör. Sodium, minimap)"), icon: Laptop },
  { id: "server", label: tx("Yalnız sunucu"), hint: tx("Oyuncuların kurmasına gerek yok"), icon: Server },
  { id: "both", label: tx("İkisinde de"), hint: tx("Hem oyuncuda hem sunucuda olmalı"), icon: Monitor },
];
const SORTS: { id: NonNullable<SearchQuery["sort"]>; label: string }[] = [
  { id: "relevance", label: tx("En alakalı") },
  { id: "downloads", label: tx("En çok indirilen") },
  { id: "follows", label: tx("En çok takip edilen") },
  { id: "newest", label: tx("En yeni") },
  { id: "updated", label: tx("Son güncellenen") },
];


const PAGE = 25;
/** Modrinth aramasında ulaşılabilecek en derin kayıt (daha ötesi boş döner) */
const MAX_OFFSET = 10_000;

const sideLabel = (h: ContentHit) => {
  const c = h.clientSide, s = h.serverSide;
  if (!c || !s || c === "unknown" || s === "unknown") return null;
  if (s === "unsupported") return { icon: Laptop, text: tx("İstemci") };
  if (c === "unsupported") return { icon: Server, text: tx("Sunucu") };
  if (c === "required" && s === "required") return { icon: Monitor, text: tx("İstemci + sunucu") };
  return { icon: Monitor, text: c === "optional" ? tx("Sunucu (istemcide isteğe bağlı)") : tx("İstemci (sunucuda isteğe bağlı)") };
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

  // Vanilla instance'a mod kurulamaz → doğrudan resource pack'lerle başla
  const kind = (params.get("kind") as ContentKind) || (fromInstance?.loader.kind === "vanilla" ? "resourcepack" : "mod");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [freeVersion, setVersion] = useState<string>("");
  const [freeLoader, setLoader] = useState<string>("");
  // Instance'tan gelindiyse sürüm ve yükleyici o instance'a kilitlenir
  const version = fromInstance?.mcVersion ?? freeVersion;
  const loader = fromInstance ? (fromInstance.loader.kind === "vanilla" ? "" : fromInstance.loader.kind) : freeLoader;
  const leaveInstance = () => setParams({ kind: kind === "mod" && fromInstance?.loader.kind === "vanilla" ? "mod" : kind });
  const [env, setEnv] = useState<Env>("all");
  const [cats, setCats] = useState<string[]>([]);
  const [sort, setSort] = useState<NonNullable<SearchQuery["sort"]>>("relevance");
  const [snapshots, setSnapshots] = useState(false);
  const [tags, setTags] = useState<ContentTags | null>(null);
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const topRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const reqId = useRef(0);
  const [detail, setDetail] = useState<ContentHit | null>(null);

  // Instance'taki bir modun adına tıklanınca: ?project=… ile doğrudan o modun sayfası açılır
  const projectParam = params.get("project");
  useEffect(() => {
    if (!projectParam || !isTauri()) return;
    let alive = true;
    api.contentProject(projectParam).then((p) => {
      if (!alive) return;
      setDetail({
        source: "modrinth", id: p.id, slug: p.slug, title: p.title, description: p.description, author: p.ownerName ?? "",
        icon: p.icon_url, downloads: p.downloads, kind: (p.project_type as ContentKind) ?? "mod", categories: p.categories,
        url: `https://modrinth.com/${p.project_type}/${p.slug}`, alsoOn: null, versions: p.game_versions, loaders: p.loaders,
        updated: p.updated, clientSide: p.client_side as ContentHit["clientSide"], serverSide: p.server_side as ContentHit["serverSide"],
      });
    }).catch((e) => setError(errorText(e)));
    return () => { alive = false; };
  }, [projectParam]);
  const closeDetail = () => {
    setDetail(null);
    if (projectParam) {
      const next = new URLSearchParams(params);
      next.delete("project");
      setParams(next, { replace: true });
    }
  };

  useEffect(() => {
    if (isTauri()) api.contentTags().then(setTags).catch(() => {});
  }, []);
  useEffect(() => setCats([]), [kind]);
  const loadInstalled = useContent((s) => s.loadInstalled);
  useEffect(() => { if (fromInstance) void loadInstalled(fromInstance.id); }, [fromInstance?.id, loadInstalled]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Filtre değişince ilk sayfaya dön
  useEffect(() => setPage(1), [baseQuery]);

  useEffect(() => {
    if (!isTauri()) return;
    const id = ++reqId.current;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const r = await api.searchContent({ ...baseQuery, offset: (page - 1) * PAGE });
        if (id !== reqId.current) return;
        setHits(r.hits);
        setTotal(r.total);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError(errorText(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, page === 1 ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [baseQuery, page, retry]);

  const pages = Math.max(1, Math.ceil(Math.min(total, MAX_OFFSET) / PAGE));
  const changePage = (p: number) => {
    setPage(p);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeFilters = (fromInstance ? 0 : (version ? 1 : 0) + (loader ? 1 : 0)) + (env !== "all" ? 1 : 0) + cats.length;
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
          <strong><SlidersHorizontal size={15} /> {tx("Filtreler")}</strong>
          {activeFilters > 0 && <button className="btn-link" onClick={reset}><RotateCcw size={13} /> {tx("Temizle")}</button>}
        </div>

        {fromInstance ? (
          <section className="bf-target">
            <InstanceIcon instance={fromInstance} size={40} />
            <div className="grow">
              <strong className="truncate">{fromInstance.name}</strong>
              <span className="muted tiny">{LOADER_LABEL[fromInstance.loader.kind]} {fromInstance.mcVersion}</span>
            </div>
            <p className="muted tiny">{tx("Yalnızca bu instance'a uyan içerikler gösteriliyor. \"Kur\" dediğinde uyumlu en son sürüm ve bağımlılıkları kurulur.")}</p>
            <button className="btn btn-ghost btn-sm" onClick={leaveInstance}>{tx("Tüm içeriği göster")}</button>
          </section>
        ) : (
        <section className="bf-sec">
          <h4>{tx("Minecraft sürümü")}</h4>
          <select className="bf-select" value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="">{tx("Tüm sürümler")}</option>
            {versions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="check tiny"><input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> {tx("Snapshot'ları da göster")}</label>
        </section>
        )}

        {!fromInstance && (kind === "mod" || kind === "modpack") && (
          <section className="bf-sec">
            <h4>{tx("Yükleyici")}</h4>
            <div className="bf-chips">
              {LOADERS.map((l) => (
                <button key={l} className={clsx("fchip", loader === l && "on")} onClick={() => setLoader(loader === l ? "" : l)}>{LOADER_LABEL[l]}</button>
              ))}
            </div>
          </section>
        )}

        {kind === "mod" && (
          <section className="bf-sec">
            <h4>{tx("Çalıştığı yer")}</h4>
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
            <h4>{header === "categories" ? tx("Kategori") : header === "features" ? tx("Özellikler") : header === "resolutions" ? tx("Çözünürlük") : header === "performance impact" ? tx("Performans etkisi") : catLabel(header)}</h4>
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
        {!tags && <p className="muted tiny"><Loader2 size={12} className="spin" /> {tx("Kategoriler yükleniyor…")}</p>}
      </aside>

      <div className="bmain" ref={topRef}>
        <div className="ctab-bar">
          <label className="ctab-search">
            <Search size={16} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx("{0} içinde ara…", KINDS.find((k) => k.id === kind)!.label)} autoFocus />
            {query && <button className="icon-btn sm" onClick={() => setQuery("")} aria-label={tx("Temizle")}><X size={14} /></button>}
          </label>
          <Menu
            trigger={(open) => <button className={clsx("btn btn-ghost lg", open && "pressed")}>{SORTS.find((s) => s.id === sort)!.label} <ChevronDown size={14} /></button>}
            items={SORTS.map((s) => ({ label: s.label, active: s.id === sort, icon: s.id === sort ? <Check size={14} /> : <span className="menu-gap" />, onClick: () => setSort(s.id) }))}
          />
        </div>

        <nav className="pill-tabs">
          {KINDS.filter((k) => !fromInstance || (k.id !== "modpack" && !(k.id === "mod" && fromInstance.loader.kind === "vanilla"))).map((k) => (
            <button key={k.id} className={clsx("pill-tab", kind === k.id && "on")} onClick={() => setParams({ kind: k.id, ...(fromInstance ? { instance: fromInstance.id } : {}) })}>{k.label}</button>
          ))}
        </nav>

        <div className="bmeta muted small">
          {loading && hits.length === 0 ? tx("Aranıyor…") : tx("{0} sonuç · sayfa {1} / {2}", formatCount(total), page, pages.toLocaleString(locale()))}
          {fromInstance && <span> · {tx("{0} ile uyumlu", fromInstance.name)}</span>}
          {kind === "modpack" && <span> {tx("· Modpack'ler kendi sürümüyle yeni bir instance olarak kurulur")}</span>}
        </div>

        {error && (
          <div className="banner banner-error row between">
            <span>{error}</span>
            <button className="btn btn-sm" onClick={() => { setError(null); setPage((p) => p); setRetry((r) => r + 1); }}>{tx("Tekrar dene")}</button>
          </div>
        )}

        <div className={`bresults ${loading && hits.length ? "dim" : ""}`}>
          {hits.map((h) => <ResultCard key={h.id} hit={h} instances={instances} preferred={fromInstance} direct={!!fromInstance} onOpen={() => setDetail(h)} />)}
        </div>

        {loading && hits.length === 0 && <div className="center pad muted"><Loader2 className="spin" size={18} /></div>}
        {!loading && hits.length === 0 && !error && <p className="muted center pad">{tx("Sonuç yok. Filtreleri gevşetmeyi dene.")}</p>}
        <Pagination page={page} pages={pages} onChange={changePage} disabled={loading} />
      </div>
      <AnimatePresence>
        {detail && <ModDetail key={detail.id} hit={detail} instances={instances} preferred={fromInstance} onClose={closeDetail} />}
      </AnimatePresence>
    </div>
  );
}

function ResultCard({ hit, instances, preferred, direct, onOpen }: { hit: ContentHit; instances: Instance[]; preferred: Instance | null; direct: boolean; onOpen: () => void }) {
  const side = sideLabel(hit);
  const range = versionRange(hit.versions);
  const shots = hit.gallery ?? [];
  return (
    <article className="rcard clickable" onClick={onOpen} title={tx("Ayrıntılar, galeri ve sürüm notları")}>
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
        <div className="rcard-shots" aria-label={tx("Görseller")}>
          {shots.slice(0, 3).map((g) => <img key={g} src={g} alt="" loading="lazy" referrerPolicy="no-referrer" />)}
        </div>
      )}
      <div className="rcard-side" onClick={(e) => e.stopPropagation()}>
        <span className="rstat"><Download size={13} /> {formatCount(hit.downloads)}</span>
        {hit.updated && <span className="rstat muted">{formatRelative(hit.updated)}</span>}
        <div className="row" style={{ gap: 6 }}>
          <button className="icon-btn" title={tx("Modrinth sayfası")} onClick={() => void openUrl(hit.url)}><ExternalLink size={16} /></button>
          <InstallMenu hit={hit} instances={instances} preferred={preferred} direct={direct} />
        </div>
      </div>
    </article>
  );
}
