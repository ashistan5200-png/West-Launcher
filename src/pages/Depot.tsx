import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  AlertTriangle, Box, Check, ChevronLeft, ChevronRight, Download, FileArchive, Flag, FolderOpen, Gavel, Globe2, History, ImagePlus, Layers, Loader2, Package, Palette, Pencil, Play, Plus,
  RefreshCw, RotateCcw, Search, Shapes, ShieldCheck, Sparkles, Trash2, Upload, UserCog, X,
} from "lucide-react";
import { Modal } from "@/components/Modal";
import { askConfirm } from "@/components/ConfirmDialog";
import { RoleBadge } from "@/components/RoleBadge";
import { WestAccountCard } from "@/components/WestAccountCard";
import { InstanceIcon } from "@/components/InstanceIcon";
import { useWest } from "@/stores/west";
import { useInstances } from "@/stores/instances";
import { api, isTauri } from "@/lib/ipc";
import { markdownToHtml } from "@/lib/markdown";
import { LOADER_LABEL, formatCount } from "@/lib/format";
import { locale, tx } from "@/lib/i18n";
import type { Instance } from "@/lib/types";
import * as D from "@/lib/depot";
import type { DepotItem, DepotKind, Role } from "@/lib/depot";

const err = (e: unknown) => String(e).replace(/^Error: /, "");

/** Kısa metin soran pencere (Tauri'de window.prompt beklemeden döner) */
interface AskText { title: string; hint: string; initial: string; resolve: (v: string | null) => void }
function useAskText() {
  const [ask, setAsk] = useState<AskText | null>(null);
  const [val, setVal] = useState("");
  const askText = (title: string, hint: string, initial = "") =>
    new Promise<string | null>((resolve) => { setVal(initial); setAsk({ title, hint, initial, resolve }); });
  const close = (v: string | null) => { ask?.resolve(v); setAsk(null); };
  const node = (
    <Modal open={!!ask} title={ask?.title ?? ""} onClose={() => close(null)} width={440}
      footer={<>
        <button className="btn btn-ghost" onClick={() => close(null)}>{tx("Vazgeç")}</button>
        <button className="btn btn-primary" disabled={!val.trim()} onClick={() => close(val.trim())}>{tx("Tamam")}</button>
      </>}>
      <p className="muted small">{ask?.hint}</p>
      <textarea className="input" rows={3} maxLength={300} value={val} autoFocus onChange={(e) => setVal(e.target.value)} />
    </Modal>
  );
  return { askText, node };
}
const KIND_ICON: Record<DepotKind, typeof Box> = { mod: Box, resourcepack: Palette, shader: Sparkles, world: Globe2, schematic: Shapes, datapack: Layers, modpack: Package, other: FileArchive };
const date = (s: string) => new Date(s).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });

/** Rol bilgisini tek yerden okur (Supabase'ten; arayüz yalnızca gösterim için kullanır) */
function useRole() {
  const account = useWest((s) => s.account);
  const [role, setRole] = useState<Role | null>(null);
  const reload = useCallback(() => {
    if (!account) return setRole(null);
    D.myRole(account.userId).then(setRole).catch(() => setRole("member"));
  }, [account]);
  useEffect(reload, [reload]);
  return { role, reload };
}

export function DepotPage() {
  const account = useWest((s) => s.account);
  const loaded = useWest((s) => s.loaded);
  const { role, reload: reloadRole } = useRole();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "browse" | "mine" | "manage") ?? "browse";
  const setTab = (t: string) => setParams((p) => { p.set("tab", t); p.delete("item"); return p; }, { replace: true });
  const [kind, setKind] = useState<DepotKind | "all">("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"new" | "popular">("new");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<DepotItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bump, setBump] = useState(0);
  const openId = params.get("item");
  const [open, setOpen] = useState<DepotItem | null>(null);

  useEffect(() => setPage(0), [kind, q, sort, tab]);
  useEffect(() => {
    if (!isTauri() || !account || tab === "manage") return;
    let live = true;
    setError(null);
    const t = window.setTimeout(() => {
      D.listItems({ kind, q, sort, page, author: tab === "mine" ? account.userId : undefined })
        .then((r) => { if (live) { setItems(r.data); setTotal(r.total); } })
        .catch((e) => live && setError(err(e)));
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [account, kind, q, sort, page, tab, bump]);

  // Bağlantıyla açılan öğe (?item=…)
  useEffect(() => {
    if (!openId) return setOpen(null);
    const known = items?.find((i) => i.id === openId);
    if (known) setOpen(known);
    else D.getItem(openId).then(setOpen).catch(() => setOpen(null));
  }, [openId, items]);
  const show = (it: DepotItem | null) => setParams((p) => { if (it) p.set("item", it.id); else p.delete("item"); return p; }, { replace: true });

  if (loaded && !account) {
    return (
      <div className="page depot">
        <div className="s-gate">
          <h1>{tx("West Depo")}</h1>
          <p className="muted">{tx("Topluluğun paylaştığı modlar, kaynak paketleri, shader'lar, dünyalar ve şematikler. Göz atmak ve indirmek için West hesabıyla giriş yap.")}</p>
          <div style={{ width: "min(460px, 100%)" }}><WestAccountCard /></div>
        </div>
      </div>
    );
  }

  const canUpload = D.roleRank(role) >= 1;
  const staff = D.roleRank(role) >= 2;
  const pages = Math.max(1, Math.ceil(total / D.PAGE));

  return (
    <div className="page depot">
      <header className="depot-hero">
        <div className="depot-hero-glow" aria-hidden />
        <div className="grow">
          <span className="shop-eyebrow">{tx("Topluluk")}</span>
          <h1>{tx("West Depo")}</h1>
          <p className="muted">{tx("Onaylı oyuncuların paylaştığı modlar, kaynak paketleri, shader'lar, dünyalar, şematikler ve daha fazlası. Tek tıkla instance'ına kur.")}</p>
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            {role && <span className="muted tiny">{tx("Yetkin:")}</span>}
            <RoleBadge role={role} showMember />
          </div>
        </div>
        <div className="depot-hero-side">
          {canUpload ? (
            <button className="btn btn-primary" onClick={() => setUploading(true)}><Upload size={15} /> {tx("Dosya paylaş")}</button>
          ) : role ? (
            <ApprovalBox userId={account!.userId} onChange={reloadRole} />
          ) : null}
        </div>
      </header>

      <nav className="pill-tabs">
        <button className={clsx("pill-tab", tab === "browse" && "on")} onClick={() => setTab("browse")}><Search size={15} /> {tx("Göz at")}</button>
        {canUpload && <button className={clsx("pill-tab", tab === "mine" && "on")} onClick={() => setTab("mine")}><Upload size={15} /> {tx("Paylaştıklarım")}</button>}
        {staff && <button className={clsx("pill-tab", tab === "manage" && "on")} onClick={() => setTab("manage")}><Gavel size={15} /> {tx("Yönetim")}</button>}
      </nav>

      {tab === "manage" && staff ? (
        <ManagePanel role={role!} myId={account!.userId} onOpen={show} />
      ) : (
        <>
          <div className="depot-bar">
            <div className="depot-kinds">
              <button className={clsx("fchip", kind === "all" && "on")} onClick={() => setKind("all")}>{tx("Tümü")}</button>
              {D.DEPOT_KINDS.map((k) => {
                const I = KIND_ICON[k];
                return <button key={k} className={clsx("fchip", kind === k && "on")} onClick={() => setKind(k)}><I size={13} /> {D.KIND_LABEL[k]}</button>;
              })}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="search"><Search size={15} /><input className="input" placeholder={tx("Depo'da ara")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <select className="bf-select" value={sort} onChange={(e) => setSort(e.target.value as "new" | "popular")}>
                <option value="new">{tx("En yeni")}</option>
                <option value="popular">{tx("En çok indirilen")}</option>
              </select>
            </div>
          </div>

          {error && <p className="depot-note err"><AlertTriangle size={15} /> {error}</p>}
          {!items && !error && <p className="muted"><Loader2 size={14} className="spin" /> {tx("Yükleniyor…")}</p>}
          {items && items.length === 0 && (
            <div className="depot-empty">
              <Package size={34} />
              <p className="muted">{tab === "mine" ? tx("Henüz bir şey paylaşmadın.") : q || kind !== "all" ? tx("Aramana uyan dosya yok.") : tx("Depo henüz boş. İlk paylaşımı Onaylı oyuncular yapacak.")}</p>
              {tab === "mine" && canUpload && <button className="btn btn-primary btn-sm" onClick={() => setUploading(true)}><Plus size={14} /> {tx("Dosya paylaş")}</button>}
            </div>
          )}
          <div className="depot-grid">
            {items?.map((it) => <ItemCard key={it.id} it={it} onOpen={() => show(it)} />)}
          </div>
          {pages > 1 && (
            <div className="row depot-pages">
              <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{tx("Önceki")}</button>
              <span className="muted small">{page + 1} / {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{tx("Sonraki")}</button>
            </div>
          )}
        </>
      )}

      {open && <ItemModal it={open} role={role} myId={account?.userId ?? null} onClose={() => show(null)} onChanged={() => { setBump((b) => b + 1); show(null); }} />}
      {uploading && <UploadModal onClose={() => setUploading(false)} onDone={(it) => { setUploading(false); setBump((b) => b + 1); show(it); }} />}
    </div>
  );
}

function ItemIcon({ it, size = 52 }: { it: Pick<DepotItem, "icon_url" | "kind">; size?: number }) {
  const I = KIND_ICON[it.kind];
  return it.icon_url ? <img className="depot-icon" src={it.icon_url} alt="" width={size} height={size} /> : <span className={clsx("depot-icon ph", it.kind)} style={{ width: size, height: size }}><I size={size * 0.46} /></span>;
}

function ItemCard({ it, onOpen }: { it: DepotItem; onOpen: () => void }) {
  return (
    <button className={clsx("depot-card", it.removed && "removed", it.gallery?.length && "has-cover")} onClick={onOpen}>
      {it.gallery?.length ? <img className="depot-cover" src={it.gallery[0].url} alt="" loading="lazy" /> : null}
      <ItemIcon it={it} />
      <div className="depot-card-body">
        <strong className="truncate">{it.title}</strong>
        <span className="muted small depot-summary">{it.summary || D.KIND_LABEL[it.kind]}</span>
        <div className="depot-meta">
          <span className="chip">{D.KIND_LABEL[it.kind]}</span>
          {it.mc_versions.slice(0, 2).map((v) => <span key={v} className="chip">{v}</span>)}
          {it.loaders.filter((l) => l !== "vanilla").slice(0, 2).map((l) => <span key={l} className="chip">{LOADER_LABEL[l] ?? l}</span>)}
        </div>
        <div className="depot-by">
          <span className="truncate">{it.display_name || it.username}</span>
          <RoleBadge role={it.author_role} size="xs" />
          <span className="grow" />
          <span className="muted tiny"><Download size={11} /> {formatCount(it.downloads)}</span>
        </div>
        {it.removed && <span className="depot-removed-tag">{tx("Kaldırıldı")}</span>}
      </div>
    </button>
  );
}

// ───────── Galeri ─────────

function Gallery({ images }: { images: D.GalleryImage[] }) {
  const [i, setI] = useState(0);
  const [big, setBig] = useState(false);
  if (!images.length) return null;
  const cur = images[Math.min(i, images.length - 1)];
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length);
  return (
    <div className="depot-gallery">
      <button className="depot-gallery-main" onClick={() => setBig(true)} title={tx("Büyüt")}>
        <img src={cur.url} alt={cur.caption ?? ""} />
        {images.length > 1 && <>
          <span className="depot-gal-nav l" onClick={(e) => { e.stopPropagation(); go(-1); }}><ChevronLeft size={18} /></span>
          <span className="depot-gal-nav r" onClick={(e) => { e.stopPropagation(); go(1); }}><ChevronRight size={18} /></span>
        </>}
        {cur.caption && <span className="depot-gal-cap">{cur.caption}</span>}
      </button>
      {images.length > 1 && (
        <div className="depot-gal-thumbs">
          {images.map((g, k) => <button key={g.url} className={clsx(k === i && "on")} onClick={() => setI(k)}><img src={g.url} alt="" /></button>)}
        </div>
      )}
      {big && (
        <div className="depot-lightbox" onMouseDown={() => setBig(false)}>
          <img src={cur.url} alt={cur.caption ?? ""} onMouseDown={(e) => e.stopPropagation()} />
          {cur.caption && <span>{cur.caption}</span>}
          {images.length > 1 && <>
            <button className="depot-gal-nav l" onMouseDown={(e) => { e.stopPropagation(); go(-1); }}><ChevronLeft size={22} /></button>
            <button className="depot-gal-nav r" onMouseDown={(e) => { e.stopPropagation(); go(1); }}><ChevronRight size={22} /></button>
          </>}
        </div>
      )}
    </div>
  );
}

/** Galeri düzenleyici: yerel görsel ekle, açıklama yaz, sırala, çıkar (kayıtta yüklenir) */
type GalItem = { url?: string; local?: string; preview: string; caption: string };
function GalleryEditor({ items, onChange, onError }: { items: GalItem[]; onChange: (g: GalItem[]) => void; onError: (e: string) => void }) {
  const add = async () => {
    const p = await openDialog({ multiple: true, filters: [{ name: tx("Görsel"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }] });
    const list = Array.isArray(p) ? p : typeof p === "string" ? [p] : [];
    const next = [...items];
    for (const path of list) {
      if (next.length >= D.MAX_GALLERY) break;
      try { next.push({ local: path, preview: await api.readImageData(path), caption: "" }); } catch (e) { onError(err(e)); }
    }
    onChange(next);
  };
  const move = (k: number, d: number) => {
    const n = [...items];
    const [x] = n.splice(k, 1);
    n.splice(Math.max(0, Math.min(n.length, k + d)), 0, x);
    onChange(n);
  };
  return (
    <div className="field">
      <span>{tx("Fotoğraflar ({0}/{1}) · oyundan ekran görüntüleri, örnekler", items.length, D.MAX_GALLERY)}</span>
      <div className="depot-gal-edit">
        {items.map((g, k) => (
          <div key={(g.url ?? g.local ?? "") + k} className="depot-gal-item">
            <img src={g.preview} alt="" />
            <input className="input" maxLength={120} placeholder={tx("Açıklama (isteğe bağlı)")} value={g.caption} onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, caption: e.target.value } : x)))} />
            <div className="depot-gal-tools">
              <button className="icon-btn" disabled={k === 0} onClick={() => move(k, -1)} title={tx("Sola al")}><ChevronLeft size={14} /></button>
              <button className="icon-btn" disabled={k === items.length - 1} onClick={() => move(k, 1)} title={tx("Sağa al")}><ChevronRight size={14} /></button>
              <button className="icon-btn" onClick={() => onChange(items.filter((_, j) => j !== k))} title={tx("Çıkar")}><X size={14} /></button>
            </div>
          </div>
        ))}
        {items.length < D.MAX_GALLERY && <button className="depot-gal-add" onClick={() => void add()}><ImagePlus size={20} /><span className="small">{tx("Fotoğraf ekle")}</span></button>}
      </div>
    </div>
  );
}

// ───────── Ayrıntı ve kurulum ─────────

function ItemModal({ it, role, myId, onClose, onChanged }: { it: DepotItem; role: Role | null; myId: string | null; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const instances = useInstances((s) => s.instances).filter((i) => !i.isTemplate);
  const [target, setTarget] = useState<string>("");
  const [worlds, setWorlds] = useState<string[]>([]);
  const [world, setWorld] = useState("");
  const [warn, setWarn] = useState<{ versionId: string | null; label: string } | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; place: string; warnings: string[]; instanceId: string | null; replaced: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [versions, setVersions] = useState<D.DepotVersion[]>([]);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [installed, setInstalled] = useState<{ version: string; sha256: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [newVersion, setNewVersion] = useState(false);
  const html = useMemo(() => markdownToHtml(it.description || ""), [it.description]);
  const mine = it.author_id === myId;
  const staff = D.roleRank(role) >= 2;
  const toInstance = D.needsInstance(it.kind);
  const { askText, node: askNode } = useAskText();

  const loadVersions = useCallback(() => { D.versions(it.id).then(setVersions).catch(() => setVersions([])); }, [it.id]);
  useEffect(loadVersions, [loadVersions]);

  // Uygun instance'ı önceden seç
  const why = (inst: Instance): string | null => {
    if (it.kind === "mod") {
      if (inst.loader.kind === "vanilla") return tx("Vanilla instance'a mod kurulamaz");
      const ok = !it.loaders.length || it.loaders.includes(inst.loader.kind) || (inst.loader.kind === "quilt" && it.loaders.includes("fabric"));
      if (!ok) return tx("{0} desteklenmiyor", LOADER_LABEL[inst.loader.kind]);
    }
    return null;
  };
  useEffect(() => {
    if (!toInstance) return setTarget("");
    const best = instances.find((i) => !why(i) && (!it.mc_versions.length || it.mc_versions.some((v) => i.mcVersion.startsWith(v)))) ?? instances.find((i) => !why(i));
    setTarget(best?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.id]);
  useEffect(() => {
    if (it.kind !== "datapack" || !target) return setWorlds([]);
    api.listWorlds(target).then((w) => { setWorlds(w.map((x) => x.folder)); setWorld(w[0]?.folder ?? ""); }).catch(() => setWorlds([]));
  }, [it.kind, target]);
  // Bu instance'ta kurulu mu, hangi sürüm
  useEffect(() => {
    if (!toInstance || !target) return setInstalled(null);
    api.depotInstalled(target).then((r) => setInstalled(r[it.id] ?? null)).catch(() => setInstalled(null));
  }, [toInstance, target, it.id, done]);

  const install = async () => {
    const v = warn?.versionId ?? null;
    setWarn(null);
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.depotInstall(it.id, toInstance ? target || null : null, it.kind === "datapack" ? world || null : null, v);
      setDone({ ...r.installed, warnings: r.warnings, instanceId: r.instanceId, replaced: r.replaced });
      if (r.instanceId) void useInstances.getState().refresh();
    } catch (e) {
      setMsg(err(e));
    } finally {
      setBusy(false);
    }
  };
  const ask = (versionId: string | null, label: string) => { setAgree(false); setWarn({ versionId, label }); };

  const remove = async () => {
    if (mine) {
      if (!(await askConfirm(tx("\"{0}\" Depo'dan silinsin mi? Dosya sunucudan da silinir.", it.title)))) return;
      try { await D.deleteItem(it); onChanged(); } catch (e) { setMsg(err(e)); }
    } else {
      let reason: string | null = null;
      if (!it.removed) {
        reason = await askText(tx("Dosyayı kaldır"), tx("Kaldırma nedeni (paylaşana bildirilir):"), tx("Kurallara aykırı içerik"));
        if (reason === null) return;
      } else if (!(await askConfirm(tx("\"{0}\" yeniden herkese görünsün mü?", it.title), { danger: false }))) return;
      try { await D.moderate(it.id, !it.removed, reason); onChanged(); } catch (e) { setMsg(err(e)); }
    }
  };
  const doReport = async () => {
    const reason = await askText(tx("Şikâyet et"), tx("Bu dosyada sorun ne? (ör. virüs şüphesi, çalıntı içerik)"));
    if (!reason?.trim()) return;
    try { await D.report(it.id, reason.trim().slice(0, 500)); setMsg(tx("Şikâyetin moderatörlere iletildi. Teşekkürler.")); } catch (e) { setMsg(err(e)); }
  };
  const dropVersion = async (v: D.DepotVersion) => {
    if (!(await askConfirm(tx("{0} sürümü silinsin mi?", v.version)))) return;
    try { await D.deleteVersion(v.id); loadVersions(); } catch (e) { setMsg(err(e)); }
  };

  const tgt = instances.find((i) => i.id === target);
  const blocked = toInstance && (!tgt || !!why(tgt) || (it.kind === "datapack" && !world));
  const upToDate = !!installed && installed.sha256 === it.sha256;
  const mainLabel = it.kind === "modpack" ? tx("Instance olarak kur") : !toInstance ? tx("İndir") : installed ? (upToDate ? tx("Yeniden kur") : tx("{0} sürümüne güncelle", it.version || tx("son"))) : tx("Kur");

  return (
    <Modal open title={it.title} onClose={onClose} width={760}>
      <div className="depot-detail">
        <div className="depot-detail-head">
          <ItemIcon it={it} size={72} />
          <div className="grow">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="chip chip-accent">{D.KIND_LABEL[it.kind]}</span>
              {it.version && <span className="chip">v{it.version}</span>}
              {it.mc_versions.map((v) => <span key={v} className="chip">{v}</span>)}
              {it.loaders.filter((l) => l !== "vanilla").map((l) => <span key={l} className="chip">{LOADER_LABEL[l] ?? l}</span>)}
            </div>
            {it.summary && <p className="depot-detail-summary">{it.summary}</p>}
            <button className="depot-author" onClick={() => navigate(`/u/${it.username}`)}>
              {it.avatar_url ? <img src={it.avatar_url} alt="" /> : <span className="depot-author-ph">{(it.display_name || it.username)[0]?.toUpperCase()}</span>}
              <span>{it.display_name || it.username}</span>
              <RoleBadge role={it.author_role} size="xs" />
            </button>
          </div>
        </div>

        {it.removed && <p className="depot-note err"><AlertTriangle size={15} /> {tx("Bu dosya bir moderatör tarafından kaldırıldı.")} {it.removed_reason ? `“${it.removed_reason}”` : ""}</p>}

        <Gallery images={it.gallery ?? []} />

        <section className="depot-install">
          {done ? (
            <div className="depot-done">
              <Check size={18} />
              <div className="grow">
                <strong>{done.instanceId ? tx("Instance oluşturuldu: {0}", done.place) : done.replaced ? tx("{0} sürümünden güncellendi", done.replaced) : tx("Kuruldu")}</strong>
                {!done.instanceId && <span className="muted small">{done.place}</span>}
                {done.warnings.map((w) => <span key={w} className="depot-warn small"><AlertTriangle size={12} /> {w}</span>)}
              </div>
              {done.instanceId
                ? <button className="btn btn-primary btn-sm" onClick={() => { onClose(); navigate(`/instance/${done.instanceId}`); }}><Play size={14} /> {tx("Instance'a git")}</button>
                : <button className="btn btn-ghost btn-sm" onClick={() => void api.openPath(done.path, true)}><FolderOpen size={14} /> {tx("Klasörde göster")}</button>}
            </div>
          ) : (
            <>
              <div className="depot-target">
                {toInstance ? (
                  <>
                    <span className="muted small">{tx("Kurulacağı yer:")} <code>{D.KIND_PLACE[it.kind]}</code>
                      {installed && <span className={clsx("depot-installed", !upToDate && "old")}>{upToDate ? tx("Kurulu · v{0}", installed.version) : tx("Kurulu: v{0} · güncelleme var", installed.version)}</span>}
                    </span>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      {tgt && <InstanceIcon instance={tgt} size={26} />}
                      <select className="bf-select grow" value={target} onChange={(e) => setTarget(e.target.value)}>
                        {instances.length === 0 && <option value="">{tx("Önce bir instance oluştur")}</option>}
                        {instances.map((i) => {
                          const w = why(i);
                          return <option key={i.id} value={i.id} disabled={!!w}>{i.name} · {LOADER_LABEL[i.loader.kind]} {i.mcVersion}{w ? ` — ${w}` : ""}</option>;
                        })}
                      </select>
                      {it.kind === "datapack" && (
                        <select className="bf-select" value={world} onChange={(e) => setWorld(e.target.value)}>
                          {worlds.length === 0 && <option value="">{tx("Bu instance'ta dünya yok")}</option>}
                          {worlds.map((w) => <option key={w} value={w}>{w}</option>)}
                        </select>
                      )}
                    </div>
                  </>
                ) : it.kind === "modpack" ? (
                  <span className="muted small">{tx("Bu modpack yeni bir instance olarak kurulur; modlar, ayarlar ve Minecraft/yükleyici sürümü paketteki gibi hazırlanır.")}</span>
                ) : (
                  <span className="muted small">{tx("Bu dosya İndirilenler klasörüne kaydedilir.")}</span>
                )}
              </div>
              <button className="btn btn-primary" disabled={busy || blocked || (it.removed && !staff && !mine)} onClick={() => ask(null, it.version)}>
                {busy ? <Loader2 size={15} className="spin" /> : installed && !upToDate ? <RefreshCw size={15} /> : <Download size={15} />} {mainLabel}
              </button>
            </>
          )}
        </section>

        {msg && <p className="depot-note">{msg}</p>}

        <div className="depot-facts">
          <div><span className="muted tiny">{tx("Dosya")}</span><strong className="truncate" title={it.file_name}>{it.file_name}</strong></div>
          <div><span className="muted tiny">{tx("Boyut")}</span><strong>{D.formatSize(it.file_size)}</strong></div>
          <div><span className="muted tiny">{tx("İndirme")}</span><strong>{formatCount(it.downloads)}</strong></div>
          <div><span className="muted tiny">{it.updated_at !== it.created_at ? tx("Güncellendi") : tx("Paylaşıldı")}</span><strong>{date(it.updated_at || it.created_at)}</strong></div>
          <div className="wide"><span className="muted tiny">SHA-256</span><code className="depot-hash" title={it.sha256}>{it.sha256}</code></div>
        </div>

        {it.description && <div className="md depot-desc" dangerouslySetInnerHTML={{ __html: html }} />}

        {versions.length > 0 && (
          <section className="depot-versions">
            <h4><History size={15} /> {tx("Sürümler")} <span className="muted tiny">({versions.length})</span></h4>
            {versions.map((v, k) => {
              const current = v.file_path === it.file_path;
              return (
                <div key={v.id} className="depot-version">
                  <div className="row" style={{ gap: 8 }}>
                    <strong>v{v.version}</strong>
                    {current && <span className="chip chip-accent">{tx("Güncel")}</span>}
                    {installed && installed.sha256 === v.sha256 && <span className="chip">{tx("Kurulu")}</span>}
                    <span className="muted tiny">{date(v.created_at)} · {D.formatSize(v.file_size)}{v.mc_versions.length ? ` · ${v.mc_versions.join(", ")}` : ""}</span>
                    <span className="grow" />
                    {v.changelog && <button className="btn-link" style={{ marginLeft: 0 }} onClick={() => setOpenLog(openLog === v.id ? null : v.id)}>{openLog === v.id ? tx("Notları gizle") : tx("Değişiklikler")}</button>}
                    {!current && it.kind !== "other" && <button className="btn btn-ghost btn-sm" disabled={busy || blocked} onClick={() => ask(v.id, v.version)}><Download size={13} /> {tx("Bu sürümü kur")}</button>}
                    {(mine || staff) && !current && <button className="icon-btn" title={tx("Sürümü sil")} onClick={() => void dropVersion(v)}><Trash2 size={14} /></button>}
                  </div>
                  {(openLog === v.id || (k === 0 && v.changelog && openLog === null)) && v.changelog && <p className="depot-changelog small">{v.changelog}</p>}
                </div>
              );
            })}
          </section>
        )}

        <footer className="depot-detail-foot">
          {!mine && <button className="btn btn-ghost btn-sm" onClick={() => void doReport()}><Flag size={14} /> {tx("Şikâyet et")}</button>}
          {mine && !it.removed && <>
            <button className="btn btn-primary btn-sm" onClick={() => setNewVersion(true)}><Upload size={14} /> {tx("Yeni sürüm yükle")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Pencil size={14} /> {tx("Düzenle")}</button>
          </>}
          <span className="grow" />
          {(mine || staff) && (
            <button className={clsx("btn btn-sm", mine || !it.removed ? "btn-danger" : "btn-ghost")} onClick={() => void remove()}>
              {mine ? <><Trash2 size={14} /> {tx("Sil")}</> : it.removed ? <><RotateCcw size={14} /> {tx("Geri yükle")}</> : <><Gavel size={14} /> {tx("Kaldır")}</>}
            </button>
          )}
        </footer>
      </div>

      <Modal open={!!warn} title={tx("İndirmeden önce")} onClose={() => setWarn(null)} width={480}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setWarn(null)}>{tx("Vazgeç")}</button>
          <button className="btn btn-primary" disabled={!agree} onClick={() => void install()}><Download size={15} /> {tx("Anladım, kur")}</button>
        </>}>
        <div className="depot-disclaimer">
          <AlertTriangle size={28} />
          {warn?.label && <p className="muted small">{it.title} · v{warn.label}</p>}
          <p>{tx("Depo'daki dosyaları West Client değil, topluluk üyeleri paylaşır. Yalnızca Onaylı kişiler dosya yükleyebilir ve dosyanın türü yüklenirken denetlenir; ancak içerikler virüs ya da zararlı yazılıma karşı taranmaz.")}</p>
          <p><strong>{tx("West Client, Depo'dan indirilen dosyaların yol açabileceği virüs, veri kaybı ya da başka zararlardan sorumlu değildir.")}</strong> {tx("Yalnızca güvendiğin kişilerin dosyalarını kur; şüpheli bir şey görürsen şikâyet et.")}</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {tx("Okudum; bu dosyayı kendi sorumluluğumda kuruyorum.")}</label>
        </div>
      </Modal>
      {askNode}
      {newVersion && <VersionModal it={it} existing={versions.map((v) => v.version)} onClose={() => setNewVersion(false)} onDone={() => { setNewVersion(false); onChanged(); }} />}
      {editing && <EditModal it={it} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); }} />}
    </Modal>
  );
}

// ───────── Yeni sürüm (paylaşan) ─────────

function VersionModal({ it, existing, onClose, onDone }: { it: DepotItem; existing: string[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [info, setInfo] = useState<D.DepotInspect | null>(null);
  const [v, setV] = useState({ version: "", changelog: "", mc: it.mc_versions.join(", "), loaders: it.loaders.filter((l) => l !== "vanilla") });
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: tx("Minecraft dosyaları"), extensions: FILE_TYPES }, { name: tx("Tüm dosyalar"), extensions: ["*"] }] });
    if (typeof p !== "string") return;
    setError(null);
    setBusy(tx("Dosya inceleniyor…"));
    try {
      const i = await api.depotInspect(p);
      if (i.kind !== it.kind) throw new Error(tx("Bu dosya bir {0}; \"{1}\" ise {2}. Yeni sürüm aynı türde olmalı.", D.KIND_LABEL[i.kind], it.title, D.KIND_LABEL[it.kind]));
      if (i.sha256 === it.sha256) throw new Error(tx("Bu dosya güncel sürümle aynı."));
      setFile(p);
      setInfo(i);
      setV((x) => ({ ...x, version: x.version || (i.version ?? "").slice(0, 32), mc: i.mcVersions.length ? i.mcVersions.join(", ") : x.mc, loaders: i.loaders.filter((l) => l !== "vanilla").length ? i.loaders.filter((l) => l !== "vanilla") : x.loaders }));
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };
  const dup = existing.includes(v.version.trim());
  const submit = async () => {
    if (!file) return;
    setError(null);
    let up: D.DepotUploaded | null = null;
    try {
      setBusy(tx("Dosya yükleniyor…"));
      up = await api.depotUpload(file);
      setBusy(tx("Yayınlanıyor…"));
      await D.publishVersion(it.id, { version: v.version.trim(), changelog: v.changelog.trim(), mc_versions: v.mc.split(/[,\s]+/).filter(Boolean).slice(0, 30), loaders: it.kind === "world" ? ["vanilla"] : v.loaders }, up);
      onDone();
    } catch (e) {
      if (up) await api.depotDeleteFile(up.filePath).catch(() => {});
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };
  const LOADERS = ["fabric", "quilt", "forge", "neoforge"];
  return (
    <Modal open title={tx("Yeni sürüm: {0}", it.title)} onClose={onClose} width={560}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>{tx("Vazgeç")}</button>
        <button className="btn btn-primary" disabled={!info || !v.version.trim() || dup || !terms || !!busy} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {busy ?? tx("Yayınla")}</button>
      </>}>
      <div className="depot-upload">
        <p className="muted small">{tx("Yeni sürüm yayınlanınca Depo'da güncel sürüm olur; kuranlar tek tıkla güncelleyebilir. Eski sürümler listede kalır.")}</p>
        <button className={clsx("depot-drop", info && "has")} onClick={() => void pick()} disabled={!!busy}>
          {info ? (<>
            <ItemIcon it={{ kind: info.kind, icon_url: null }} size={44} />
            <div className="grow" style={{ textAlign: "left" }}><strong className="truncate">{info.fileName}</strong><span className="muted small">{D.formatSize(info.size)}</span></div>
            <span className="btn btn-ghost btn-sm">{tx("Değiştir")}</span>
          </>) : (<><Upload size={22} /><strong>{tx("Yeni dosyayı seç")}</strong><span className="muted small">{tx("Güncel sürüm: v{0}", it.version || "?")}</span></>)}
        </button>
        {info?.warnings.map((w) => <p key={w} className="depot-warn small"><AlertTriangle size={13} /> {w}</p>)}
        <div className="row" style={{ gap: 12, alignItems: "flex-end" }}>
          <label className="field" style={{ maxWidth: 160 }}>
            <span>{tx("Sürüm numarası")}</span>
            <input className="input" maxLength={32} value={v.version} onChange={(e) => setV({ ...v, version: e.target.value })} placeholder="1.1" />
          </label>
          <label className="field">
            <span>{tx("Minecraft sürümleri")}</span>
            <input className="input" value={v.mc} onChange={(e) => setV({ ...v, mc: e.target.value })} />
          </label>
        </div>
        {dup && <p className="depot-warn small"><AlertTriangle size={13} /> {tx("Bu sürüm numarası zaten var")}</p>}
        {(it.kind === "mod" || it.kind === "modpack") && (
          <div className="bf-chips">
            {LOADERS.map((l) => <button key={l} className={clsx("fchip", v.loaders.includes(l) && "on")} onClick={() => setV({ ...v, loaders: v.loaders.includes(l) ? v.loaders.filter((x) => x !== l) : [...v.loaders, l] })}>{LOADER_LABEL[l]}</button>)}
          </div>
        )}
        <label className="field">
          <span>{tx("Neler değişti?")}</span>
          <textarea className="input" rows={4} maxLength={2000} value={v.changelog} onChange={(e) => setV({ ...v, changelog: e.target.value })} placeholder={tx("Yeni özellikler, düzeltilen hatalar…")} />
        </label>
        <label className="check depot-terms">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>{tx("Bu dosyayı paylaşma hakkım var; virüs ya da zararlı kod içermediğini ve kurallara uyduğunu onaylıyorum. Kurallara aykırı paylaşımlar kaldırılır ve Onaylı yetkim alınabilir.")}</span>
        </label>
        {error && <p className="depot-note err"><AlertTriangle size={14} /> {error}</p>}
      </div>
    </Modal>
  );
}

// ───────── Düzenle (paylaşan) ─────────

function EditModal({ it, onClose, onDone }: { it: DepotItem; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: it.title, summary: it.summary, description: it.description });
  const [gallery, setGallery] = useState<GalItem[]>((it.gallery ?? []).map((g) => ({ url: g.url, preview: g.url, caption: g.caption ?? "" })));
  const [icon, setIcon] = useState<{ url?: string; local?: string; preview: string } | null>(it.icon_url ? { url: it.icon_url, preview: it.icon_url } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickIcon = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: tx("Görsel"), extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof p !== "string") return;
    try { setIcon({ local: p, preview: await api.readImageData(p) }); } catch (e) { setError(err(e)); }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const icon_url = icon ? icon.url ?? (icon.local ? await api.westUpload(icon.local, "depot") : null) : null;
      await D.updateItem(it.id, { title: f.title.trim(), summary: f.summary.trim(), description: f.description.trim(), icon_url, gallery: await D.uploadGallery(gallery) });
      onDone();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={tx("Düzenle: {0}", it.title)} onClose={onClose} width={640}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{tx("Vazgeç")}</button>
        <button className="btn btn-primary" disabled={busy || f.title.trim().length < 3} onClick={() => void save()}>{busy ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {tx("Kaydet")}</button>
      </>}>
      <div className="depot-upload">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <button className="depot-icon-pick" onClick={() => void pickIcon()} title={tx("Simge (isteğe bağlı)")}>
            {icon ? <img src={icon.preview} alt="" /> : <ImagePlus size={20} />}
          </button>
          <label className="field">
            <span>{tx("Başlık")}</span>
            <input className="input" maxLength={60} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </label>
        </div>
        {icon && <button className="btn-link" style={{ marginLeft: 0, alignSelf: "flex-start" }} onClick={() => setIcon(null)}><X size={11} /> {tx("Simgeyi kaldır")}</button>}
        <label className="field">
          <span>{tx("Kısa açıklama")}</span>
          <input className="input" maxLength={200} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </label>
        <label className="field">
          <span>{tx("Ayrıntılı açıklama (Markdown)")}</span>
          <textarea className="input" rows={6} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </label>
        <GalleryEditor items={gallery} onChange={setGallery} onError={setError} />
        {error && <p className="depot-note err"><AlertTriangle size={14} /> {error}</p>}
      </div>
    </Modal>
  );
}

// ───────── Onay başvurusu (üyeler) ─────────

function ApprovalBox({ userId, onChange }: { userId: string; onChange: () => void }) {
  const [req, setReq] = useState<D.RoleRequest | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => D.myRequests(userId).then((r) => setReq(r[0] ?? null)).catch(() => setReq(null)), [userId]);
  useEffect(() => void load(), [load]);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await D.requestApproval(text.trim());
      setOpen(false);
      await load();
      onChange();
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  };
  const pending = req?.status === "pending";
  return (
    <div className="depot-apply">
      <span className="small"><ShieldCheck size={14} /> {tx("Dosya paylaşmak için Onaylı olman gerekir.")}</span>
      {pending ? (
        <span className="muted tiny">{tx("Başvurun inceleniyor ({0}).", date(req!.created_at))}</span>
      ) : (
        <>
          {req?.status === "declined" && <span className="muted tiny">{tx("Son başvurun reddedildi.")}</span>}
          <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><ShieldCheck size={14} /> {tx("Onay iste")}</button>
        </>
      )}
      <Modal open={open} title={tx("Onaylı olmak için başvur")} onClose={() => setOpen(false)}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>{tx("Vazgeç")}</button>
          <button className="btn btn-primary" disabled={busy || text.trim().length < 10} onClick={() => void send()}>{busy ? <Loader2 size={15} className="spin" /> : null} {tx("Gönder")}</button>
        </>}>
        <p className="muted small">{tx("Ne paylaşmak istediğini ve kendini kısaca anlat (ör. yaptığın modlar, kaynak paketleri). Yöneticiler ve moderatörler inceler.")}</p>
        <textarea className="input" rows={5} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("En az 10 karakter")} />
        {error && <p className="depot-note err">{error}</p>}
      </Modal>
    </div>
  );
}

// ───────── Yükleme (Onaylılar) ─────────

const FILE_TYPES = ["jar", "zip", "mrpack", "schem", "schematic", "litematic", "nbt"];

function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (it: DepotItem) => void }) {
  const [file, setFile] = useState<string | null>(null);
  const [info, setInfo] = useState<D.DepotInspect | null>(null);
  const [f, setF] = useState({ title: "", summary: "", description: "", version: "", mc: "", loaders: [] as string[] });
  const [icon, setIcon] = useState<string | null>(null);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalItem[]>([]);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: tx("Minecraft dosyaları"), extensions: FILE_TYPES }, { name: tx("Tüm dosyalar"), extensions: ["*"] }] });
    if (typeof p !== "string") return;
    setError(null);
    setBusy(tx("Dosya inceleniyor…"));
    try {
      const i = await api.depotInspect(p);
      setFile(p);
      setInfo(i);
      setF({ title: (i.title ?? "").slice(0, 60), summary: "", description: "", version: (i.version ?? "").slice(0, 32), mc: i.mcVersions.join(", "), loaders: i.loaders.filter((l) => l !== "vanilla") });
    } catch (e) {
      setError(err(e));
      setFile(null);
      setInfo(null);
    } finally {
      setBusy(null);
    }
  };
  const pickIcon = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: tx("Görsel"), extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (typeof p !== "string") return;
    try {
      setIconPreview(await api.readImageData(p));
      setIcon(p);
    } catch (e) {
      setError(err(e));
    }
  };

  const submit = async () => {
    if (!file || !info) return;
    setError(null);
    let uploaded: D.DepotUploaded | null = null;
    try {
      setBusy(tx("Dosya yükleniyor…"));
      uploaded = await api.depotUpload(file);
      const iconUrl = icon ? (setBusy(tx("Görsel yükleniyor…")), await api.westUpload(icon, "depot")) : null;
      if (gallery.length) setBusy(tx("Fotoğraflar yükleniyor…"));
      const gal = await D.uploadGallery(gallery);
      setBusy(tx("Kaydediliyor…"));
      const mcs = f.mc.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
      const it = await D.createItem({
        kind: uploaded.kind, title: f.title.trim(), summary: f.summary.trim(), description: f.description.trim(), version: f.version.trim(),
        mc_versions: mcs, loaders: uploaded.kind === "world" ? ["vanilla"] : f.loaders, icon_url: iconUrl,
        file_path: uploaded.filePath, file_name: uploaded.fileName, file_size: uploaded.fileSize, sha256: uploaded.sha256, gallery: gal,
      });
      onDone({ ...it });
    } catch (e) {
      // Kayıt oluşmadıysa yüklenen dosya boşta kalmasın
      if (uploaded) await api.depotDeleteFile(uploaded.filePath).catch(() => {});
      setError(err(e));
    } finally {
      setBusy(null);
    }
  };

  const ok = !!info && f.title.trim().length >= 3 && terms && !busy;
  const LOADERS = ["fabric", "quilt", "forge", "neoforge"];
  return (
    <Modal open title={tx("Depo'da paylaş")} onClose={onClose} width={620}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={!!busy}>{tx("Vazgeç")}</button>
        <button className="btn btn-primary" disabled={!ok} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} {busy ?? tx("Paylaş")}</button>
      </>}>
      <div className="depot-upload">
        <button className={clsx("depot-drop", info && "has")} onClick={() => void pick()} disabled={!!busy}>
          {info ? (
            <>
              <ItemIcon it={{ kind: info.kind, icon_url: null }} size={44} />
              <div className="grow" style={{ textAlign: "left" }}>
                <strong className="truncate">{info.fileName}</strong>
                <span className="muted small">{D.KIND_LABEL[info.kind]} · {D.formatSize(info.size)}</span>
              </div>
              <span className="btn btn-ghost btn-sm">{tx("Değiştir")}</span>
            </>
          ) : (
            <>
              <Upload size={22} />
              <strong>{tx("Dosya seç")}</strong>
              <span className="muted small">{tx("Mod (.jar), kaynak paketi / shader / veri paketi / dünya (.zip), modpack (.mrpack), şematik (.schem, .litematic, .nbt) · en fazla 50 MB")}</span>
            </>
          )}
        </button>
        {info?.warnings.map((w) => <p key={w} className="depot-warn small"><AlertTriangle size={13} /> {w}</p>)}
        {info && (
          <>
            <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <button className="depot-icon-pick" onClick={() => void pickIcon()} title={tx("Simge (isteğe bağlı)")}>
                {iconPreview ? <img src={iconPreview} alt="" /> : <ImagePlus size={20} />}
              </button>
              <label className="field">
                <span>{tx("Başlık")}</span>
                <input className="input" maxLength={60} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              </label>
              <label className="field" style={{ maxWidth: 130 }}>
                <span>{tx("Sürüm")}</span>
                <input className="input" maxLength={32} value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} placeholder="1.0" />
              </label>
            </div>
            {icon && <span className="muted tiny row" style={{ gap: 4 }}>{tx("Simge seçildi:")} {icon.split(/[\\/]/).pop()} <button className="btn-link" style={{ marginLeft: 0 }} onClick={() => { setIcon(null); setIconPreview(null); }}><X size={11} /></button></span>}
            <label className="field">
              <span>{tx("Kısa açıklama")}</span>
              <input className="input" maxLength={200} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder={tx("Tek cümlede ne işe yarıyor?")} />
            </label>
            <label className="field">
              <span>{tx("Ayrıntılı açıklama (Markdown)")}</span>
              <textarea className="input" rows={5} maxLength={5000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            </label>
            <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <label className="field">
                <span>{tx("Minecraft sürümleri")}</span>
                <input className="input" value={f.mc} onChange={(e) => setF({ ...f, mc: e.target.value })} placeholder="1.21.11, 26.2" />
              </label>
              {(info.kind === "mod" || info.kind === "modpack") && (
                <div className="field">
                  <span>{tx("Yükleyici")}</span>
                  <div className="bf-chips">
                    {LOADERS.map((l) => (
                      <button key={l} className={clsx("fchip", f.loaders.includes(l) && "on")} onClick={() => setF({ ...f, loaders: f.loaders.includes(l) ? f.loaders.filter((x) => x !== l) : [...f.loaders, l] })}>{LOADER_LABEL[l]}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <GalleryEditor items={gallery} onChange={setGallery} onError={setError} />
            <label className="check depot-terms">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
              <span>{tx("Bu dosyayı paylaşma hakkım var; virüs ya da zararlı kod içermediğini ve kurallara uyduğunu onaylıyorum. Kurallara aykırı paylaşımlar kaldırılır ve Onaylı yetkim alınabilir.")}</span>
            </label>
          </>
        )}
        {error && <p className="depot-note err"><AlertTriangle size={14} /> {error}</p>}
      </div>
    </Modal>
  );
}

// ───────── Yönetim (moderatör, yönetici) ─────────

function ManagePanel({ role, myId, onOpen }: { role: Role; myId: string; onOpen: (it: DepotItem) => void }) {
  const admin = role === "admin";
  const [reqs, setReqs] = useState<(D.RoleRequest & { p?: D.MiniProfile })[] | null>(null);
  const [reports, setReports] = useState<{ item: DepotItem | undefined; list: D.DepotReport[] }[] | null>(null);
  const [removed, setRemoved] = useState<DepotItem[]>([]);
  const [team, setTeam] = useState<D.MiniProfile[]>([]);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<D.MiniProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await D.pendingRequests();
      const ps = await D.profiles(r.map((x) => x.user_id));
      setReqs(r.map((x) => ({ ...x, p: ps.find((p) => p.id === x.user_id) })));
      const rep = await D.openReports();
      const items = await D.itemsByIds(rep.map((x) => x.target_id));
      const by = new Map<string, D.DepotReport[]>();
      rep.forEach((x) => by.set(x.target_id, [...(by.get(x.target_id) ?? []), x]));
      setReports([...by.entries()].map(([id, list]) => ({ item: items.find((i) => i.id === id), list })));
      setRemoved((await D.listItems({ kind: "all", q: "", sort: "new", page: 0, removed: true })).data);
      setTeam(await D.staff());
    } catch (e) {
      setError(err(e));
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = window.setTimeout(() => D.searchUsers(q).then(setFound).catch(() => setFound([])), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const act = async (f: () => Promise<unknown>) => {
    setError(null);
    try { await f(); await load(); } catch (e) { setError(err(e)); }
  };
  const roleChoices = (target: D.MiniProfile): Role[] => (admin ? D.ROLES : D.roleRank(target.role) >= 2 ? [] : ["member", "approved"]);
  const userRow = (p: D.MiniProfile) => (
    <div key={p.id} className="depot-user">
      {p.avatar_url ? <img src={p.avatar_url} alt="" /> : <span className="depot-author-ph">{(p.display_name || p.username)[0]?.toUpperCase()}</span>}
      <div className="grow">
        <strong className="truncate">{p.display_name || p.username}</strong>
        <span className="muted tiny">@{p.username}</span>
      </div>
      <RoleBadge role={p.role} showMember />
      {p.id !== myId && roleChoices(p).length > 0 && (
        <select className="bf-select" value={p.role} onChange={(e) => {
          const r = e.target.value as Role;
          void (async () => {
            if (!(await askConfirm(tx("{0} kullanıcısının yetkisi \"{1}\" olsun mu?", p.username, D.ROLE_LABEL[r]), { danger: D.roleRank(r) < D.roleRank(p.role) }))) return;
            await act(() => D.setRole(p.id, r));
            setFound((fs) => fs.map((x) => (x.id === p.id ? { ...x, role: r } : x)));
          })();
        }}>
          {roleChoices(p).map((r) => <option key={r} value={r}>{D.ROLE_LABEL[r]}</option>)}
        </select>
      )}
    </div>
  );

  return (
    <div className="depot-manage">
      {error && <p className="depot-note err"><AlertTriangle size={14} /> {error}</p>}
      <section className="card depot-sec">
        <h3><ShieldCheck size={16} /> {tx("Onay başvuruları")} {reqs && reqs.length > 0 && <span className="nav-badge static">{reqs.length}</span>}</h3>
        {!reqs ? <p className="muted small"><Loader2 size={13} className="spin" /> {tx("Yükleniyor…")}</p> : reqs.length === 0 ? <p className="muted small">{tx("Bekleyen başvuru yok.")}</p> : reqs.map((r) => (
          <div key={r.id} className="depot-req">
            <div className="grow">
              <strong>{r.p?.display_name || r.p?.username || r.user_id.slice(0, 8)}</strong> <span className="muted tiny">@{r.p?.username} · {date(r.created_at)}</span>
              <p className="small">{r.message}</p>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void act(() => D.answerRequest(r.id, true))}><Check size={14} /> {tx("Onayla")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => void act(() => D.answerRequest(r.id, false))}><X size={14} /> {tx("Reddet")}</button>
          </div>
        ))}
      </section>

      <section className="card depot-sec">
        <h3><Flag size={16} /> {tx("Şikâyet edilen dosyalar")}</h3>
        {!reports ? null : reports.length === 0 ? <p className="muted small">{tx("Açık şikâyet yok.")}</p> : reports.map(({ item, list }) => (
          <div key={list[0].target_id} className="depot-req">
            {item && <ItemIcon it={item} size={36} />}
            <div className="grow">
              <strong>{item?.title ?? tx("Silinmiş dosya")}</strong> {item && <RoleBadge role={item.author_role} size="xs" />} <span className="muted tiny">{tx("{0} şikâyet", list.length)}</span>
              {list.slice(0, 3).map((x) => <p key={x.id} className="small muted">“{x.reason}”</p>)}
            </div>
            {item && <button className="btn btn-ghost btn-sm" onClick={() => onOpen(item)}>{tx("Aç")}</button>}
            {item && !item.removed && <button className="btn btn-danger btn-sm" onClick={() => void act(async () => { await D.moderate(item.id, true, list[0].reason); await D.resolveReports(item.id); })}><Gavel size={14} /> {tx("Kaldır")}</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => void act(() => D.resolveReports(list[0].target_id))}>{tx("Çözüldü")}</button>
          </div>
        ))}
      </section>

      <section className="card depot-sec">
        <h3><UserCog size={16} /> {tx("Yetkiler")}</h3>
        <p className="muted tiny">{admin
          ? tx("Yönetici olarak herkese her yetkiyi verebilirsin (kendi yetkin hariç).")
          : tx("Moderatör olarak Üye ve Onaylı arasında değişiklik yapabilirsin; Moderatör ve Yönetici atamayı yalnızca yöneticiler yapar.")}</p>
        <div className="search" style={{ width: "100%" }}><Search size={15} /><input className="input" placeholder={tx("Kullanıcı ara")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {found.map(userRow)}
        <h4 className="muted small" style={{ marginTop: 10 }}>{tx("Ekip ve Onaylılar")}</h4>
        {team.length === 0 ? <p className="muted small">{tx("Henüz kimse yok.")}</p> : team.map(userRow)}
      </section>

      {removed.length > 0 && (
        <section className="card depot-sec">
          <h3><Trash2 size={16} /> {tx("Kaldırılan dosyalar")}</h3>
          {removed.map((it) => (
            <div key={it.id} className="depot-req">
              <ItemIcon it={it} size={36} />
              <div className="grow"><strong>{it.title}</strong> <span className="muted tiny">@{it.username}{it.removed_reason ? ` · “${it.removed_reason}”` : ""}</span></div>
              <button className="btn btn-ghost btn-sm" onClick={() => void act(() => D.moderate(it.id, false, null))}><RotateCcw size={14} /> {tx("Geri yükle")}</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
