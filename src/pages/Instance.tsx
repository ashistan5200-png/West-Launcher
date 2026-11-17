import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Paintbrush, Pencil, Boxes, Clock, Copy, FileText, FolderOpen, Globe2, LayoutTemplate, Loader2, MoreVertical, Play, Settings2, Share2, Square, Tag, Timer, Trash2, Folder, Truck } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAshi, useHuntRunning } from "@/stores/ashi";
import { InstanceIcon } from "@/components/InstanceIcon";
import { InstanceBanner } from "@/components/InstanceBanner";
import { AppearanceModal } from "@/components/AppearanceModal";
import { Modal } from "@/components/Modal";
import { ContentTab } from "@/components/instance/ContentTab";
import { FilesTab, LogsTab, ShareTab, WorldsTab } from "@/components/instance/OtherTabs";
import { Menu } from "@/components/instance/Menu";
import { AshiPorter } from "@/components/instance/AshiPorter";
import { api } from "@/lib/ipc";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import type { CompanionConfig, CompanionInfo, Instance, JvmProfile, LoaderKind, LoaderVersion, ManifestEntry } from "@/lib/types";
import { askConfirm } from "@/components/ConfirmDialog";
import { tx } from "@/lib/i18n";

type Tab = "content" | "files" | "worlds" | "logs" | "share" | "settings";
const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: "content", label: tx("İçerik"), icon: Boxes },
  { id: "files", label: tx("Dosyalar"), icon: Folder },
  { id: "worlds", label: tx("Dünyalar"), icon: Globe2 },
  { id: "logs", label: tx("Loglar"), icon: FileText },
  { id: "share", label: tx("Paylaş"), icon: Share2 },
];

export function InstancePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { instances, running, launching, logs, lastExit, launch, kill, remove, clone, refresh } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const inst = instances.find((i) => i.id === id);
  const hunting = useHuntRunning(id);
  const openAshi = useAshi((s) => s.openConfirm);
  const [tab, setTab] = useState<Tab>("content");
  const [cloneOpen, setCloneOpen] = useState(false);
  const [appearOpen, setAppearOpen] = useState(false);
  const [portOpen, setPortOpen] = useState(false);

  if (!inst) return <p className="muted pad">{tx("Instance bulunamadı.")}</p>;

  const isRunning = running[id] !== undefined;
  const isLaunching = !!launching[id];
  const exit = lastExit[id];
  const locked = isRunning || isLaunching || hunting;
  const del = async () => {
    if (await askConfirm(tx("\"{0}\" ve tüm dünyaları silinsin mi?", inst.name))) {
      await remove(id);
      navigate("/library");
    }
  };

  return (
    <div className="stack ipage">
      <header className="ihead">
        <InstanceBanner instance={inst} className="ihead-art" wide />
        <div className="ihead-shade" />
        <button className="ihead-edit" onClick={() => setAppearOpen(true)} title={tx("Profil fotoğrafı, banner ve ad")}><Pencil size={14} /> {tx("Görünümü düzenle")}</button>
        <InstanceIcon instance={inst} size={76} />
        <div className="grow ihead-text">
          <h1 className="truncate">{inst.name}</h1>
          <div className="ihead-line">
            <span><Tag size={16} /> {LOADER_LABEL[inst.loader.kind]} {inst.mcVersion}</span>
            <span className="dot" />
            <span><Timer size={16} /> {formatDuration(inst.totalPlaySecs)}</span>
            {inst.importedFrom && <><span className="dot" /><span>↳ {inst.importedFrom}</span></>}
          </div>
          <div className="ihead-line">
            <span><Clock size={16} /> {inst.lastPlayed ? tx("Son oynama: {0}", formatRelative(inst.lastPlayed).toLowerCase()) : tx("Hiç oynanmadı")}</span>
          </div>
        </div>
        <div className="ihead-actions">
          <button
            className={clsx("btn ihead-play", isRunning ? "btn-danger" : "btn-primary")}
            disabled={isLaunching || hunting}
            title={hunting ? tx("Ashi bu instance'ta suçlu avında") : undefined}
            onClick={() => (isRunning ? kill(id) : launch(id, offlineName))}
          >
            {isLaunching ? <Loader2 size={20} className="spin" /> : isRunning ? <Square size={17} fill="currentColor" /> : <Play size={20} />}
            {hunting ? tx("Ashi avda") : isRunning ? tx("Durdur") : tx("Oyna")}
          </button>
          <button className={clsx("round-btn", tab === "settings" && "on")} title={tx("Instance ayarları")} onClick={() => setTab(tab === "settings" ? "content" : "settings")}>
            <Settings2 size={20} />
          </button>
          <Menu
            trigger={() => <button className="icon-btn" aria-label={tx("Daha fazla")}><MoreVertical size={20} /></button>}
            items={[
              { label: tx("Görünümü düzenle"), icon: <Paintbrush size={14} />, onClick: () => setAppearOpen(true) },
              { label: tx("Klasörü aç"), icon: <FolderOpen size={14} />, onClick: async () => api.openPath(await api.instancePath(id)) },
              { label: tx("Ashi Taşıyıcı: başka sürüme taşı"), icon: <Truck size={14} />, disabled: locked, onClick: () => setPortOpen(true) },
              { label: tx("Klonla"), icon: <Copy size={14} />, onClick: () => setCloneOpen(true) },
              { label: tx("Şablon oluştur"), icon: <LayoutTemplate size={14} />, onClick: async () => { await api.makeTemplate(id, `${inst.name} şablonu`); await refresh(); } },
              { label: tx("Instance'ı sil"), icon: <Trash2 size={14} />, danger: true, disabled: locked, onClick: () => void del() },
            ]}
          />
        </div>
      </header>

      {exit?.crashed && !exit.duringHunt && !isRunning && !hunting && (
        <div className="banner banner-error row">
          <span className="grow">{tx("Oyun")} {exit.code} {tx("çıkış koduyla çöktü.")}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setTab("logs")}>{tx("Logları gör")}</button>
          {exit.modCount >= 2 && (
            <button className="btn btn-sm btn-ghost" onClick={() => openAshi(id, inst.name)}>
              {tx("Ashi'den suçluyu bulmasını iste")}
            </button>
          )}
        </div>
      )}

      <nav className="pill-tabs" role="tablist">
        {TABS.map(({ id: t, label, icon: Icon }) => (
          <button key={t} role="tab" aria-selected={tab === t} className={clsx("pill-tab", tab === t && "on")} onClick={() => setTab(t)}>
            <Icon size={18} /> {label}
          </button>
        ))}
      </nav>

      {tab === "content" && <ContentTab instanceId={id} locked={locked} />}
      {tab === "files" && <FilesTab instanceId={id} />}
      {tab === "worlds" && <WorldsTab instanceId={id} locked={locked} />}
      {tab === "logs" && <LogsTab instanceId={id} live={logs[id] ?? []} />}
      {tab === "share" && <ShareTab instance={inst} />}
      {tab === "settings" && <InstanceSettings instance={inst} onDelete={() => void del()} />}

      <AppearanceModal instance={inst} open={appearOpen} onClose={() => setAppearOpen(false)} />
      <AshiPorter instance={inst} open={portOpen} onClose={() => setPortOpen(false)} />
      <CloneModal open={cloneOpen} onClose={() => setCloneOpen(false)} name={inst.name} onConfirm={(n, w) => clone(id, n, w)} />
    </div>
  );
}

function InstanceSettings({ instance, onDelete }: { instance: Instance; onDelete: () => void }) {
  const refresh = useInstances((s) => s.refresh);
  const [draft, setDraft] = useState(instance);
  const [jvm, setJvm] = useState<JvmProfile | null>(null);
  const [maxMem, setMaxMem] = useState(16384);

  useEffect(() => setDraft(instance), [instance]);
  useEffect(() => {
    api.getHardware().then((h) => setMaxMem(Math.floor((h.totalMemoryMb * 0.8) / 256) * 256)).catch(() => {});
    const [, minor = 0, patch = 0] = instance.mcVersion.split(".").map((n) => parseInt(n, 10) || 0);
    const major = minor > 20 || (minor === 20 && patch >= 5) ? 21 : minor >= 17 ? 17 : 8;
    api.previewJvm(instance.id, major).then(setJvm).catch(() => setJvm(null));
  }, [instance.id, instance.mcVersion, instance.memoryMb]);

  const save = async () => {
    await api.updateInstance(draft);
    await refresh();
  };

  return (
    <div className="settings-grid">
      <section className="card stack">
        <h3>{tx("Genel")}</h3>
        <label className="field">
          <span>{tx("Ad")}</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>{tx("Bellek")} {draft.memoryMb ? `${draft.memoryMb} MB` : "(otomatik)"}</span>
          <input
            type="range" min={1024} max={maxMem} step={256}
            value={draft.memoryMb ?? jvm?.memoryMb ?? 4096}
            onChange={(e) => setDraft({ ...draft, memoryMb: Number(e.target.value) })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.memoryMb === null} onChange={(e) => setDraft({ ...draft, memoryMb: e.target.checked ? null : 4096 })} />
          {tx("Donanıma ve mod sayısına göre otomatik ayarla")}
        </label>
        <label className="field">
          <span>{tx("Java yolu (boş = otomatik)")}</span>
          <input value={draft.javaPath ?? ""} placeholder={tx("Otomatik seçim")} onChange={(e) => setDraft({ ...draft, javaPath: e.target.value || null })} />
        </label>
        <label className="field">
          <span>{tx("Ek JVM argümanları")}</span>
          <input
            value={draft.extraJvmArgs.join(" ")}
            onChange={(e) => setDraft({ ...draft, extraJvmArgs: e.target.value.split(/\s+/).filter(Boolean) })}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={save}>{tx("Kaydet")}</button>
          <button className="btn btn-danger-ghost" onClick={onDelete}><Trash2 size={15} /> {tx("Sil")}</button>
        </div>
      </section>

      <VersionCard instance={instance} />

      <CompanionCard instanceId={instance.id} />

      <section className="card stack">
        <h3>{tx("JVM Optimizatörü")}</h3>
        {jvm ? (
          <>
            <p className="small">{jvm.reason}</p>
            <div className="flag-list">{jvm.flags.map((f) => <code key={f}>{f}</code>)}</div>
          </>
        ) : (
          <p className="muted small">{tx("Önizleme yükleniyor…")}</p>
        )}
      </section>
    </div>
  );
}

function CloneModal({ open, onClose, name, onConfirm }: { open: boolean; onClose: () => void; name: string; onConfirm: (n: string, worlds: boolean) => Promise<void> }) {
  const [n, setN] = useState(`${name} (kopya)`);
  const [worlds, setWorlds] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx("Instance'ı klonla")}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>{tx("İptal")}</button>
          <button className="btn btn-primary" onClick={async () => { await onConfirm(n, worlds); onClose(); }}>{tx("Klonla")}</button>
        </>
      }
    >
      <label className="field"><span>{tx("Yeni ad")}</span><input value={n} onChange={(e) => setN(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={worlds} onChange={(e) => setWorlds(e.target.checked)} /> {tx("Dünyaları da kopyala")}</label>
    </Modal>
  );
}

/** West Companion oyun içi mod ayarları — oyun açıkken bile ~2 sn içinde uygulanır. */
function CompanionCard({ instanceId }: { instanceId: string }) {
  const [info, setInfo] = useState<CompanionInfo | null>(null);
  useEffect(() => {
    api.getCompanion(instanceId).then(setInfo).catch(() => setInfo(null));
  }, [instanceId]);
  if (!info) return null;
  const set = (patch: Partial<CompanionConfig>) => {
    const config = { ...info.config, ...patch };
    setInfo({ ...info, config });
    void api.setCompanionConfig(instanceId, config);
  };
  const c = info.config;
  return (
    <section className="card stack">
      <h3>{tx("West Companion")} <span className="muted tiny">{tx("oyun içi")}</span></h3>
      {!info.compatible ? (
        <p className="muted small">{tx("West Companion şimdilik Fabric 26.2, Fabric 1.21.11 ve 1.21.1 (Fabric/NeoForge) instance'larında çalışır. Diğer sürümler sırayla ekleniyor.")}</p>
      ) : !info.enabled ? (
        <p className="muted small">{tx("Ayarlar'dan \"West Companion\" kapatılmış.")}</p>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={c.fullbright} onChange={(e) => set({ fullbright: e.target.checked })} /> {tx("FullBright (her yer aydınlık)")}</label>
          <label className="check"><input type="checkbox" checked={c.fpsOverlay} onChange={(e) => set({ fpsOverlay: e.target.checked })} /> {tx("FPS göstergesi")}</label>
          <p className="muted tiny">{tx("Oyunda")} <kbd>{tx("Sağ Shift")}</kbd> {tx("West menüsünü açar: HUD öğeleri (CPS, tuş göstergesi, koordinatlar, pusula, zırh…), sürükle-bırak HUD düzenleyici, temalar. Oyundan çıkmadan, oyunun içinde.")}</p>
        </>
      )}
    </section>
  );
}

/** Minecraft ve yükleyici sürümünü değiştirme. Kaydedince oyun bir sonraki açılışta yeni sürümü kurar. */
function VersionCard({ instance }: { instance: Instance }) {
  const refresh = useInstances((s) => s.refresh);
  const running = useInstances((s) => s.running[instance.id] !== undefined);
  const [snapshots, setSnapshots] = useState(false);
  const [mcList, setMcList] = useState<ManifestEntry[]>([]);
  const [mc, setMc] = useState(instance.mcVersion);
  const [kind, setKind] = useState<LoaderKind>(instance.loader.kind);
  const [loaderList, setLoaderList] = useState<LoaderVersion[] | null>(null);
  const [lv, setLv] = useState<string | null>(instance.loader.version);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMc(instance.mcVersion); setKind(instance.loader.kind); setLv(instance.loader.version); }, [instance]);
  useEffect(() => { api.listMcVersions(snapshots).then(setMcList).catch(() => setMcList([])); }, [snapshots]);
  useEffect(() => {
    if (kind === "vanilla") { setLoaderList([]); setLv(null); return; }
    setLoaderList(null);
    api.listLoaderVersions(kind, mc).then((l) => {
      setLoaderList(l);
      // Seçili sürüm bu listede yoksa en son kararlı sürümü öner
      setLv((cur) => (cur && l.some((x) => x.version === cur) ? cur : (l.find((x) => x.stable) ?? l[0])?.version ?? null));
    }).catch(() => setLoaderList([]));
  }, [kind, mc]);

  const changed = mc !== instance.mcVersion || kind !== instance.loader.kind || (lv ?? null) !== (instance.loader.version ?? null);
  const loaderMissing = kind !== "vanilla" && (!lv || (loaderList !== null && loaderList.length === 0));

  const save = async () => {
    const mcChanged = mc !== instance.mcVersion || kind !== instance.loader.kind;
    if (mcChanged && !await askConfirm(tx("Sürüm {0} {1} → {2} {3} olarak değişecek.\n\nBazı modlar yeni sürümle uyumsuz olabilir. Önemli dünyaların varsa önce yedek al. Devam edilsin mi?", LOADER_LABEL[instance.loader.kind], instance.mcVersion, LOADER_LABEL[kind], mc))) return;
    setBusy(true);
    try {
      await api.updateInstance({ ...instance, mcVersion: mc, loader: { kind, version: kind === "vanilla" ? null : lv } });
      await refresh();
      setMsg({ ok: true, text: mcChanged ? tx("Sürüm değişti. İçerik sekmesinde \"Tümünü güncelle\" ile modları yeni sürüme uygun hale getir; oyun ilk açılışta yeni sürümü indirir.") : tx("Yükleyici sürümü değişti; ilk açılışta indirilecek.") });
    } catch (e) { setMsg({ ok: false, text: String(e).replace(/^Error: /, "") }); } finally { setBusy(false); }
  };

  const releases = mcList.filter((v) => snapshots || v.type === "release");
  return (
    <section className="card stack">
      <h3>{tx("Sürüm")}</h3>
      <label className="field">
        <span>{tx("Minecraft sürümü")}</span>
        <select value={mc} onChange={(e) => setMc(e.target.value)} disabled={running}>
          {!releases.some((v) => v.id === mc) && <option value={mc}>{mc}</option>}
          {releases.map((v) => <option key={v.id} value={v.id}>{v.id}{v.type !== "release" ? " (snapshot)" : ""}</option>)}
        </select>
      </label>
      <label className="check tiny"><input type="checkbox" checked={snapshots} onChange={(e) => setSnapshots(e.target.checked)} /> {tx("Snapshot'ları göster")}</label>
      <div className="field">
        <span>{tx("Yükleyici")}</span>
        <div className="segmented wrap">
          {(["vanilla", "fabric", "quilt", "forge", "neoforge"] as LoaderKind[]).map((k) => (
            <button key={k} className={clsx(kind === k && "active")} disabled={running} onClick={() => setKind(k)}>{LOADER_LABEL[k]}</button>
          ))}
        </div>
      </div>
      {kind !== "vanilla" && (
        <label className="field">
          <span>{LOADER_LABEL[kind]} {tx("sürümü")}</span>
          {loaderList === null ? <span className="muted small"><Loader2 size={13} className="spin" /> {tx("Sürümler yükleniyor…")}</span>
            : loaderList.length === 0 ? <span className="hint error">{LOADER_LABEL[kind]}{tx(", Minecraft")} {mc} {tx("için mevcut değil.")}</span>
            : (
              <select value={lv ?? ""} onChange={(e) => setLv(e.target.value)} disabled={running}>
                {loaderList.map((v) => <option key={v.version} value={v.version}>{v.version}{v.stable ? "" : " (beta)"}</option>)}
              </select>
            )}
        </label>
      )}
      {running && <p className="muted tiny">{tx("Oyun açıkken sürüm değiştirilemez.")}</p>}
      <p className="muted tiny">{tx("Modlarınla birlikte başka sürüme geçmek mi istiyorsun? Üstteki ⋮ menüsünden")} <strong>{tx("Ashi Taşıyıcı")}</strong>{tx("'yı kullan: her modun yeni sürümünü bulur ve eski instance'a dokunmaz.")}</p>
      {msg && <p className={clsx("hint", !msg.ok && "error")}>{msg.text}</p>}
      <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={!changed || loaderMissing || busy || running} onClick={() => void save()}>
        {busy && <Loader2 size={15} className="spin" />} {tx("Sürümü değiştir")}
      </button>
    </section>
  );
}
