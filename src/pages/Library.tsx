import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, Clock, Import, LayoutGrid, List, Loader2, Play, Plus, Search, Square, } from "lucide-react";
import { useOnboarding } from "@/stores/onboarding";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { InstanceIcon } from "@/components/InstanceIcon";
import { InstanceBanner } from "@/components/InstanceBanner";
import { CreateInstanceModal } from "@/components/CreateInstanceModal";
import type { Instance, LoaderKind } from "@/lib/types";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import { tx } from "@/lib/i18n";

type Filter = "all" | "templates" | LoaderKind;
type Sort = "recent" | "name" | "played" | "created" | "version";
const VIEW_KEY = "west.library.view";
const SORT_KEY = "west.library.sort";
const get = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const put = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* yok say */ } };

/** Sürüm numaralarını sayısal karşılaştır (1.21.11 > 1.21.2) */
const verCmp = (a: string, b: string) => {
  const x = a.split(/[.\-]/).map((n) => parseInt(n) || 0), y = b.split(/[.\-]/).map((n) => parseInt(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return 0;
};

export function LibraryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const instances = useInstances((s) => s.instances);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">(get(VIEW_KEY, "grid") as "grid" | "list");
  const [sort, setSort] = useState<Sort>(get(SORT_KEY, "recent") as Sort);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    const list = instances.filter((i) => {
      if (filter === "templates" ? !i.isTemplate : i.isTemplate) return false;
      if (filter !== "all" && filter !== "templates" && i.loader.kind !== filter) return false;
      return !q || i.name.toLowerCase().includes(q) || i.mcVersion.includes(q) || (i.group ?? "").toLowerCase().includes(q);
    });
    const by: Record<Sort, (a: Instance, b: Instance) => number> = {
      recent: (a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      played: (a, b) => b.totalPlaySecs - a.totalPlaySecs,
      created: (a, b) => b.created.localeCompare(a.created),
      version: (a, b) => verCmp(a.mcVersion, b.mcVersion),
    };
    return [...list].sort(by[sort]);
  }, [instances, query, filter, sort]);

  // Gruplar (instance ayarlarındaki "grup"); grubu olmayanlar en sonda
  const groups = useMemo(() => {
    const m = new Map<string, Instance[]>();
    for (const i of filtered) m.set(i.group || "", [...(m.get(i.group || "") ?? []), i]);
    return [...m.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  }, [filtered]);
  const grouped = groups.length > 1 || (groups.length === 1 && groups[0][0] !== "");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, templates: 0 };
    for (const i of instances) {
      if (i.isTemplate) c.templates++;
      else { c.all++; c[i.loader.kind] = (c[i.loader.kind] ?? 0) + 1; }
    }
    return c;
  }, [instances]);
  const filters: Filter[] = (["all", "fabric", "quilt", "forge", "neoforge", "vanilla", "templates"] as Filter[]).filter((f) => f === "all" || (counts[f] ?? 0) > 0);

  return (
    <div className="lib">
      <header className="rota-page-head">
        <div>
          <h1>{tx("Kütüphane")}</h1>
          <span className="muted small">{tx("{0} instance · toplam {1}", counts.all, formatDuration(instances.reduce((s, i) => s + i.totalPlaySecs, 0)))}</span>
        </div>
        <div className="rota-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => useOnboarding.getState().openWizard()} title={tx("Modrinth App, CurseForge, Prism, MultiMC veya resmi launcher'dan")}>
            <Import size={15} /> {tx("Aktar")}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setParams({ new: "1" })}><Plus size={15} /> {tx("Yeni instance")}</button>
        </div>
      </header>

      <div className="lib-bar">
        <div className="search lib-search"><Search size={15} /><input placeholder={tx("Ad, sürüm ya da grup ara…")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="lib-filters">
          {filters.map((f) => (
            <button key={f} className={clsx("fchip", filter === f && "on")} onClick={() => setFilter(f)}>
              {f === "all" ? tx("Tümü") : f === "templates" ? tx("Şablonlar") : LOADER_LABEL[f]} <span className="lib-count">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <select className="bf-select lib-sort" value={sort} onChange={(e) => { setSort(e.target.value as Sort); put(SORT_KEY, e.target.value); }}>
          <option value="recent">{tx("Son oynanan")}</option>
          <option value="name">{tx("Ada göre")}</option>
          <option value="played">{tx("En çok oynanan")}</option>
          <option value="created">{tx("En yeni eklenen")}</option>
          <option value="version">{tx("Minecraft sürümü")}</option>
        </select>
        <div className="segmented mini lib-view">
          <button className={clsx(view === "grid" && "active")} title={tx("Kutucuk")} onClick={() => { setView("grid"); put(VIEW_KEY, "grid"); }}><LayoutGrid size={14} /></button>
          <button className={clsx(view === "list" && "active")} title={tx("Liste")} onClick={() => { setView("list"); put(VIEW_KEY, "list"); }}><List size={14} /></button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="lib-empty">
          <p className="muted">{instances.length ? tx("Eşleşen instance yok.") : tx("Henüz instance yok.")}</p>
          {!instances.length && <button className="btn btn-primary" onClick={() => setParams({ new: "1" })}><Plus size={15} /> {tx("İlk instance'ını oluştur")}</button>}
        </div>
      ) : (
        groups.map(([g, list]) => (
          <section key={g || "_"} className="lib-group">
            {grouped && (
              <button className="lib-group-head" onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); return n; })}>
                <ChevronDown size={15} className={clsx(closed.has(g) && "rot")} /> {g || tx("Grupsuz")} <span className="muted small">{list.length}</span>
              </button>
            )}
            {!closed.has(g) && (view === "grid"
              ? <div className="rota-grid">{list.map((i) => <Tile key={i.id} i={i} />)}</div>
              : (
                <div className="lib-table">
                  <div className="lib-tr lib-th"><span /><span>{tx("Ad")}</span><span>{tx("Yükleyici")}</span><span>{tx("Sürüm")}</span><span>{tx("Oyun süresi")}</span><span>{tx("Son oynama")}</span><span /></div>
                  {list.map((i) => <Row key={i.id} i={i} />)}
                </div>
              ))}
          </section>
        ))
      )}

      <CreateInstanceModal open={params.get("new") === "1"} onClose={() => setParams({})} onCreated={(id) => navigate(`/instance/${id}`)} />
    </div>
  );
}

function usePlay(i: Instance) {
  const { running, launching, launch, kill } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const r = running[i.id] !== undefined, l = !!launching[i.id];
  const toggle = (e: React.MouseEvent) => { e.stopPropagation(); if (r) void kill(i.id); else if (!l) void launch(i.id, offlineName); };
  return { r, l, toggle };
}

function PlayBtn({ i, cls }: { i: Instance; cls: string }) {
  const { r, l, toggle } = usePlay(i);
  return (
    <button className={clsx(cls, r && "stop")} disabled={l} onClick={toggle} aria-label={r ? tx("Durdur") : tx("Oyna")}>
      {l ? <Loader2 size={15} className="spin" /> : r ? <Square size={12} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
    </button>
  );
}

function Tile({ i }: { i: Instance }) {
  const navigate = useNavigate();
  const { r } = usePlay(i);
  return (
    <div className={clsx("rota-card", r && "running")}>
      <button className="rota-card-cover" onClick={() => navigate(`/instance/${i.id}`)} aria-label={tx("{0} instance'ını aç", i.name)}>
        <InstanceBanner instance={i} className="rota-cover-img" />
      </button>
      <div className="rota-card-body">
        <div className="grow">
          <strong className="truncate">{i.name}</strong>
          <span className="muted small truncate">
            {LOADER_LABEL[i.loader.kind]} {i.mcVersion} · {r ? tx("Oynanıyor") : i.totalPlaySecs > 0 ? formatDuration(i.totalPlaySecs) : formatRelative(i.lastPlayed)}
          </span>
        </div>
        <PlayBtn i={i} cls="rota-mini" />
      </div>
    </div>
  );
}

function Row({ i }: { i: Instance }) {
  const navigate = useNavigate();
  const { r } = usePlay(i);
  return (
    <div className={clsx("lib-tr", r && "running")} onClick={() => navigate(`/instance/${i.id}`)}>
      <InstanceIcon instance={i} size={28} />
      <strong className="truncate">{i.name}</strong>
      <span><span className={`loader-badge ${i.loader.kind}`}>{LOADER_LABEL[i.loader.kind]}</span></span>
      <span className="muted">{i.mcVersion}</span>
      <span className="muted">{i.totalPlaySecs > 0 ? formatDuration(i.totalPlaySecs) : "—"}</span>
      <span className="muted"><Clock size={12} /> {formatRelative(i.lastPlayed)}</span>
      <PlayBtn i={i} cls="lib-play inline" />
    </div>
  );
}
