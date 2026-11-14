import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, Loader2, Search } from "lucide-react";
import clsx from "clsx";
import { api, isTauri } from "@/lib/ipc";
import type { ContentHit, ContentKind, ContentSource, SearchQuery } from "@/lib/types";
import { useInstances } from "@/stores/instances";
import { useContent } from "@/stores/content";
import { ContentRow } from "@/components/ContentRow";
import { LOADER_LABEL } from "@/lib/format";

const KINDS: { id: ContentKind; label: string }[] = [
  { id: "mod", label: "Modlar" },
  { id: "modpack", label: "Modpack'ler" },
  { id: "shader", label: "Shader'lar" },
  { id: "resourcepack", label: "Resource Pack'ler" },
];

const PAGE = 20;

export function BrowsePage() {
  const [params, setParams] = useSearchParams();
  // Not: seçici yeni dizi döndürmemeli (zustand v5 sonsuz render) → filtre useMemo'da
  const allInstances = useInstances((s) => s.instances);
  const instances = useMemo(() => allInstances.filter((i) => !i.isTemplate), [allInstances]);
  const loadInstalled = useContent((s) => s.loadInstalled);

  const kind = (params.get("kind") as ContentKind) || "mod";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [instanceId, setInstanceId] = useState<string | null>(params.get("instance") ?? instances[0]?.id ?? null);
  const [source, setSource] = useState<"all" | ContentSource>("all");
  const [sort, setSort] = useState<SearchQuery["sort"]>("relevance");
  const [hits, setHits] = useState<ContentHit[]>([]);
  const [total, setTotal] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const instance = instances.find((i) => i.id === instanceId) ?? null;
  // Modpack'ler yeni instance oluşturur; diğerleri seçili instance'a göre filtrelenir
  const filterByInstance = kind !== "modpack" && instance;

  useEffect(() => {
    if (!instanceId && instances[0]) setInstanceId(instances[0].id);
  }, [instances, instanceId]);
  useEffect(() => {
    if (instanceId && isTauri()) void loadInstalled(instanceId);
  }, [instanceId, loadInstalled]);

  const baseQuery = useMemo<SearchQuery>(
    () => ({
      query: query.trim(),
      kind,
      gameVersion: filterByInstance ? instance!.mcVersion : null,
      loader: filterByInstance && kind === "mod" && instance!.loader.kind !== "vanilla" ? instance!.loader.kind : null,
      sort,
      limit: PAGE,
      sources: source === "all" ? null : [source],
    }),
    [query, kind, filterByInstance, instance, sort, source],
  );

  // 350 ms debounce + yarış koruması (eski yanıtlar yenilerini ezmesin)
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
        setNotices(r.notices);
        setError(null);
      } catch (e) {
        if (id === reqId.current) setError(String(e));
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [baseQuery]);

  const loadMore = async () => {
    setLoading(true);
    try {
      // offset her kaynağa ayrı uygulanır → kaynak başına şimdiye kadar gelen sonuç sayısı
      const per = (s: ContentSource) => hits.filter((h) => h.source === s).length;
      const offset = source === "all" ? Math.max(per("modrinth"), per("curseforge")) : hits.length;
      const r = await api.searchContent({ ...baseQuery, offset });
      const seen = new Set(hits.map((h) => `${h.source}:${h.id}`));
      setHits((prev) => [...prev, ...r.hits.filter((h) => !seen.has(`${h.source}:${h.id}`))]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <div className="browse-head">
        <div className="search grow">
          <Search size={15} />
          <input
            placeholder={`${KINDS.find((k) => k.id === kind)!.label.toLowerCase()} içinde ara…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        {kind !== "modpack" && (
          <select className="select-sm" value={instanceId ?? ""} onChange={(e) => setInstanceId(e.target.value || null)} title="Hedef instance">
            {instances.length === 0 && <option value="">Instance yok</option>}
            {instances.map((i) => (
              <option key={i.id} value={i.id}>{i.name} · {LOADER_LABEL[i.loader.kind]} {i.mcVersion}</option>
            ))}
          </select>
        )}
      </div>

      <div className="toolbar">
        <div className="tabs grow">
          {KINDS.map((k) => (
            <button key={k.id} className={clsx("tab", kind === k.id && "active")} onClick={() => setParams({ kind: k.id })}>
              {k.label}
            </button>
          ))}
        </div>
        <div className="pills">
          {(["all", "modrinth", "curseforge"] as const).map((s) => (
            <button key={s} className={clsx("pill", source === s && "active")} onClick={() => setSource(s)}>
              {s === "all" ? "Hepsi" : s === "modrinth" ? "Modrinth" : "CurseForge"}
            </button>
          ))}
        </div>
        <select className="select-sm" value={sort} onChange={(e) => setSort(e.target.value as SearchQuery["sort"])}>
          <option value="relevance">En alakalı</option>
          <option value="downloads">En çok indirilen</option>
          <option value="updated">Son güncellenen</option>
        </select>
      </div>

      {filterByInstance && (
        <p className="muted tiny">
          {instance!.name} ile uyumlu sonuçlar: Minecraft {instance!.mcVersion}
          {kind === "mod" && instance!.loader.kind !== "vanilla" ? ` · ${LOADER_LABEL[instance!.loader.kind]}` : ""}. Gerekli bağımlılıklar otomatik kurulur.
        </p>
      )}
      {kind === "modpack" && <p className="muted tiny">Modpack'ler kendi Minecraft sürümü ve loader'ıyla yeni, izole bir instance olarak kurulur.</p>}

      {notices.map((n) => (
        <div key={n} className="banner banner-info"><AlertCircle size={14} /> {n}</div>
      ))}
      {error && <div className="banner banner-error">{error}</div>}

      <div className="content-list">
        {hits.map((h) => <ContentRow key={`${h.source}:${h.id}`} hit={h} instanceId={instanceId} />)}
      </div>

      {loading && hits.length === 0 && <div className="center pad muted"><Loader2 className="spin" size={18} /></div>}
      {!loading && hits.length === 0 && !error && <p className="muted center pad">Sonuç yok. Farklı kelimeler dene ya da Ashi'ye sor.</p>}
      {hits.length > 0 && hits.length < total && (
        <button className="btn btn-ghost" style={{ alignSelf: "center" }} disabled={loading} onClick={loadMore}>
          {loading ? <Loader2 size={14} className="spin" /> : null} Daha fazla göster
        </button>
      )}
    </div>
  );
}
