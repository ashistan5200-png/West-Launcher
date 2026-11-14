import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { open as openPath } from "@tauri-apps/plugin-shell";
import { Copy, FolderOpen, LayoutTemplate, Loader2, Play, Square, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import { useAshi, useHuntRunning } from "@/stores/ashi";
import { InstanceIcon } from "@/components/InstanceIcon";
import { Modal } from "@/components/Modal";
import { api } from "@/lib/ipc";
import { LOADER_LABEL, formatDuration } from "@/lib/format";
import type { CompanionConfig, CompanionInfo, Instance, JvmProfile } from "@/lib/types";

type Tab = "console" | "settings";

export function InstancePage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { instances, running, launching, logs, lastExit, launch, kill, remove, clone, refresh } = useInstances();
  const offlineName = useSettings((s) => s.offlineName);
  const inst = instances.find((i) => i.id === id);
  const hunting = useHuntRunning(id);
  const openAshi = useAshi((s) => s.openConfirm);
  const [tab, setTab] = useState<Tab>("console");
  const [cloneOpen, setCloneOpen] = useState(false);

  if (!inst) return <p className="muted pad">Instance bulunamadı.</p>;

  const isRunning = running[id] !== undefined;
  const isLaunching = !!launching[id];
  const exit = lastExit[id];

  return (
    <div className="stack">
      <header className="instance-header">
        <InstanceIcon instance={inst} size={64} />
        <div className="grow">
          <h1>{inst.name}</h1>
          <div className="chips">
            <span className="chip">{LOADER_LABEL[inst.loader.kind]} {inst.loader.version ?? ""}</span>
            <span className="chip">{inst.mcVersion}</span>
            <span className="chip">{formatDuration(inst.totalPlaySecs)} oynandı</span>
            {inst.importedFrom && <span className="chip">↳ {inst.importedFrom}</span>}
          </div>
        </div>
        <div className="row">
          <button className="icon-btn" title="Klasörü aç" onClick={async () => openPath(await api.instancePath(id))}>
            <FolderOpen size={17} />
          </button>
          <button className="icon-btn" title="Klonla" onClick={() => setCloneOpen(true)}>
            <Copy size={17} />
          </button>
          <button
            className="icon-btn"
            title="Şablon oluştur"
            onClick={async () => { await api.makeTemplate(id, `${inst.name} şablonu`); await refresh(); }}
          >
            <LayoutTemplate size={17} />
          </button>
          <button
            className={`btn ${isRunning ? "btn-danger" : "btn-primary"}`}
            disabled={isLaunching || hunting}
            title={hunting ? "Ashi bu instance'ta suçlu avında" : undefined}
            onClick={() => (isRunning ? kill(id) : launch(id, offlineName))}
          >
            {isLaunching ? <Loader2 size={16} className="spin" /> : isRunning ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            {hunting ? "Ashi avda" : isRunning ? "Durdur" : "Oyna"}
          </button>
        </div>
      </header>

      {exit?.crashed && !exit.duringHunt && !isRunning && !hunting && (
        <div className="banner banner-error row">
          <span className="grow">Oyun {exit.code} çıkış koduyla çöktü.</span>
          {exit.modCount >= 2 && (
            <button className="btn btn-sm btn-ghost" onClick={() => openAshi(id, inst.name)}>
              Ashi'den suçluyu bulmasını iste
            </button>
          )}
        </div>
      )}

      <div className="tabs">
        {(["console", "settings"] as Tab[]).map((t) => (
          <button key={t} className={clsx("tab", tab === t && "active")} onClick={() => setTab(t)}>
            {t === "console" ? "Konsol" : "Ayarlar"}
          </button>
        ))}
      </div>

      {tab === "console" ? (
        <Console lines={logs[id] ?? []} />
      ) : (
        <InstanceSettings
          instance={inst}
          onDelete={async () => {
            if (confirm(`"${inst.name}" ve tüm dünyaları silinsin mi?`)) {
              await remove(id);
              navigate("/library");
            }
          }}
        />
      )}

      <CloneModal open={cloneOpen} onClose={() => setCloneOpen(false)} name={inst.name} onConfirm={(n, w) => clone(id, n, w)} />
    </div>
  );
}

function Console({ lines }: { lines: { line: string; stderr: boolean }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines, follow]);

  const level = (l: string) => (/\b(ERROR|FATAL)\b|Exception/.test(l) ? "err" : /\bWARN\b/.test(l) ? "warn" : "");

  return (
    <div
      className="console"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
      }}
    >
      {lines.length === 0 && <span className="muted">Oyun başlatıldığında loglar burada akacak.</span>}
      {lines.map((l, i) => (
        <div key={i} className={clsx("log-line", l.stderr && "stderr", level(l.line))}>{l.line}</div>
      ))}
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
