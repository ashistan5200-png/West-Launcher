import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Cpu, Download, ExternalLink, KeyRound, Loader2, Trash2 } from "lucide-react";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { events } from "@/lib/ipc";
import type { OllamaStatus, PullProgress, Settings } from "@/lib/types";
import { useChat } from "@/stores/chat";
import { useOnboarding } from "@/stores/onboarding";
import { UpdateSettings } from "@/components/UpdateCenter";
import { useSettings } from "@/stores/settings";
import { api, isTauri } from "@/lib/ipc";
import { ACCENT_PRESETS } from "@/lib/theme";
import type { Hardware, JavaInstall } from "@/lib/types";

export function SettingsPage() {
  const { settings, updateTheme, update, offlineName, setOfflineName } = useSettings();
  const t = settings.theme;
  const [hw, setHw] = useState<Hardware | null>(null);
  const [javas, setJavas] = useState<JavaInstall[]>([]);
  const [installing, setInstalling] = useState<number | null>(null);

  const loadJava = () => api.listJava().then((j) => setJavas(j ?? [])).catch(() => {});
  useEffect(() => {
    if (!isTauri()) return;
    api.getHardware().then(setHw);
    void loadJava();
  }, []);

  return (
    <div className="settings-grid">
      <section className="card stack">
        <h3>Görünüm</h3>

        <div className="field">
          <span>Vurgu rengi</span>
          <div className="swatches">
            {ACCENT_PRESETS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => updateTheme({ accent: c })} aria-label={c}>
                {t.accent.toLowerCase() === c && <Check size={14} />}
              </button>
            ))}
            <label className="swatch swatch-custom" title="Özel renk">
              <input type="color" value={t.accent} onChange={(e) => updateTheme({ accent: e.target.value })} />
            </label>
          </div>
        </div>

        <div className="field">
          <span>Pencere efekti</span>
          <div className="segmented">
            {(["mica", "acrylic", "none"] as const).map((e) => (
              <button key={e} className={clsx(t.windowEffect === e && "active")} onClick={() => updateTheme({ windowEffect: e })}>
                {e === "mica" ? "Mica" : e === "acrylic" ? "Acrylic" : "Düz"}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Arka plan bulanıklığı · {t.blur}px</span>
          <input type="range" min={0} max={40} value={t.blur} onChange={(e) => updateTheme({ blur: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Yüzey opaklığı · {Math.round(t.opacity * 100)}%</span>
          <input type="range" min={60} max={100} value={Math.round(t.opacity * 100)} onChange={(e) => updateTheme({ opacity: Number(e.target.value) / 100 })} />
        </label>

        <div className="field">
          <span>Yoğunluk</span>
          <div className="segmented">
            {(["compact", "comfortable"] as const).map((d) => (
              <button key={d} className={clsx(t.density === d && "active")} onClick={() => updateTheme({ density: d })}>
                {d === "compact" ? "Kompakt" : "Geniş"}
              </button>
            ))}
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={t.reduceMotion} onChange={(e) => updateTheme({ reduceMotion: e.target.checked })} />
          Animasyonları azalt
        </label>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => useOnboarding.getState().startTour()}>
          Ashi'nin tanıtım turunu yeniden başlat
        </button>
      </section>

      <section className="card stack">
        <h3>Oyun</h3>
        <label className="field">
          <span>Offline kullanıcı adı</span>
          <input value={offlineName} onChange={(e) => setOfflineName(e.target.value)} />
        </label>
        <label className="field">
          <span>Eşzamanlı indirme · {settings.maxConcurrentDownloads}</span>
          <input type="range" min={4} max={64} value={settings.maxConcurrentDownloads} onChange={(e) => update({ maxConcurrentDownloads: Number(e.target.value) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.closeOnLaunch} onChange={(e) => update({ closeOnLaunch: e.target.checked })} />
          Oyun açılınca launcher'ı küçült
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.backupOnExit} onChange={(e) => update({ backupOnExit: e.target.checked })} />
          Oyundan çıkınca dünyaları yedekle
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.companionEnabled} onChange={(e) => update({ companionEnabled: e.target.checked })} />
          West Companion oyun içi modunu kur (1.21.1 Fabric/NeoForge)
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.discordRpc} onChange={(e) => update({ discordRpc: e.target.checked })} />
          Discord'da ne oynadığımı göster
        </label>
        {settings.discordRpc && (
          <label className="field">
            <span>Discord uygulama kimliği</span>
            <input
              spellCheck={false}
              placeholder="Discord Developer Portal → Applications → Application ID"
              defaultValue={settings.discordClientId ?? ""}
              onBlur={(e) => update({ discordClientId: e.target.value.trim() || null })}
            />
          </label>
        )}
        {hw && (
          <div className="hw">
            <Cpu size={15} />
            <span className="small">{hw.cpuBrand} · {hw.logicalCores} çekirdek · {(hw.totalMemoryMb / 1024).toFixed(1)} GB RAM</span>
          </div>
        )}
      </section>

      <UpdateSettings autoUpdate={settings.autoUpdate} onToggle={(v) => update({ autoUpdate: v })} />
      <AiSection />
      <KeysSection />

      <section className="card stack span-2">
        <div className="section-head">
          <h3>Java çalışma zamanları</h3>
          <label className="check">
            <input type="checkbox" checked={settings.autoJava} onChange={(e) => update({ autoJava: e.target.checked })} />
            Gerektiğinde otomatik kur
          </label>
        </div>
        <div className="java-row">
          {[8, 17, 21].map((m) => {
            const found = javas.find((j) => j.major === m);
            return (
              <div key={m} className={clsx("java-tile", found && "ok")}>
                <strong>Java {m}</strong>
                <span className="muted tiny truncate" title={found?.path}>{found ? `${found.version} · ${found.managed ? "yönetilen" : "sistem"}` : "Bulunamadı"}</span>
                {!found && (
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={installing !== null}
                    onClick={async () => {
                      setInstalling(m);
                      try { await api.installJava(m); await loadJava(); } finally { setInstalling(null); }
                    }}
                  >
                    {installing === m ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Kur
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {javas.length > 0 && (
          <details>
            <summary className="small muted">Tespit edilen tüm kurulumlar ({javas.length})</summary>
            <ul className="java-list">
              {javas.map((j) => <li key={j.path}><code>{j.version}</code> <span className="muted tiny">{j.arch}</span> <span className="tiny truncate">{j.path}</span></li>)}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

/** API anahtarları: değer bir kez yazılır, launcher onu bir daha UI'a göstermez. */
function KeysSection() {
  const { secrets, loadSecrets } = useChat();
  useEffect(() => {
    void loadSecrets();
    if (location.hash === "#keys") document.getElementById("keys")?.scrollIntoView({ behavior: "smooth" });
  }, [loadSecrets]);

  return (
    <section className="card stack span-2" id="keys">
      <div className="section-head">
        <h3>Hesaplar ve anahtarlar</h3>
        <span className="muted tiny">Anahtarlar yalnızca bu bilgisayarda saklanır ve arayüze geri gönderilmez.</span>
      </div>
      <KeyField
        name="anthropic"
        title="Anthropic API anahtarı"
        hint="Yalnızca yukarıda Claude seçiliyse kullanılır. console.anthropic.com → API Keys. Ücret anahtarın sahibinin hesabına yansır."
        placeholder="sk-ant-…"
        set={secrets?.anthropic ?? false}
      />
      <KeyField
        name="curseforge"
        title="CurseForge API anahtarı"
        hint="CurseForge araması ve modpack'leri için. console.curseforge.com adresinden ücretsiz alınır."
        placeholder="$2a$10$…"
        set={secrets?.curseforge ?? false}
      />
    </section>
  );
}

function KeyField({ name, title, hint, placeholder, set }: { name: "anthropic" | "curseforge"; title: string; hint: string; placeholder: string; set: boolean }) {
  const loadSecrets = useChat((s) => s.loadSecrets);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (v: string) => {
    setBusy(true);
    try {
      await api.setSecret(name, v);
      setValue("");
      await loadSecrets();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="key-field">
      <div className="key-head">
        <KeyRound size={15} />
        <strong>{title}</strong>
        <span className={clsx("key-status", set && "on")}>{set ? "Kayıtlı" : "Eklenmedi"}</span>
      </div>
      <p className="muted tiny">{hint}</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (value.trim()) void save(value); }}>
        <input type="password" autoComplete="off" spellCheck={false} placeholder={set ? "Yeni anahtarla değiştir" : placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!value.trim() || busy}>Kaydet</button>
        {set && (
          <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => save("")}>
            <Trash2 size={14} /> Kaldır
          </button>
        )}
      </form>
    </div>
  );
}


const LOCAL_MODELS = [
  { id: "qwen2.5:3b", label: "Hafif", note: "≈2 GB · 8 GB RAM'li bilgisayarlar için" },
  { id: "qwen2.5:7b", label: "Önerilen", note: "≈4.7 GB · 16 GB RAM, daha iyi Türkçe ve öneriler" },
  { id: "llama3.1:8b", label: "Alternatif", note: "≈4.9 GB · 16 GB RAM" },
];

/** Ashi'nin yapay zekası: varsayılan ücretsiz yerel model; Claude yalnızca kullanıcı isterse. */
function AiSection() {
  const { settings, update } = useSettings();
  const { secrets, loadSecrets } = useChat();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [pull, setPull] = useState<PullProgress | null>(null);
  const provider = settings.aiProvider;

  const refresh = () => isTauri() && api.ollamaStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    void loadSecrets();
    void refresh();
    if (location.hash === "#ai") document.getElementById("ai")?.scrollIntoView({ behavior: "smooth" });
    const un = events.onOllamaPull((p) => {
      setPull(p.done ? null : p);
      if (p.done) void refresh();
    });
    return () => void un.then((f) => f());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => void refresh(), [settings.ollamaModel, settings.ollamaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Settings>) => void update(patch);
  const pct = pull && pull.total ? Math.round((pull.completed / pull.total) * 100) : null;

  return (
    <section className="card stack span-2" id="ai">
      <div className="section-head">
        <h3>Ashi'nin yapay zekası</h3>
        <span className="muted tiny">Varsayılan seçenek tamamen ücretsizdir; hiçbir hesaptan para çekilmez.</span>
      </div>

      <div className="ai-options">
        <button className={clsx("ai-option", provider === "ollama" && "active")} onClick={() => set({ aiProvider: "ollama" })}>
          <strong>Yerel model</strong>
          <span className="ai-price free">Ücretsiz</span>
          <span className="muted tiny">Bilgisayarında çalışır (Ollama). Anahtar ve internet ücreti yok; ilk kurulumda model indirilir.</span>
        </button>
        <button className={clsx("ai-option", provider === "claude" && "active")} onClick={() => set({ aiProvider: "claude" })}>
          <strong>Claude Haiku 5.5</strong>
          <span className="ai-price">Kendi anahtarınla</span>
          <span className="muted tiny">En ucuz Claude modeli, düşük token ayarlarıyla. Ücret yalnızca anahtarı giren kişinin hesabına yansır.</span>
        </button>
        <button className={clsx("ai-option", provider === "off" && "active")} onClick={() => set({ aiProvider: "off" })}>
          <strong>Kapalı</strong>
          <span className="ai-price free">Ücretsiz</span>
          <span className="muted tiny">Yapay zeka yok; Ashi anahtar kelimelerle arayıp popüler sonuçları gösterir.</span>
        </button>
      </div>

      {provider === "ollama" && (
        <div className="key-field">
          <div className="key-head">
            <Cpu size={15} />
            <strong>Yerel model durumu</strong>
            <span className={clsx("key-status", status?.running && status.modelInstalled && "on")}>
              {!status?.running ? "Ollama çalışmıyor" : status.modelInstalled ? "Hazır" : "Model indirilmedi"}
            </span>
          </div>
          {!status?.running && (
            <p className="muted tiny">
              Ollama'yı kur ve aç; launcher onu otomatik bulur. Bu sırada Ashi basit arama moduyla çalışmaya devam eder.{" "}
              <button className="link" onClick={() => openUrl("https://ollama.com/download")}>ollama.com/download <ExternalLink size={11} /></button>
            </p>
          )}
          <div className="model-options">
            {LOCAL_MODELS.map((m) => (
              <button key={m.id} className={clsx("model-option", settings.ollamaModel === m.id && "active")} onClick={() => set({ ollamaModel: m.id })}>
                <strong>{m.label}</strong> <code>{m.id}</code>
                <span className="muted tiny">{m.note}</span>
              </button>
            ))}
          </div>
          {status?.running && !status.modelInstalled && (
            pull ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="tiny muted">{pull.status}{pct !== null ? ` · %${pct}` : ""}</span>
                <div className="progress-bar"><div style={{ width: `${pct ?? 2}%` }} /></div>
              </div>
            ) : (
              <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => { setPull({ status: "Başlatılıyor…", completed: 0, total: 0, done: false, error: null }); void api.ollamaPull().catch(() => setPull(null)); }}>
                <Download size={14} /> {settings.ollamaModel} modelini indir
              </button>
            )
          )}
          <details>
            <summary className="tiny muted">Gelişmiş: Ollama adresi</summary>
            <input style={{ marginTop: 8 }} value={settings.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} spellCheck={false} />
          </details>
        </div>
      )}

      {provider === "claude" && !secrets?.anthropic && (
        <p className="hint warn">Claude için aşağıdaki "Anthropic API anahtarı" alanına bir anahtar ekle; eklenmezse Ashi basit arama moduyla çalışır.</p>
      )}
    </section>
  );
}
