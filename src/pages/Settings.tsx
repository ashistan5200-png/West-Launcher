import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Languages,
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
import { getLang, LANGS, setLang, tx, type Lang } from "@/lib/i18n";

const TABS = [
  { id: "genel", label: tx("Genel"), icon: SlidersHorizontal },
  { id: "gorunum", label: tx("Görünüm"), icon: Palette },
  { id: "oyun", label: tx("Oyun"), icon: Gamepad2 },
  { id: "erisim", label: tx("Erişilebilirlik"), icon: AccessIcon },
  { id: "java", label: tx("Java"), icon: Coffee },
  { id: "ai", label: tx("Ashi"), icon: Brain },
  { id: "guvenlik", label: tx("Güvenlik"), icon: Shield },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "genel";
  const setTab = (id: Tab) => setParams({ tab: id }, { replace: true });
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="set-page">
      <nav className="set-nav" aria-label={tx("Ayar bölümleri")}>
        <h2>{tx("Ayarlar")}</h2>
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
      <Group title={tx("Güncellemeler")}>
        <Row
          title={<>{tx("West Client v")}{status?.current ?? "…"}</>}
          desc={info ? <span className="accent">v{info.version} {tx("indirilmeye hazır")}</span> : status && !checking ? tx("En güncel sürümü kullanıyorsun") : tx("Kontrol ediliyor…")}
        >
          {info ? (
            <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><ArrowUpCircle size={14} /> {tx("Güncelle")}</button>
          ) : (
            <button className="btn btn-ghost btn-sm" disabled={checking} onClick={() => void check()}><RefreshCw size={14} className={checking ? "spin" : ""} /> {tx("Denetle")}</button>
          )}
        </Row>
        <Row title={tx("Otomatik indir")} desc={tx("Yeni sürümü arka planda indirir; kurmadan önce yine sorar.")}>
          <Toggle label={tx("Otomatik indir")} on={settings.autoUpdate} onChange={(v) => void update({ autoUpdate: v })} />
        </Row>
        {error && <p className="hint error set-note">{error}</p>}
      </Group>

      <Group title={tx("Dil")}>
        <Row title={<><Languages size={15} /> {tx("Dil")}</>} desc={tx("Arayüz dili. Değiştirince West Client yeniden yüklenir; oyun içi West menüleri de bir sonraki açılışta bu dilde olur.")}>
          <div className="segmented">
            {LANGS.map((l) => (
              <button key={l.id} className={getLang() === l.id ? "active" : ""} onClick={() => void changeLang(l.id)}>{l.label}</button>
            ))}
          </div>
        </Row>
      </Group>

      <Group title={tx("Oyuncu")}>
        <Row title={tx("Offline kullanıcı adı")} desc={tx("Microsoft hesabı olmadan oynarken görünen isim.")}>
          <input className="set-input" value={offlineName} maxLength={16} onChange={(e) => setOfflineName(e.target.value)} />
        </Row>
        <Row title={tx("Discord'da göster")} desc={tx("Arkadaşların ne oynadığını Discord profilinde görür.")}>
          <Toggle label={tx("Discord'da göster")} on={settings.discordRpc} onChange={(v) => void update({ discordRpc: v })} />
        </Row>
      </Group>

      <Group title={tx("Yardım")}>
        <Row title={tx("Tanıtım turu")} desc={tx("Ashi uygulamayı baştan gezdirsin.")}>
          <button className="btn btn-ghost btn-sm" onClick={() => useOnboarding.getState().startTour()}>{tx("Başlat")}</button>
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
        <Row title={tx("Vurgu rengi")}>
          <div className="swatches">
            {ACCENT_PRESETS.map((c) => (
              <button key={c} className="swatch" style={{ background: c }} onClick={() => updateTheme({ accent: c })} aria-label={c}>
                {t.accent.toLowerCase() === c && <Check size={14} />}
              </button>
            ))}
            <label className="swatch swatch-custom" title={tx("Özel renk")}>
              <input type="color" value={t.accent} onChange={(e) => updateTheme({ accent: e.target.value })} />
            </label>
          </div>
        </Row>
        <Row title={tx("Yoğunluk")} desc={tx("Kompakt daha çok şey sığdırır.")}>
          <Seg value={t.density} options={[["compact", tx("Kompakt")], ["comfortable", tx("Geniş")]]} onChange={(density) => updateTheme({ density })} />
        </Row>
        <Row title={tx("Animasyonları azalt")} desc={tx("Geçişleri sadeleştirir; eski bilgisayarlarda daha akıcı.")}>
          <Toggle label={tx("Animasyonları azalt")} on={t.reduceMotion} onChange={(reduceMotion) => updateTheme({ reduceMotion })} />
        </Row>
        <Row title={tx("İmleç parçacıkları")} desc={tx("Fare geçtiği yerde, altındaki renge göre parlayan küçük pikseller bırakır.")}>
          <Toggle label={tx("İmleç parçacıkları")} on={t.cursorTrail ?? true} onChange={(cursorTrail) => updateTheme({ cursorTrail })} />
        </Row>
      </Group>

      <Group title={tx("Ses")}>
        <Row title={tx("Arka plan müziği")} desc={tx("West'e özel sakin bir müzik. Launcher açıkken ve oyunun menülerinde çalar.")}>
          <Toggle label={tx("Arka plan müziği")} on={settings.music} onChange={(v) => void useSettings.getState().update({ music: v })} />
        </Row>
        <Row title={tx("Oyun içinde de çal")} desc={tx("Dünyadayken Minecraft'ın kendi müziğinin yerine West müziği çalar. Ses düzeyi: Minecraft → Müzik.")}>
          <Toggle label={tx("Oyun içinde de çal")} on={settings.musicInGame} onChange={(v) => void useSettings.getState().update({ musicInGame: v })} />
        </Row>
      </Group>

      <Group title={tx("Pencere")}>
        <Row title={tx("Pencere efekti")}>
          <Seg value={t.windowEffect} options={[["mica", tx("Mica")], ["acrylic", tx("Acrylic")], ["none", tx("Düz")]]} onChange={(windowEffect) => updateTheme({ windowEffect })} />
        </Row>
        <Row title={tx("Bulanıklık")} desc={`${t.blur}px`}>
          <input className="set-range" type="range" min={0} max={40} value={t.blur} onChange={(e) => updateTheme({ blur: Number(e.target.value) })} />
        </Row>
        <Row title={tx("Yüzey opaklığı")} desc={`%${Math.round(t.opacity * 100)}`}>
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
    { key: "perfMods", title: tx("Optimizasyon modlarını kur"), desc: tx("Oyna'ya basınca Sodium, Lithium, FerriteCore, EntityCulling, ImmediatelyFast ve ModernFix uyumluysa kurulur (Fabric/Quilt).") },
    { key: "lowGraphics", title: tx("Grafikleri hafiflet"), desc: tx("Görüş mesafesi en fazla 8, parçacıklar en az, bulut ve gölgeler kapalı, hızlı grafik. Daha düşük ayarların korunur.") },
    { key: "westHud", title: tx("West HUD"), desc: tx("Oyundaki FPS, tuş göstergesi, koordinat gibi West öğeleri.") },
    { key: "westMenus", title: tx("West menüleri"), desc: tx("West ana menüsü, duraklatma menüsü ve West görünümlü Minecraft ekranları. Kapalıyken vanilla menüler.") },
    { key: "gameAnimations", title: tx("Oyun içi animasyonlar"), desc: tx("West menülerindeki geçişler ve parıltılar.") },
    { key: "smoothFont", title: tx("Pürüzsüz yazı tipi"), desc: tx("Oyundaki West yazıları pürüzsüz yazı tipiyle.") },
    { key: "launcherEffects", title: tx("Launcher efektleri"), desc: tx("Bulanık cam yüzeyler ve geçiş animasyonları.") },
  ];
  return (
    <>
      <Group>
        <Row
          title={<>{tx("Performans modu")} {a.performanceMode && <span className="accent">{tx("· açık")}</span>}</>}
          desc={tx("Bilgisayarı zorlananlar için. Sade West ana menüsü gelir, imleç parçacıkları ve ağır efektler kapanır, oyunu hızlandıran ayarlar açılır. Aşağıdan tek tek de değiştirebilirsin.")}
        >
          <Toggle label={tx("Performans modu")} on={a.performanceMode} onChange={setPerf} />
        </Row>
      </Group>
      <Group title={tx("Tek tek")}>
        <Row title={tx("İmleç parçacıkları")} desc={tx("Launcher'da farenin arkasındaki renkli pikseller.")}>
          <Toggle label={tx("İmleç parçacıkları")} on={settings.theme.cursorTrail ?? true} onChange={(cursorTrail) => updateTheme({ cursorTrail })} />
        </Row>
        {items.map((it) => (
          <Row key={it.key} title={it.title} desc={it.desc}>
            <Toggle label={it.title} on={!!a[it.key]} onChange={(v) => set({ [it.key]: v })} />
          </Row>
        ))}
      </Group>
      <p className="hint set-note">{tx("Oyun ayarları bir sonraki \"Oyna\"da uygulanır.")}</p>
    </>
  );
}

function GameTab() {
  const { settings, update } = useSettings();
  return (
    <>
      <Group>
        <Row title={tx("Oyun açılınca küçült")} desc={tx("Minecraft açıldığında West Client görev çubuğuna iner.")}>
          <Toggle label={tx("Oyun açılınca küçült")} on={settings.closeOnLaunch} onChange={(v) => void update({ closeOnLaunch: v })} />
        </Row>
        <Row title={tx("Dünyaları yedekle")} desc={tx("Oyundan çıkınca dünyaların otomatik yedeklenir.")}>
          <Toggle label={tx("Dünyaları yedekle")} on={settings.backupOnExit} onChange={(v) => void update({ backupOnExit: v })} />
        </Row>
        <Row title={tx("West Companion")} desc={tx("Oyun içi West menüsü (Sağ Shift), düzenlenebilir HUD ve FullBright. Fabric 26.2 ve 1.21.11 (1.21.1'de eski sürüm).")}>
          <Toggle label={tx("West Companion")} on={settings.companionEnabled} onChange={(v) => void update({ companionEnabled: v })} />
        </Row>
      </Group>

      <Group title={tx("İndirmeler")}>
        <Row title={tx("Aynı anda indirme")} desc={tx("{0} dosya. İnternetin yavaşsa düşür.", settings.maxConcurrentDownloads)}>
          <input className="set-range" type="range" min={4} max={64} value={settings.maxConcurrentDownloads} onChange={(e) => void update({ maxConcurrentDownloads: Number(e.target.value) })} />
        </Row>
      </Group>

      <details className="set-advanced">
        <summary>{tx("Gelişmiş")}</summary>
        <Group>
          <Row title={tx("Discord uygulama kimliği")} desc={tx("Boş bırak: West Client'ın kendi Discord uygulaması kullanılır.")}>
            <input className="set-input" spellCheck={false} placeholder={tx("İsteğe bağlı")} defaultValue={settings.discordClientId ?? ""} onBlur={(e) => void update({ discordClientId: e.target.value.trim() || null })} />
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
        <Row title={tx("Java'yı otomatik kur")} desc={tx("Her Minecraft sürümüne gereken Java kendiliğinden indirilir. Açık bırakman önerilir.")}>
          <Toggle label={tx("Java'yı otomatik kur")} on={settings.autoJava} onChange={(v) => void update({ autoJava: v })} />
        </Row>
        {[8, 17, 21].map((m) => {
          const found = javas.find((j) => j.major === m);
          return (
            <Row key={m} title={<>{tx("Java")} {m} {found && <Check size={14} className="ok-ico" />}</>} desc={found ? `${found.version} · ${found.managed ? tx("West Client kurdu") : "sistemde bulundu"}` : m === 21 ? tx("1.20.5 ve üstü için") : m === 17 ? tx("1.18 – 1.20.4 için") : tx("1.16.5 ve öncesi için")}>
              {!found && (
                <button className="btn btn-ghost btn-sm" disabled={installing !== null} onClick={async () => { setInstalling(m); try { await api.installJava(m); await load(); } finally { setInstalling(null); } }}>
                  {installing === m ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {tx("Kur")}
                </button>
              )}
            </Row>
          );
        })}
      </Group>
      {hw && (
        <p className="set-hw"><Cpu size={14} /> {hw.cpuBrand} · {hw.logicalCores} {tx("çekirdek ·")} {(hw.totalMemoryMb / 1024).toFixed(1)} {tx("GB RAM")}</p>
      )}
      {javas.length > 0 && (
        <details className="set-advanced">
          <summary>{tx("Bulunan tüm Java kurulumları (")}{javas.length})</summary>
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
          <strong>{ready && smart ? tx("Ashi akıllı modda") : tx("Ashi basit modda")}</strong>
          <span className="muted small">
            {ready && smart
              ? tx("Yapay zeka bilgisayarında çalışıyor. Ücretsiz, anahtarsız; yazdıkların hiçbir yere gitmez.")
              : tx("Mesajındaki anahtar kelimeleri yakalayıp en popüler sonuçları gösterir. Akıllı mod isteğini gerçekten anlar.")}
          </span>
        </div>
        {!(ready && smart) && !progress && <button className="btn btn-primary" onClick={() => ask(true)}><Sparkles size={15} /> {tx("Akıllandır")}</button>}
      </div>
      <AiSetupBadge />

      <Group title={tx("Mod")}>
        <Row title={tx("Akıllı mod (Ollama)")} desc={status?.installed ? (status.running ? tx("Kurulu ve çalışıyor") : tx("Kurulu; gerektiğinde kendiliğinden açılır")) : tx("Kurulu değil. Açınca kurulum sorulur.")}>
          <Toggle label={tx("Akıllı mod")} on={smart && ready} onChange={(v) => {
            if (v && !ready) return ask(true);
            void update({ aiProvider: v ? "ollama" : "off" });
          }} />
        </Row>
      </Group>

      {status?.installed && (
        <Group title={tx("Ashi'nin beyni")}>
          {MODELS.map((m) => {
            const active = settings.ollamaModel === m.id;
            return (
              <Row key={m.id} title={<>{m.name} {status.recommended === m.id && <span className="chip chip-accent">{tx("Önerilen")}</span>}</>} desc={`${m.note} ≈${m.gb} GB`}>
                {active && status.modelInstalled ? (
                  <span className="set-ok"><Check size={14} /> {tx("Kullanılıyor")}</span>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={!!progress && progress.stage !== "done"} onClick={() => void install(m.id)}>
                    {active ? <><Download size={14} /> {tx("İndir")}</> : tx("Buna geç")}
                  </button>
                )}
              </Row>
            );
          })}
        </Group>
      )}

      <details className="set-advanced">
        <summary>{tx("Gelişmiş")}</summary>
        <Group>
          <Row title={tx("Ollama adresi")} desc={tx("Ollama başka bir bilgisayarda çalışıyorsa değiştir.")}>
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
      setMsg({ ok: true, text: value ? tx("Kilit açıldı. West Client açılışta şifre soracak.") : tx("Kilit kaldırıldı.") });
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  };

  return (
    <Group title={tx("Launcher kilidi")}>
      <Row title={has ? tx("Kilit açık") : tx("Kilit kapalı")} desc={tx("Bilgisayarı başkasıyla paylaşıyorsan West Client açılırken şifre sorsun.")}>
        {has && <button className="btn btn-ghost btn-sm" onClick={() => void save(null)}><Trash2 size={14} /> {tx("Kaldır")}</button>}
      </Row>
      <div className="set-row">
        <div className="grow">
          <PasswordField id="settings-pw" value={pw} onChange={setPw} visible={visible} onToggle={() => setVisible((v) => !v)}
            placeholder={has ? tx("Yeni şifre") : tx("En az 4 karakter")} onEnter={() => pw.length >= 4 && void save(pw)} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={pw.length < 4} onClick={() => void save(pw)}><KeyRound size={14} /> {has ? tx("Değiştir") : tx("Kilitle")}</button>
      </div>
      {msg && <p className={clsx("hint set-note", !msg.ok && "error")}>{msg.text}</p>}
    </Group>
  );
}

async function changeLang(l: Lang) {
  if (l === getLang()) return;
  await useSettings.getState().update({ language: l });
  setLang(l);
  location.reload();
}
