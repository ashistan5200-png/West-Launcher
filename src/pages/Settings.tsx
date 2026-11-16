import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility as AccessIcon, ArrowUpCircle, Brain, Check, Coffee, Cpu, Download, Gamepad2, KeyRound, Loader2, Palette, RefreshCw, Shield, SlidersHorizontal, Sparkles, Trash2,
} from "lucide-react";
import type { Hardware, JavaInstall } from "@/lib/types";
import { api, isTauri } from "@/lib/ipc";
import { ACCENT_PRESETS } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { useOnboarding } from "@/stores/onboarding";
import { useUpdate } from "@/stores/update";
import { aiReady, MODELS, useAi } from "@/stores/ai";
import { PasswordField } from "@/components/SetupWizard";
import { AiSetupBadge } from "@/components/AiSetup";

const TABS = [
  { id: "genel", label: "Genel", icon: SlidersHorizontal },
  { id: "gorunum", label: "Görünüm", icon: Palette },
  { id: "oyun", label: "Oyun", icon: Gamepad2 },
  { id: "erisim", label: "Erişilebilirlik", icon: AccessIcon },
  { id: "java", label: "Java", icon: Coffee },
  { id: "ai", label: "Ashi", icon: Brain },
  { id: "guvenlik", label: "Güvenlik", icon: Shield },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "genel";
  const setTab = (id: Tab) => setParams({ tab: id }, { replace: true });
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="set-page">
      <nav className="set-nav" aria-label="Ayar bölümleri">
        <h2>Ayarlar</h2>
        {TABS.map((t) => (
          <button key={t.id} className={clsx("set-tab", tab === t.id && "active")} onClick={() => setTab(t.id)}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>
      <AnimatePresence mode="wait">
        <motion.div key={tab} className="set-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          <h1 className="set-title">{current.label}</h1>
          {tab === "genel" && <GeneralTab />}
          {tab === "gorunum" && <AppearanceTab />}
          {tab === "oyun" && <GameTab />}
          {tab === "erisim" && <AccessibilityTab />}
          {tab === "java" && <JavaTab />}
          {tab === "ai" && <AiTab />}
          {tab === "guvenlik" && <SecurityTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ───────── Yapı taşları ─────────

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="set-group">
      {title && <h3>{title}</h3>}
      <div className="set-card">{children}</div>
    </section>
  );
}

function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <strong>{title}</strong>
        {desc && <span>{desc}</span>}
      </div>
      {children && <div className="set-ctl">{children}</div>}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={clsx("switch", on && "on")} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, l]) => <button key={v} className={clsx(value === v && "active")} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

// ───────── Sekmeler ─────────

function GeneralTab() {
  const { settings, update, offlineName, setOfflineName } = useSettings();
  const { status, check, checking, setOpen, error } = useUpdate();
  const info = status?.info;
  return (
    <>
      <Group title="Güncellemeler">
        <Row
          title={<>West Client v{status?.current ?? "…"}</>}
          desc={info ? <span className="accent">v{info.version} indirilmeye hazır</span> : status && !checking ? "En güncel sürümü kullanıyorsun" : "Kontrol ediliyor…"}
        >
          {info ? (
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><ArrowUpCircle size={14} /> Güncelle</button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={checking} onClick={() => void check()}><RefreshCw size={14} className={checking ? "spin" : ""} /> Denetle</button>
          )}
        </Row>
        <Row title="Otomatik indir" desc="Yeni sürümü arka planda indirir; kurmadan önce yine sorar.">
          <Toggle label="Otomatik indir" on={settings.autoUpdate} onChange={(v) => void update({ autoUpdate: v })} />
        </Row>
        {error && <p className="hint error set-note">{error}</p>}
      </Group>

      <Group title="Oyuncu">
        <Row title="Offline kullanıcı adı" desc="Microsoft hesabı olmadan oynarken görünen isim.">
          <input className="set-input" value={offlineName} maxLength={16} onChange={(e) => setOfflineName(e.target.value)} />
        </Row>
        <Row title="Discord'da göster" desc="Arkadaşların ne oynadığını Discord profilinde görür.">
          <Toggle label="Discord'da göster" on={settings.discordRpc} onChange={(v) => void update({ discordRpc: v })} />
        </Row>
      </Group>

      <Group title="Yardım">
        <Row title="Tanıtım turu" desc="Ashi uygulamayı baştan gezdirsin.">
          <button className="btn btn-ghost btn-sm" onClick={() => useOnboarding.getState().startTour()}>Başlat</button>
        </Row>
      </Group>
    </>
  );
}

function AppearanceTab() {
  const { settings, updateTheme } = useSettings();
  const t = settings.theme;
  return (
    <>
      <Group>
        <Row title="Vurgu rengi">
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
        </Row>
        <Row title="Yoğunluk" desc="Kompakt daha çok şey sığdırır.">
          <Seg value={t.density} options={[["compact", "Kompakt"], ["comfortable", "Geniş"]]} onChange={(density) => updateTheme({ density })} />
        </Row>
        <Row title="Animasyonları azalt" desc="Geçişleri sadeleştirir; eski bilgisayarlarda daha akıcı.">
          <Toggle label="Animasyonları azalt" on={t.reduceMotion} onChange={(reduceMotion) => updateTheme({ reduceMotion })} />
        </Row>
        <Row title="İmleç parçacıkları" desc="Fare geçtiği yerde, altındaki renge göre parlayan küçük pikseller bırakır.">
          <Toggle label="İmleç parçacıkları" on={t.cursorTrail ?? true} onChange={(cursorTrail) => updateTheme({ cursorTrail })} />
        </Row>
      </Group>

      <Group title="Ses">
        <Row title="Arka plan müziği" desc="West'e özel sakin bir müzik. Launcher açıkken ve oyunun menülerinde çalar.">
          <Toggle label="Arka plan müziği" on={settings.music} onChange={(v) => void useSettings.getState().update({ music: v })} />
        </Row>
        <Row title="Oyun içinde de çal" desc="Dünyadayken Minecraft'ın kendi müziğinin yerine West müziği çalar. Ses düzeyi: Minecraft → Müzik.">
          <Toggle label="Oyun içinde de çal" on={settings.musicInGame} onChange={(v) => void useSettings.getState().update({ musicInGame: v })} />
        </Row>
      </Group>

      <Group title="Pencere">
        <Row title="Pencere efekti">
          <Seg value={t.windowEffect} options={[["mica", "Mica"], ["acrylic", "Acrylic"], ["none", "Düz"]]} onChange={(windowEffect) => updateTheme({ windowEffect })} />
        </Row>
        <Row title="Bulanıklık" desc={`${t.blur}px`}>
          <input className="set-range" type="range" min={0} max={40} value={t.blur} onChange={(e) => updateTheme({ blur: Number(e.target.value) })} />
        </Row>
        <Row title="Yüzey opaklığı" desc={`%${Math.round(t.opacity * 100)}`}>
          <input className="set-range" type="range" min={60} max={100} value={Math.round(t.opacity * 100)} onChange={(e) => updateTheme({ opacity: Number(e.target.value) / 100 })} />
        </Row>
      </Group>
    </>
  );
}

function AccessibilityTab() {
  const { settings, update, updateTheme } = useSettings();
  const a = settings.accessibility;
  const set = (patch: Partial<typeof a>) => void update({ accessibility: { ...a, ...patch } });
  const setPerf = (on: boolean) => {
    // Ana anahtar: tüm hafifletmeleri birlikte açar/kapatır; sonra tek tek değiştirilebilir
    void update({
      accessibility: {
        ...a,
        performanceMode: on,
        gameAnimations: !on,
        perfMods: on,
        lowGraphics: on,
        launcherEffects: !on,
      },
    });
    updateTheme({ cursorTrail: !on, reduceMotion: on });
  };
  const items: { key: keyof typeof a; title: string; desc: string; invert?: boolean }[] = [
    { key: "perfMods", title: "Optimizasyon modlarını kur", desc: "Oyna'ya basınca Sodium, Lithium, FerriteCore, EntityCulling, ImmediatelyFast ve ModernFix uyumluysa kurulur (Fabric/Quilt)." },
    { key: "lowGraphics", title: "Grafikleri hafiflet", desc: "Görüş mesafesi en fazla 8, parçacıklar en az, bulut ve gölgeler kapalı, hızlı grafik. Daha düşük ayarların korunur." },
    { key: "westHud", title: "West HUD", desc: "Oyundaki FPS, tuş göstergesi, koordinat gibi West öğeleri." },
    { key: "westMenus", title: "West menüleri", desc: "West ana menüsü, duraklatma menüsü ve West görünümlü Minecraft ekranları. Kapalıyken vanilla menüler." },
    { key: "gameAnimations", title: "Oyun içi animasyonlar", desc: "West menülerindeki geçişler ve parıltılar." },
    { key: "smoothFont", title: "Pürüzsüz yazı tipi", desc: "Oyundaki West yazıları pürüzsüz yazı tipiyle." },
    { key: "launcherEffects", title: "Launcher efektleri", desc: "Bulanık cam yüzeyler ve geçiş animasyonları." },
  ];
  return (
    <>
      <Group>
        <Row
          title={<>Performans modu {a.performanceMode && <span className="accent">· açık</span>}</>}
          desc="Bilgisayarı zorlananlar için. Sade West ana menüsü gelir, imleç parçacıkları ve ağır efektler kapanır, oyunu hızlandıran ayarlar açılır. Aşağıdan tek tek de değiştirebilirsin."
        >
          <Toggle label="Performans modu" on={a.performanceMode} onChange={setPerf} />
        </Row>
      </Group>
      <Group title="Tek tek">
        <Row title="İmleç parçacıkları" desc="Launcher'da farenin arkasındaki renkli pikseller.">
          <Toggle label="İmleç parçacıkları" on={settings.theme.cursorTrail ?? true} onChange={(cursorTrail) => updateTheme({ cursorTrail })} />
        </Row>
        {items.map((it) => (
          <Row key={it.key} title={it.title} desc={it.desc}>
            <Toggle label={it.title} on={!!a[it.key]} onChange={(v) => set({ [it.key]: v })} />
          </Row>
        ))}
      </Group>
      <p className="hint set-note">Oyun ayarları bir sonraki "Oyna"da uygulanır.</p>
    </>
  );
}

function GameTab() {
  const { settings, update } = useSettings();
  return (
    <>
      <Group>
        <Row title="Oyun açılınca küçült" desc="Minecraft açıldığında West Client görev çubuğuna iner.">
          <Toggle label="Oyun açılınca küçült" on={settings.closeOnLaunch} onChange={(v) => void update({ closeOnLaunch: v })} />
        </Row>
        <Row title="Dünyaları yedekle" desc="Oyundan çıkınca dünyaların otomatik yedeklenir.">
          <Toggle label="Dünyaları yedekle" on={settings.backupOnExit} onChange={(v) => void update({ backupOnExit: v })} />
        </Row>
        <Row title="West Companion" desc="Oyun içi West menüsü (Sağ Shift), düzenlenebilir HUD ve FullBright. Fabric 26.2 ve 1.21.11 (1.21.1'de eski sürüm).">
          <Toggle label="West Companion" on={settings.companionEnabled} onChange={(v) => void update({ companionEnabled: v })} />
        </Row>
      </Group>

      <Group title="İndirmeler">
        <Row title="Aynı anda indirme" desc={`${settings.maxConcurrentDownloads} dosya. İnternetin yavaşsa düşür.`}>
          <input className="set-range" type="range" min={4} max={64} value={settings.maxConcurrentDownloads} onChange={(e) => void update({ maxConcurrentDownloads: Number(e.target.value) })} />
        </Row>
      </Group>

      <details className="set-advanced">
        <summary>Gelişmiş</summary>
        <Group>
          <Row title="Discord uygulama kimliği" desc="Boş bırak: West Client'ın kendi Discord uygulaması kullanılır.">
            <input className="set-input" spellCheck={false} placeholder="İsteğe bağlı" defaultValue={settings.discordClientId ?? ""} onBlur={(e) => void update({ discordClientId: e.target.value.trim() || null })} />
          </Row>
        </Group>
      </details>
    </>
  );
}

function JavaTab() {
  const { settings, update } = useSettings();
  const [hw, setHw] = useState<Hardware | null>(null);
  const [javas, setJavas] = useState<JavaInstall[]>([]);
  const [installing, setInstalling] = useState<number | null>(null);
  const load = () => api.listJava().then((j) => setJavas(j ?? [])).catch(() => {});
  useEffect(() => {
    if (!isTauri()) return;
    void api.getHardware().then(setHw);
    void load();
  }, []);

  return (
    <>
      <Group>
        <Row title="Java'yı otomatik kur" desc="Her Minecraft sürümüne gereken Java kendiliğinden indirilir. Açık bırakman önerilir.">
          <Toggle label="Java'yı otomatik kur" on={settings.autoJava} onChange={(v) => void update({ autoJava: v })} />
        </Row>
        {[8, 17, 21].map((m) => {
          const found = javas.find((j) => j.major === m);
          return (
            <Row key={m} title={<>Java {m} {found && <Check size={14} className="ok-ico" />}</>} desc={found ? `${found.version} · ${found.managed ? "West Client kurdu" : "sistemde bulundu"}` : m === 21 ? "1.20.5 ve üstü için" : m === 17 ? "1.18 – 1.20.4 için" : "1.16.5 ve öncesi için"}>
              {!found && (
                <button className="btn btn-ghost btn-sm" disabled={installing !== null} onClick={async () => { setInstalling(m); try { await api.installJava(m); await load(); } finally { setInstalling(null); } }}>
                  {installing === m ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Kur
                </button>
              )}
            </Row>
          );
        })}
      </Group>
      {hw && (
        <p className="set-hw"><Cpu size={14} /> {hw.cpuBrand} · {hw.logicalCores} çekirdek · {(hw.totalMemoryMb / 1024).toFixed(1)} GB RAM</p>
      )}
      {javas.length > 0 && (
        <details className="set-advanced">
          <summary>Bulunan tüm Java kurulumları ({javas.length})</summary>
          <ul className="java-list">
            {javas.map((j) => <li key={j.path}><code>{j.version}</code> <span className="muted tiny">{j.arch}</span> <span className="tiny truncate">{j.path}</span></li>)}
          </ul>
        </details>
      )}
    </>
  );
}

function AiTab() {
  const { settings, update } = useSettings();
  const { status, refresh, ask, install, progress } = useAi();
  useEffect(() => void refresh(), [refresh]);
  const ready = aiReady(status);
  const smart = settings.aiProvider === "ollama";

  return (
    <>
      <div className={clsx("ai-hero", ready && smart && "on")}>
        <Brain size={26} />
        <div className="grow">
          <strong>{ready && smart ? "Ashi akıllı modda" : "Ashi basit modda"}</strong>
          <span className="muted small">
            {ready && smart
              ? "Yapay zeka bilgisayarında çalışıyor. Ücretsiz, anahtarsız; yazdıkların hiçbir yere gitmez."
              : "Mesajındaki anahtar kelimeleri yakalayıp en popüler sonuçları gösterir. Akıllı mod isteğini gerçekten anlar."}
          </span>
        </div>
        {!(ready && smart) && !progress && <button className="btn btn-primary" onClick={() => ask(true)}><Sparkles size={15} /> Akıllandır</button>}
      </div>
      <AiSetupBadge />

      <Group title="Mod">
        <Row title="Akıllı mod (Ollama)" desc={status?.installed ? (status.running ? "Kurulu ve çalışıyor" : "Kurulu; gerektiğinde kendiliğinden açılır") : "Kurulu değil. Açınca kurulum sorulur."}>
          <Toggle label="Akıllı mod" on={smart && ready} onChange={(v) => {
            if (v && !ready) return ask(true);
            void update({ aiProvider: v ? "ollama" : "off" });
          }} />
        </Row>
      </Group>

      {status?.installed && (
        <Group title="Ashi'nin beyni">
          {MODELS.map((m) => {
            const active = settings.ollamaModel === m.id;
            return (
              <Row key={m.id} title={<>{m.name} {status.recommended === m.id && <span className="chip chip-accent">Önerilen</span>}</>} desc={`${m.note} ≈${m.gb} GB`}>
                {active && status.modelInstalled ? (
                  <span className="set-ok"><Check size={14} /> Kullanılıyor</span>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={!!progress && progress.stage !== "done"} onClick={() => void install(m.id)}>
                    {active ? <><Download size={14} /> İndir</> : "Buna geç"}
                  </button>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      <details className="set-advanced">
        <summary>Gelişmiş</summary>
        <Group>
          <Row title="Ollama adresi" desc="Ollama başka bir bilgisayarda çalışıyorsa değiştir.">
            <input className="set-input" spellCheck={false} defaultValue={settings.ollamaUrl} onBlur={(e) => { void update({ ollamaUrl: e.target.value.trim() || "http://localhost:11434" }).then(refresh); }} />
          </Row>
        </Group>
      </details>
    </>
  );
}

/** Launcher kilidi: açılışta şifre sorulur. Şifre yalnızca Argon2 özeti olarak saklanır. */
function SecurityTab() {
  const [has, setHas] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [visible, setVisible] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (isTauri()) api.lockStatus().then((s) => setHas(s.hasPassword)).catch(() => setHas(false));
    else setHas(false);
  }, []);

  const save = async (value: string | null) => {
    try {
      await api.setLauncherPassword(value);
      setHas(!!value);
      setPw("");
      setVisible(false);
      setMsg({ ok: true, text: value ? "Kilit açıldı. West Client açılışta şifre soracak." : "Kilit kaldırıldı." });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  return (
    <Group title="Launcher kilidi">
      <Row title={has ? "Kilit açık" : "Kilit kapalı"} desc="Bilgisayarı başkasıyla paylaşıyorsan West Client açılırken şifre sorsun.">
        {has && <button className="btn btn-ghost btn-sm" onClick={() => void save(null)}><Trash2 size={14} /> Kaldır</button>}
      </Row>
      <div className="set-row">
        <div className="grow">
          <PasswordField id="settings-pw" value={pw} onChange={setPw} visible={visible} onToggle={() => setVisible((v) => !v)}
            placeholder={has ? "Yeni şifre" : "En az 4 karakter"} onEnter={() => pw.length >= 4 && void save(pw)} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={pw.length < 4} onClick={() => void save(pw)}><KeyRound size={14} /> {has ? "Değiştir" : "Kilitle"}</button>
      </div>
      {msg && <p className={clsx("hint set-note", !msg.ok && "error")}>{msg.text}</p>}
    </Group>
  );
}
