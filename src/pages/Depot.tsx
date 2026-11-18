import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
  AlertTriangle, Box, Check, Download, FileArchive, Flag, FolderOpen, Gavel, Globe2, ImagePlus, Layers, Loader2, Package, Palette, Plus,
  RotateCcw, Search, Shapes, ShieldCheck, Sparkles, Trash2, Upload, UserCog, X,
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
    <button className={clsx("depot-card", it.removed && "removed")} onClick={onOpen}>
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

// ───────── Ayrıntı ve kurulum ─────────

function ItemModal({ it, role, myId, onClose, onChanged }: { it: DepotItem; role: Role | null; myId: string | null; onClose: () => void; onChanged: () => void }) {
  const navigate = useNavigate();
  const instances = useInstances((s) => s.instances).filter((i) => !i.isTemplate);
  const [target, setTarget] = useState<string>("");
  const [worlds, setWorlds] = useState<string[]>([]);
  const [world, setWorld] = useState("");
  const [warn, setWarn] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; place: string; warnings: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const html = useMemo(() => markdownToHtml(it.description || ""), [it.description]);
  const mine = it.author_id === myId;
  const staff = D.roleRank(role) >= 2;
  const toInstance = D.needsInstance(it.kind);
  const { askText, node: askNode } = useAskText();

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

  const install = async () => {
    setWarn(false);
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.depotInstall(it.id, toInstance ? target || null : null, it.kind === "datapack" ? world || null : null);
      setDone({ ...r.installed, warnings: r.warnings });
    } catch (e) {
      setMsg(err(e));
    } finally {
      setBusy(false);
    }
  };

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

  const tgt = instances.find((i) => i.id === target);
  const blocked = toInstance && (!tgt || !!why(tgt) || (it.kind === "datapack" && !world));

  return (
    <Modal open title={it.title} onClose={onClose} width={720}>
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

        <div className="depot-facts">
          <div><span className="muted tiny">{tx("Dosya")}</span><strong className="truncate" title={it.file_name}>{it.file_name}</strong></div>
          <div><span className="muted tiny">{tx("Boyut")}</span><strong>{D.formatSize(it.file_size)}</strong></div>
          <div><span className="muted tiny">{tx("İndirme")}</span><strong>{formatCount(it.downloads)}</strong></div>
          <div><span className="muted tiny">{tx("Paylaşıldı")}</span><strong>{date(it.created_at)}</strong></div>
          <div className="wide"><span className="muted tiny">SHA-256</span><code className="depot-hash" title={it.sha256}>{it.sha256}</code></div>
        </div>

        {it.description && <div className="md depot-desc" dangerouslySetInnerHTML={{ __html: html }} />}

        <section className="depot-install">
          {done ? (
            <div className="depot-done">
              <Check size={18} />
              <div className="grow">
                <strong>{tx("Kuruldu")}</strong>
                <span className="muted small">{done.place}</span>
                {done.warnings.map((w) => <span key={w} className="depot-warn small"><AlertTriangle size={12} /> {w}</span>)}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => void api.openPath(done.path, true)}><FolderOpen size={14} /> {tx("Klasörde göster")}</button>
            </div>
          ) : (
            <>
              <div className="depot-target">
                {toInstance ? (
                  <>
                    <span className="muted small">{tx("Kurulacağı yer:")} <code>{D.KIND_PLACE[it.kind]}</code></span>
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
                ) : (
                  <span className="muted small">{tx("Bu dosya İndirilenler klasörüne kaydedilir.")}</span>
                )}
              </div>
              <button className="btn btn-primary" disabled={busy || blocked || (it.removed && !staff && !mine)} onClick={() => { setAgree(false); setWarn(true); }}>
                {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />} {toInstance ? tx("Kur") : tx("İndir")}
              </button>
            </>
          )}
        </section>

        {msg && <p className="depot-note">{msg}</p>}

        <footer className="depot-detail-foot">
          {!mine && <button className="btn btn-ghost btn-sm" onClick={() => void doReport()}><Flag size={14} /> {tx("Şikâyet et")}</button>}
          <span className="grow" />
          {(mine || staff) && (
            <button className={clsx("btn btn-sm", mine || !it.removed ? "btn-danger" : "btn-ghost")} onClick={() => void remove()}>
              {mine ? <><Trash2 size={14} /> {tx("Sil")}</> : it.removed ? <><RotateCcw size={14} /> {tx("Geri yükle")}</> : <><Gavel size={14} /> {tx("Kaldır")}</>}
            </button>
          )}
        </footer>
      </div>

      <Modal open={warn} title={tx("İndirmeden önce")} onClose={() => setWarn(false)} width={480}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setWarn(false)}>{tx("Vazgeç")}</button>
          <button className="btn btn-primary" disabled={!agree} onClick={() => void install()}><Download size={15} /> {tx("Anladım, kur")}</button>
        </>}>
        <div className="depot-disclaimer">
          <AlertTriangle size={28} />
          <p>{tx("Depo'daki dosyaları West Client değil, topluluk üyeleri paylaşır. Yalnızca Onaylı kişiler dosya yükleyebilir ve dosyanın türü yüklenirken denetlenir; ancak içerikler virüs ya da zararlı yazılıma karşı taranmaz.")}</p>
          <p><strong>{tx("West Client, Depo'dan indirilen dosyaların yol açabileceği virüs, veri kaybı ya da başka zararlardan sorumlu değildir.")}</strong> {tx("Yalnızca güvendiğin kişilerin dosyalarını kur; şüpheli bir şey görürsen şikâyet et.")}</p>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {tx("Okudum; bu dosyayı kendi sorumluluğumda kuruyorum.")}</label>
        </div>
      </Modal>
      {askNode}
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
      setBusy(tx("Kaydediliyor…"));
      const mcs = f.mc.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
      const it = await D.createItem({
        kind: uploaded.kind, title: f.title.trim(), summary: f.summary.trim(), description: f.description.trim(), version: f.version.trim(),
        mc_versions: mcs, loaders: uploaded.kind === "world" ? ["vanilla"] : f.loaders, icon_url: iconUrl,
        file_path: uploaded.filePath, file_name: uploaded.fileName, file_size: uploaded.fileSize, sha256: uploaded.sha256,
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
