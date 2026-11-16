import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useNavigate } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import {
  ArrowDownAZ, ArrowUpCircle, Box, Check, ChevronDown, Compass, Download, ExternalLink, Filter, FolderOpen, History, FolderUp, Loader2,
  MoreVertical, Paintbrush, Plus, RefreshCw, Search, Sparkles, Trash2, X,
} from "lucide-react";
import clsx from "clsx";
import { ContentIcon } from "@/components/ContentIcon";
import { Menu, Switch } from "./Menu";
import { VersionPicker } from "./VersionPicker";
import { useInstances } from "@/stores/instances";
import { api, isTauri } from "@/lib/ipc";
import { Modal } from "@/components/Modal";
import { ModesBar } from "./ModesBar";
import type { ContentFile } from "@/lib/types";
import { askConfirm } from "@/components/ConfirmDialog";

type KindFilter = "all" | "mod" | "resourcepack" | "shader";
type Extra = "updates" | "disabled" | "deps";
type Sort = "az" | "za" | "updates" | "size";

const KIND_ICON = { mod: Box, resourcepack: Paintbrush, shader: Sparkles } as const;
const KIND_LABEL = { mod: "Mod", resourcepack: "Resource pack", shader: "Shader" } as const;
const SORT_LABEL: Record<Sort, string> = { az: "Ad (A-Z)", za: "Ad (Z-A)", updates: "Güncellemesi olan önce", size: "Boyut" };
const EXTRA_LABEL: Record<Extra, string> = { updates: "Güncellemesi olanlar", disabled: "Kapalı olanlar", deps: "Bağımlılık olarak gelenler" };

const fmtSize = (b: number) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function ContentTab({ instanceId, locked }: { instanceId: string; locked: boolean }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContentFile[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [extras, setExtras] = useState<Extra[]>([]);
  const [sort, setSort] = useState<Sort>("az");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const instance = useInstances((s) => s.instances.find((i) => i.id === instanceId) ?? null);
  const [picking, setPicking] = useState<ContentFile | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setItems(await api.refreshContent(instanceId));
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setRefreshing(false);
    }
  }, [instanceId]);

  useEffect(() => {
    setItems(null);
    setSelected(new Set());
    api.listContent(instanceId).then(setItems).catch(() => setItems([]));
    void refresh();
  }, [instanceId, refresh]);

  const counts = useMemo(() => {
    const c = { all: 0, mod: 0, resourcepack: 0, shader: 0 };
    for (const i of items ?? []) if (!i.managed) { c.all++; c[i.kind]++; }
    return c;
  }, [items]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (items ?? []).filter((i) =>
      !i.managed &&
      (kind === "all" || i.kind === kind) &&
      (!needle || i.title.toLowerCase().includes(needle) || i.file.toLowerCase().includes(needle) || (i.author ?? "").toLowerCase().includes(needle)) &&
      (!extras.includes("updates") || i.update) &&
      (!extras.includes("disabled") || !i.enabled) &&
      (!extras.includes("deps") || i.dependencyOf),
    );
    const by = (a: ContentFile, b: ContentFile) => a.title.localeCompare(b.title, "tr", { sensitivity: "base" });
    return list.sort(sort === "za" ? (a, b) => by(b, a) : sort === "size" ? (a, b) => b.size - a.size : sort === "updates" ? (a, b) => Number(!!b.update) - Number(!!a.update) || by(a, b) : by);
  }, [items, q, kind, extras, sort]);

  const updatable = useMemo(() => (items ?? []).filter((i) => i.update && !i.managed), [items]);
  const selectedItems = view.filter((i) => selected.has(i.id));
  const allSelected = view.length > 0 && selectedItems.length === view.length;

  const mark = (ids: string[], on: boolean) => setBusy((b) => { const n = new Set(b); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const fail = (e: unknown) => setNotice({ ok: false, text: String(e).replace(/^Error: /, "") });

  const toggle = async (ids: string[], enabled: boolean) => {
    setItems((list) => list?.map((i) => (ids.includes(i.id) ? { ...i, enabled } : i)) ?? null);
    try {
      await api.setContentEnabled(instanceId, ids, enabled);
    } catch (e) {
      setItems((list) => list?.map((i) => (ids.includes(i.id) ? { ...i, enabled: !enabled } : i)) ?? null);
      fail(e);
    }
  };

  const remove = async (list: ContentFile[]) => {
    const msg = list.length === 1 ? `"${list[0].title}" kaldırılsın mı? Dosya çöp kutusuna taşınır.` : `${list.length} içerik kaldırılsın mı? Dosyalar çöp kutusuna taşınır.`;
    if (!await askConfirm(msg)) return;
    const ids = list.map((i) => i.id);
    try {
      await api.deleteContent(instanceId, ids);
      setItems((l) => l?.filter((i) => !ids.includes(i.id)) ?? null);
      setSelected(new Set());
    } catch (e) {
      fail(e);
    }
  };

  const update = async (list: ContentFile[]) => {
    const ids = list.filter((i) => i.update).map((i) => i.id);
    if (!ids.length) return;
    mark(ids, true);
    setNotice(null);
    try {
      const r = await api.updateContent(instanceId, ids);
      const parts = [];
      if (r.updated.length) parts.push(`${r.updated.length} içerik güncellendi; eski dosyalar yedeklendi.`);
      if (r.failed.length) parts.push(`Güncellenemeyenler: ${r.failed.join("; ")}`);
      setNotice({ ok: r.failed.length === 0, text: parts.join(" ") });
      setSelected(new Set());
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      mark(ids, false);
    }
  };

  const upload = async () => {
    const picked = await openDialog({ multiple: true, filters: [{ name: "Mod veya paket", extensions: ["jar", "zip"] }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    if (!paths.length) return;
    await addPaths(paths);
  };

  const addPaths = async (paths: string[]) => {
    try {
      const added = await api.addContentFiles(instanceId, paths);
      setNotice({ ok: true, text: `${added.length} dosya eklendi.` });
      await refresh();
    } catch (e) {
      fail(e);
    }
  };

  // Dosyaları pencereye sürükle-bırak: önce onay sorulur
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<string[] | null>(null);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    if (!isTauri()) return;
    let wv;
    try { wv = getCurrentWebview(); } catch { return; }
    const un = wv.onDragDropEvent((e) => {
      const t = e.payload.type;
      if (t === "enter" || t === "over") setDragging(true);
      else if (t === "leave") setDragging(false);
      else if (t === "drop") {
        setDragging(false);
        const paths = e.payload.paths.filter((p) => /\.(jar|zip)$/i.test(p));
        if (lockedRef.current) setNotice({ ok: false, text: "Oyun açıkken içerik eklenemez." });
        else if (!paths.length) setNotice({ ok: false, text: "Yalnızca .jar (mod) veya .zip (resource pack / shader) dosyaları eklenebilir." });
        else setDropped(paths);
      }
    });
    return () => void un.then((f) => f());
  }, []);

  const reveal = async (c: ContentFile) => api.openPath(await api.filePath(instanceId, c.id.split("/")[0]));

  return (
    <div className="ctab">
      <div className="ctab-bar">
        <label className="ctab-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${counts.all} proje içinde ara…`} />
          {q && <button className="icon-btn sm" onClick={() => setQ("")} aria-label="Temizle"><X size={14} /></button>}
        </label>
        <button className="btn btn-ghost lg" disabled={locked} onClick={() => void upload()}><FolderUp size={16} /> Dosya yükle</button>
        <button className="btn btn-primary lg" onClick={() => navigate(`/browse?instance=${encodeURIComponent(instanceId)}`)}><Compass size={16} /> İçerik keşfet</button>
      </div>

      <ModesBar instanceId={instanceId} locked={locked} onApplied={() => void refresh()} onNotice={setNotice} />

      <div className="ctab-bar">
        <Menu
          align="left"
          trigger={(open) => <button className={clsx("btn btn-ghost", open && "pressed")}><ArrowDownAZ size={16} /> {SORT_LABEL[sort]} <ChevronDown size={14} /></button>}
          items={(Object.keys(SORT_LABEL) as Sort[]).map((s) => ({ label: SORT_LABEL[s], active: s === sort, icon: s === sort ? <Check size={14} /> : <span className="menu-gap" />, onClick: () => setSort(s) }))}
        />
        <span className="grow" />
        {offline && <span className="muted tiny">Modrinth'e ulaşılamadı; yerel bilgiler gösteriliyor</span>}
        {updatable.length > 0 && (
          <button className="btn-link accent" disabled={locked || busy.size > 0} onClick={() => void update(updatable)}>
            <Download size={16} /> Tümünü güncelle ({updatable.length})
          </button>
        )}
        <button className="btn-link" disabled={refreshing} onClick={() => void refresh()}>
          <RefreshCw size={16} className={clsx(refreshing && "spin")} /> Yenile
        </button>
      </div>

      <div className="ctab-filters">
        <Filter size={16} className="muted" />
        {(["all", "mod", "resourcepack", "shader"] as KindFilter[]).filter((k) => k === "all" || counts[k] > 0).map((k) => (
          <button key={k} className={clsx("fchip", kind === k && "on")} onClick={() => setKind(k)}>
            {k === "all" ? "Hepsi" : k === "mod" ? "Modlar" : k === "resourcepack" ? "Resource Pack" : "Shader"}
          </button>
        ))}
        <span className="vsep" />
        {extras.map((x) => (
          <button key={x} className="fchip on" onClick={() => setExtras((e) => e.filter((y) => y !== x))}>{EXTRA_LABEL[x]} <X size={13} /></button>
        ))}
        {extras.length < 3 && (
          <Menu
            align="left"
            trigger={() => <button className="fchip"><Plus size={14} /> Filtre</button>}
            items={(Object.keys(EXTRA_LABEL) as Extra[]).filter((x) => !extras.includes(x)).map((x) => ({ label: EXTRA_LABEL[x], onClick: () => setExtras((e) => [...e, x]) }))}
          />
        )}
      </div>

      {notice && (
        <div className={clsx("banner", notice.ok ? "banner-ok" : "banner-error", "row")}>
          <span className="grow">{notice.text}</span>
          <button className="icon-btn sm" onClick={() => setNotice(null)} aria-label="Kapat"><X size={14} /></button>
        </div>
      )}
      {locked && <div className="banner row"><span className="grow muted small">Oyun açıkken içerik değiştirilemez.</span></div>}

      <div className="ctable">
        <div className="ctable-head">
          <input type="checkbox" className="cbox" aria-label="Hepsini seç" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(view.map((i) => i.id)))} />
          {selectedItems.length ? (
            <div className="ctable-bulk">
              <strong>{selectedItems.length} seçili</strong>
              <button className="btn btn-sm btn-ghost" disabled={locked} onClick={() => void toggle(selectedItems.map((i) => i.id), true)}>Aç</button>
              <button className="btn btn-sm btn-ghost" disabled={locked} onClick={() => void toggle(selectedItems.map((i) => i.id), false)}>Kapat</button>
              {selectedItems.some((i) => i.update) && <button className="btn btn-sm btn-ghost" disabled={locked} onClick={() => void update(selectedItems)}><ArrowUpCircle size={14} /> Güncelle</button>}
              <button className="btn btn-sm btn-danger-ghost" disabled={locked} onClick={() => void remove(selectedItems)}><Trash2 size={14} /> Kaldır</button>
            </div>
          ) : (
            <span className="ctable-title">Proje</span>
          )}
          <span className="ctable-actions-h">İşlemler</span>
        </div>

        {items === null ? (
          <div className="ctable-empty"><Loader2 size={18} className="spin" /> İçerik okunuyor…</div>
        ) : view.length === 0 ? (
          <div className="ctable-empty">
            {counts.all === 0 ? (
              <>
                <p>Bu instance'ta henüz içerik yok.</p>
                <button className="btn btn-primary" onClick={() => navigate(`/browse?instance=${encodeURIComponent(instanceId)}`)}><Compass size={15} /> İçerik keşfet</button>
              </>
            ) : <p className="muted">Filtreye uyan içerik yok.</p>}
          </div>
        ) : (
          view.map((c) => {
            const KIcon = KIND_ICON[c.kind];
            const working = busy.has(c.id);
            return (
              <div key={c.id} className={clsx("crow", !c.enabled && "off", selected.has(c.id) && "sel")}>
                <input
                  type="checkbox" className="cbox" aria-label={`${c.title} seç`} checked={selected.has(c.id)}
                  onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                />
                <ContentIcon key={c.icon ?? c.id} src={c.icon} title={c.title} kind={c.kind} size={52} />
                <div className="crow-meta">
                  <div className="crow-title">
                    <KIcon size={16} className="muted" aria-label={KIND_LABEL[c.kind]} />
                    {c.projectId && c.source === "modrinth" ? (
                      <button className="crow-name truncate" title={`${c.file} · Keşfet'te aç`} onClick={() => navigate(`/browse?instance=${encodeURIComponent(instanceId)}&kind=${c.kind}&project=${encodeURIComponent(c.projectId!)}`)}>{c.title}</button>
                    ) : <strong className="truncate" title={c.file}>{c.title}</strong>}
                    {c.dependencyOf && <span className="chip" title={`${c.dependencyOf} için kuruldu`}>bağımlılık</span>}
                  </div>
                  <div className="crow-sub">
                    {c.author && (
                      <>
                        {c.authorAvatar ? <img className="avatar" src={c.authorAvatar} alt="" loading="lazy" /> : <span className="avatar ph">{c.author[0]?.toUpperCase()}</span>}
                        <span className="truncate">{c.author}</span>
                        <span className="dot" />
                      </>
                    )}
                    <span className="truncate">{c.version ?? fmtSize(c.size)}</span>
                    {c.update && <span className="upd-pill">→ {c.update.versionNumber}</span>}
                  </div>
                </div>
                <div className="crow-actions">
                  {c.update ? (
                    <button className="icon-btn accent" disabled={locked || working} title={`Güncelle: ${c.update.versionNumber}`} onClick={() => void update([c])}>
                      {working ? <Loader2 size={18} className="spin" /> : <ArrowUpCircle size={19} />}
                    </button>
                  ) : <span className="icon-btn ghost-slot" />}
                  {c.projectId && c.source === "modrinth" ? (
                    <button className="icon-btn" disabled={locked} title="Sürümü değiştir" onClick={() => setPicking(c)}><History size={18} /></button>
                  ) : <span className="icon-btn ghost-slot" />}
                  <Switch on={c.enabled} disabled={locked} label={c.enabled ? "Kapat" : "Aç"} onChange={(v) => void toggle([c.id], v)} />
                  <button className="icon-btn" disabled={locked} title="Kaldır" onClick={() => void remove([c])}><Trash2 size={18} /></button>
                  <Menu
                    trigger={() => <button className="icon-btn" aria-label="Daha fazla"><MoreVertical size={18} /></button>}
                    items={[
                      ...(c.url ? [{ label: "Modrinth sayfasını aç", icon: <ExternalLink size={14} />, onClick: () => void openUrl(c.url!) }] : []),
                      ...(c.projectId && c.source === "modrinth" ? [{ label: "Sürümü değiştir", icon: <History size={14} />, disabled: locked, onClick: () => setPicking(c) }] : []),
                      { label: "Klasörde göster", icon: <FolderOpen size={14} />, onClick: () => void reveal(c) },
                      { label: c.enabled ? "Kapat" : "Aç", icon: <span className="menu-gap" />, disabled: locked, onClick: () => void toggle([c.id], !c.enabled) },
                      { label: "Kaldır", icon: <Trash2 size={14} />, danger: true, disabled: locked, onClick: () => void remove([c]) },
                    ]}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
      {instance && <VersionPicker instance={instance} item={picking} onClose={() => setPicking(null)} onChanged={(text) => { setNotice({ ok: true, text }); void refresh(); }} />}
      {dragging && !locked && (
        <div className="drop-overlay"><FolderUp size={34} /><strong>Bırak, bu instance'a ekleyelim</strong><span className="muted small">.jar modlar · .zip resource pack ve shader'lar</span></div>
      )}
      <Modal open={!!dropped} onClose={() => setDropped(null)} title="Dosyalar eklensin mi?" width={460}
        footer={<><button className="btn btn-ghost" onClick={() => setDropped(null)}>Vazgeç</button><button className="btn btn-primary" onClick={() => { const p = dropped ?? []; setDropped(null); void addPaths(p); }}><Download size={15} /> {dropped?.length ?? 0} dosyayı ekle</button></>}>
        <p className="small">Bu dosyalar instance'a kopyalanacak. Yalnızca güvendiğin kaynaklardan indirdiğin dosyaları ekle.</p>
        <ul className="drop-list">{(dropped ?? []).map((p) => <li key={p}><Box size={14} /> <span className="truncate">{p.split(/[\\/]/).pop()}</span></li>)}</ul>
      </Modal>
    </div>
  );
}
