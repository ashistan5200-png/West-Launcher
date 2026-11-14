import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { Boxes, Clock, Copy, FileText, FolderOpen, Globe2, LayoutTemplate, Loader2, MoreVertical, Play, Settings2, Share2, Square, Tag, Timer, Trash2, Folder } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAshi, useHuntRunning } from "@/stores/ashi";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Modal } from "@/components/Modal";
import { ContentTab } from "@/components/instance/ContentTab";
import { FilesTab, LogsTab, ShareTab, WorldsTab } from "@/components/instance/OtherTabs";
import { Menu } from "@/components/instance/Menu";
import { api } from "@/lib/ipc";
import { LOADER_LABEL, formatDuration, formatRelative } from "@/lib/format";
import type { CompanionConfig, CompanionInfo, Instance, JvmProfile } from "@/lib/types";

type Tab = "content" | "files" | "worlds" | "logs" | "share" | "settings";
const TABS: { id: Tab; label: string; icon: typeof Boxes }[] = [
  { id: "content", label: "İçerik", icon: Boxes },
  { id: "files", label: "Dosyalar", icon: Folder },
  { id: "worlds", label: "Dünyalar", icon: Globe2 },
  { id: "logs", label: "Loglar", icon: FileText },
  { id: "share", label: "Paylaş", icon: Share2 },
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

  if (!inst) return <p className="muted pad">Instance bulunamadı.</p>;

  const isRunning = running[id] !== undefined;
  const isLaunching = !!launching[id];
  const exit = lastExit[id];
  const locked = isRunning || isLaunching || hunting;
  const del = async () => {
    if (confirm(`"${inst.name}" ve tüm dünyaları silinsin mi?`)) {
      await remove(id);
      navigate("/library");
    }
  };

  return (
    <div className="stack ipage">
      <header className="ihead">
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
            <span><Clock size={16} /> {inst.lastPlayed ? `Son oynama: ${formatRelative(inst.lastPlayed).toLowerCase()}` : "Hiç oynanmadı"}</span>
          </div>
        </div>
        <div className="ihead-actions">
          <button
            className={clsx("btn ihead-play", isRunning ? "btn-danger" : "btn-primary")}
            disabled={isLaunching || hunting}
            title={hunting ? "Ashi bu instance'ta suçlu avında" : undefined}
            onClick={() => (isRunning ? kill(id) : launch(id, offlineName))}
          >
            {isLaunching ? <Loader2 size={20} className="spin" /> : isRunning ? <Square size={17} fill="currentColor" /> : <Play size={20} />}
            {hunting ? "Ashi avda" : isRunning ? "Durdur" : "Oyna"}
          </button>
          <button className={clsx("round-btn", tab === "settings" && "on")} title="Instance ayarları" onClick={() => setTab(tab === "settings" ? "content" : "settings")}>
            <Settings2 size={20} />
          </button>
          <Menu
            trigger={() => <button className="icon-btn" aria-label="Daha fazla"><MoreVertical size={20} /></button>}
            items={[
              { label: "Klasörü aç", icon: <FolderOpen size={14} />, onClick: async () => openPath(await api.instancePath(id)) },
              { label: "Klonla", icon: <Copy size={14} />, onClick: () => setCloneOpen(true) },
              { label: "Şablon oluştur", icon: <LayoutTemplate size={14} />, onClick: async () => { await api.makeTemplate(id, `${inst.name} şablonu`); await refresh(); } },
              { label: "Instance'ı sil", icon: <Trash2 size={14} />, danger: true, disabled: locked, onClick: () => void del() },
            ]}
          />
        </div>
      </header>

      {exit?.crashed && !exit.duringHunt && !isRunning && !hunting && (
        <div className="banner banner-error row">
          <span className="grow">Oyun {exit.code} çıkış koduyla çöktü.</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setTab("logs")}>Logları gör</button>
          {exit.modCount >= 2 && (
            <button className="btn btn-sm btn-ghost" onClick={() => openAshi(id, inst.name)}>
              Ashi'den suçluyu bulmasını iste
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
        <h3>Genel</h3>
        <label className="field">
          <span>Ad</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>Bellek {draft.memoryMb ? `${draft.memoryMb} MB` : "(otomatik)"}</span>
          <input
            type="range" min={1024} max={maxMem} step={256}
            value={draft.memoryMb ?? jvm?.memoryMb ?? 4096}
            onChange={(e) => setDraft({ ...draft, memoryMb: Number(e.target.value) })}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.memoryMb === null} onChange={(e) => setDraft({ ...draft, memoryMb: e.target.checked ? null : 4096 })} />
          Donanıma ve mod sayısına göre otomatik ayarla
        </label>
        <label className="field">
          <span>Java yolu (boş = otomatik)</span>
          <input value={draft.javaPath ?? ""} placeholder="Otomatik seçim" onChange={(e) => setDraft({ ...draft, javaPath: e.target.value || null })} />
        </label>
        <label className="field">
          <span>Ek JVM argümanları</span>
          <input
            value={draft.extraJvmArgs.join(" ")}
            onChange={(e) => setDraft({ ...draft, extraJvmArgs: e.target.value.split(/\s+/).filter(Boolean) })}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={save}>Kaydet</button>
          <button className="btn btn-danger-ghost" onClick={onDelete}><Trash2 size={15} /> Sil</button>
        </div>
      </section>

      <CompanionCard instanceId={instance.id} />

      <section className="card stack">
        <h3>JVM Optimizatörü</h3>
        {jvm ? (
          <>
            <p className="small">{jvm.reason}</p>
            <div className="flag-list">{jvm.flags.map((f) => <code key={f}>{f}</code>)}</div>
          </>
        ) : (
          <p className="muted small">Önizleme yükleniyor…</p>
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
      title="Instance'ı klonla"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>İptal</button>
          <button className="btn btn-primary" onClick={async () => { await onConfirm(n, worlds); onClose(); }}>Klonla</button>
        </>
      }
    >
      <label className="field"><span>Yeni ad</span><input value={n} onChange={(e) => setN(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={worlds} onChange={(e) => setWorlds(e.target.checked)} /> Dünyaları da kopyala</label>
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
      <h3>West Companion <span className="muted tiny">oyun içi</span></h3>
      {!info.compatible ? (
        <p className="muted small">Oyun içi West menüsü ve paneli şimdilik Minecraft 1.21.1 + Fabric/NeoForge instance'larında çalışır.</p>
      ) : !info.enabled ? (
        <p className="muted small">Ayarlar'dan "West Companion" kapatılmış.</p>
      ) : (
        <>
          <label className="check"><input type="checkbox" checked={c.fullbright} onChange={(e) => set({ fullbright: e.target.checked })} /> FullBright (her yer aydınlık)</label>
          <label className="check"><input type="checkbox" checked={c.fpsOverlay} onChange={(e) => set({ fpsOverlay: e.target.checked })} /> FPS / MS / bellek göstergesi</label>
          <div className="field">
            <span>Ana menü</span>
            <div className="segmented">
              {(["auto", "button", "off"] as const).map((m) => (
                <button key={m} className={clsx(c.menuMode === m && "active")} onClick={() => set({ menuMode: m })}>
                  {m === "auto" ? "West menüsü" : m === "button" ? "Sadece düğme" : "Kapalı"}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span>Menüdeki karakter pozu</span>
            <div className="segmented">
              {(["hero", "wave", "idle"] as const).map((m) => (
                <button key={m} className={clsx(c.pose === m && "active")} onClick={() => set({ pose: m })}>
                  {m === "hero" ? "Kılıçlı" : m === "wave" ? "Selam" : "Durağan"}
                </button>
              ))}
            </div>
          </div>
          <p className="muted tiny">Oyunda <kbd>Sağ Shift</kbd> West Paneli'ni açar. Essential veya FancyMenu gibi menü modları varsa West menüsü kendiliğinden yalnızca bir düğmeye dönüşür.</p>
        </>
      )}
    </section>
  );
}
