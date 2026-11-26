import { useEffect, useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  Accessibility as AccessIcon, ArrowUpCircle, Brain, Check, Coffee, Cpu, Download, FolderOpen, Gamepad2, HardDrive, Info, KeyRound, Loader2,
  Palette, RefreshCw, RotateCcw, Search, Shield, SlidersHorizontal, Sparkles, Terminal, Trash2, Volume2, Wrench, X,
} from "lucide-react";
import type { GameDefaults, Hardware, JavaInstall } from "@/lib/types";
import { api, isTauri } from "@/lib/ipc";
import { ACCENT_PRESETS } from "@/lib/theme";
import { useSettings } from "@/stores/settings";
import { useOnboarding } from "@/stores/onboarding";
import { useUpdate } from "@/stores/update";
import { aiReady, MODELS, useAi } from "@/stores/ai";
import { PasswordField } from "@/components/SetupWizard";
import { AiSetupBadge } from "@/components/AiSetup";
import { askConfirm } from "@/components/ConfirmDialog";
import { setWestPhotoOn, westPhotoOn } from "@/lib/westphoto";
import { getLang, LANGS, setLang, tx, type Lang } from "@/lib/i18n";

const TABS = [
  { id: "genel", label: tx("Genel"), icon: SlidersHorizontal },
  { id: "gorunum", label: tx("Görünüm"), icon: Palette },
  { id: "ses", label: tx("Ses"), icon: Volume2 },
  { id: "oyun", label: tx("Oyun"), icon: Gamepad2 },
  { id: "java", label: tx("Java ve bellek"), icon: Coffee },
  { id: "baslatma", label: tx("Başlatma"), icon: Terminal },
  { id: "performans", label: tx("Performans"), icon: AccessIcon },
  { id: "indirme", label: tx("İndirmeler ve depolama"), icon: HardDrive },
  { id: "ai", label: tx("Ashi"), icon: Brain },
  { id: "gizlilik", label: tx("Gizlilik ve güvenlik"), icon: Shield },
  { id: "guncelleme", label: tx("Güncellemeler"), icon: ArrowUpCircle },
  { id: "gelismis", label: tx("Gelişmiş"), icon: Wrench },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Ayar araması: başlık → bölüm (satır başlıklarıyla aynı metin) */
const INDEX: [Tab, string, string?][] = [
  ["genel", tx("Dil"), "language"], ["genel", tx("Açılış sayfası")], ["genel", tx("Oyun açılınca launcher")], ["genel", tx("Offline kullanıcı adı")],
  ["genel", tx("Discord'da göster"), "discord rich presence"], ["genel", tx("Tanıtım turu")], ["genel", tx("Photoshop modu (WestPhoto)"), "galeri düzenleyici katman"],
  ["gorunum", tx("Vurgu rengi"), "tema renk"], ["gorunum", tx("Yoğunluk")], ["gorunum", tx("Animasyonları azalt")], ["gorunum", tx("İmleç parçacıkları")],
  ["gorunum", tx("Pencere efekti"), "mica acrylic"], ["gorunum", tx("Bulanıklık")], ["gorunum", tx("Yüzey opaklığı")],
  ["ses", tx("Arka plan müziği")], ["ses", tx("Oyun içinde de çal")],
  ["oyun", tx("Pencere boyutu"), "çözünürlük resolution"], ["oyun", tx("Tam ekran başlat"), "fullscreen"], ["oyun", tx("West Companion"), "hud"],
  ["oyun", tx("Dünyaları yedekle"), "backup"], ["oyun", tx("Saklanacak yedek")], ["oyun", tx("Yedek klasörü")],
  ["java", tx("Java'yı otomatik kur")], ["java", tx("Varsayılan bellek"), "ram memory xmx"], ["java", tx("JVM argümanları"), "java flags"],
  ["baslatma", tx("Başlatma öncesi komut"), "pre-launch hook"], ["baslatma", tx("Oyun sonrası komut"), "post-exit hook"], ["baslatma", tx("Sarmalayıcı komut"), "wrapper gamemode prime-run mangohud"],
  ["performans", tx("Performans modu")], ["performans", tx("Optimizasyon modlarını kur"), "sodium lithium"], ["performans", tx("Grafikleri hafiflet")],
  ["indirme", tx("Aynı anda indirme")], ["indirme", tx("İndirme önbelleği"), "cache"],
  ["ai", tx("Akıllı mod (Ollama)"), "yapay zeka"], ["gizlilik", tx("Launcher kilidi"), "şifre password"],
  ["guncelleme", tx("Otomatik indir"), "update"], ["gelismis", tx("Veri klasörü")], ["gelismis", tx("Discord uygulama kimliği")], ["gelismis", tx("Ayarları sıfırla"), "reset"],
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "genel";
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const setTab = (id: Tab) => setParams({ tab: id }, { replace: true });
  const current = TABS.find((t) => t.id === tab)!;
  const results = useMemo(() => {
    const n = q.trim().toLocaleLowerCase();
    if (!n) return [];
    return INDEX.filter(([, title, k]) => title.toLocaleLowerCase().includes(n) || (k ?? "").includes(n));
  }, [q]);
  // Aramadan seçilen ayara kaydır ve kısa süre vurgula
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => {
      const el = document.querySelector(`.set-row[data-title="${CSS.escape(flash)}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.classList.add("flash");
      window.setTimeout(() => el?.classList.remove("flash"), 1600);
      setFlash(null);
    }, 220);
    return () => window.clearTimeout(t);
  }, [flash, tab]);

  return (
    <div className="set-page">
      <nav className="set-nav" aria-label={tx("Ayar bölümleri")}>
        <h2>{tx("Ayarlar")}</h2>
        <div className="search set-search">
          <Search size={14} />
          <input placeholder={tx("Ayarlarda ara")} value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="icon-btn" onClick={() => setQ("")} aria-label={tx("Temizle")}><X size={13} /></button>}
        </div>
        {TABS.map((t) => (
          <button key={t.id} className={clsx("set-tab", tab === t.id && !q && "active")} onClick={() => { setQ(""); setTab(t.id); }}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </nav>
      <AnimatePresence mode="wait">
        <motion.div key={q ? "search" : tab} className="set-panel" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {q ? (
            <>
              <h1 className="set-title">{tx("Arama sonuçları")}</h1>
              {results.length === 0 ? <p className="muted">{tx("\"{0}\" ile eşleşen ayar yok.", q)}</p> : (
                <div className="set-card">
                  {results.map(([t, title]) => {
                    const T = TABS.find((x) => x.id === t)!;
                    return (
                      <button key={t + title} className="set-row set-result" onClick={() => { setQ(""); setTab(t); setFlash(title); }}>
                        <div className="set-text"><strong>{title}</strong><span><T.icon size={12} /> {T.label}</span></div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <h1 className="set-title">{current.label}</h1>
              {tab === "genel" && <GeneralTab />}
              {tab === "gorunum" && <AppearanceTab />}
              {tab === "ses" && <SoundTab />}
              {tab === "oyun" && <GameTab />}
              {tab === "java" && <JavaTab />}
              {tab === "baslatma" && <LaunchTab />}
              {tab === "performans" && <AccessibilityTab />}
              {tab === "indirme" && <DownloadsTab />}
              {tab === "ai" && <AiTab />}
              {tab === "gizlilik" && <SecurityTab />}
              {tab === "guncelleme" && <UpdatesTab />}
              {tab === "gelismis" && <AdvancedTab />}
            </>
          )}
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
    <div className="set-row" data-title={typeof title === "string" ? title : undefined}>
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
  return (
    <>
      <Group>
        <Row title={tx("Dil")} desc={tx("Arayüz dili. Değiştirince West Client yeniden yüklenir; oyun içi West menüleri de bir sonraki açılışta bu dilde olur.")}>
          <div className="segmented">
            {LANGS.map((l) => (
              <button key={l.id} className={getLang() === l.id ? "active" : ""} onClick={() => void changeLang(l.id)}>{l.label}</button>
            ))}
          </div>
        </Row>
        <Row title={tx("Açılış sayfası")} desc={tx("West Client açılınca ilk gösterilen sayfa.")}>
          <select className="set-select" value={settings.startPage} onChange={(e) => void update({ startPage: e.target.value })}>
            <option value="/">{tx("Ana Sayfa")}</option>
            <option value="/library">{tx("Kütüphane")}</option>
            <option value="/browse">{tx("Keşfet")}</option>
          </select>
        </Row>
        <Row title={tx("Oyun açılınca launcher")} desc={tx("Gizle seçilirse oyun kapanınca West Client kendiliğinden geri gelir.")}>
          <Seg value={settings.launchBehavior} options={[["keep", tx("Açık kalsın")], ["minimize", tx("Küçült")], ["hide", tx("Gizle")]]} onChange={(launchBehavior) => void update({ launchBehavior, closeOnLaunch: false })} />
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

      <Group title={tx("Galeri")}>
        <Row title={tx("Photoshop modu (WestPhoto)")} desc={tx("Ekran görüntüsü düzenleyicisi katmanlar, maskeler, seçimler, fırçalar, eğriler, filtreler ve serbest dönüştürmeyle tam bir görüntü düzenleyici olarak açılır.")}>
          <WestPhotoToggle />
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

function WestPhotoToggle() {
  const [on, setOn] = useState(westPhotoOn);
  return <Toggle label={tx("Photoshop modu (WestPhoto)")} on={on} onChange={(v) => { setWestPhotoOn(v); setOn(v); }} />;
}

function SoundTab() {
  const { settings, update } = useSettings();
  return (
    <Group>
      <Row title={tx("Arka plan müziği")} desc={tx("West'e özel sakin bir müzik. Launcher açıkken ve oyunun menülerinde çalar.")}>
        <Toggle label={tx("Arka plan müziği")} on={settings.music} onChange={(v) => void update({ music: v })} />
      </Row>
      <Row title={tx("Oyun içinde de çal")} desc={tx("Dünyadayken Minecraft'ın kendi müziğinin yerine West müziği çalar. Ses düzeyi: Minecraft → Müzik.")}>
        <Toggle label={tx("Oyun içinde de çal")} on={settings.musicInGame} onChange={(v) => void update({ musicInGame: v })} />
      </Row>
    </Group>
  );
}

const RES_PRESETS: [number, number][] = [[854, 480], [1280, 720], [1600, 900], [1920, 1080], [2560, 1440]];

function GameTab() {
  const { settings, update } = useSettings();
  const g = settings.game;
  const setG = (patch: Partial<GameDefaults>) => void update({ game: { ...g, ...patch } });
  const res = g.resolution;
  const preset = res ? RES_PRESETS.findIndex(([w, h]) => w === res[0] && h === res[1]) : -1;
  const pickBackup = async () => {
    const p = await openDialog({ directory: true, multiple: false });
    if (typeof p === "string") void update({ backupDir: p });
  };
  return (
    <>
      <Group title={tx("Varsayılanlar")}>
        <Row title={tx("Pencere boyutu")} desc={tx("Instance'ın kendi ayarı yoksa oyun bu boyutta açılır.")}>
          <div className="row" style={{ gap: 6 }}>
            <select className="set-select" value={res ? (preset >= 0 ? String(preset) : "custom") : "auto"} onChange={(e) => {
              const v = e.target.value;
              if (v === "auto") setG({ resolution: null });
              else if (v === "custom") setG({ resolution: res ?? [1280, 720] });
              else setG({ resolution: RES_PRESETS[Number(v)] });
            }}>
              <option value="auto">{tx("Minecraft varsayılanı")}</option>
              {RES_PRESETS.map(([w, h], i) => <option key={i} value={i}>{w} × {h}</option>)}
              <option value="custom">{tx("Özel")}</option>
            </select>
            {res && preset < 0 && <>
              <input className="set-input set-num" type="number" min={320} max={7680} value={res[0]} onChange={(e) => setG({ resolution: [Number(e.target.value) || 854, res[1]] })} />
              <span className="muted">×</span>
              <input className="set-input set-num" type="number" min={240} max={4320} value={res[1]} onChange={(e) => setG({ resolution: [res[0], Number(e.target.value) || 480] })} />
            </>}
          </div>
        </Row>
        <Row title={tx("Tam ekran başlat")} desc={tx("Oyun doğrudan tam ekran açılır (F11 ile değiştirilebilir).")}>
          <Toggle label={tx("Tam ekran başlat")} on={g.fullscreen} onChange={(fullscreen) => setG({ fullscreen })} />
        </Row>
        <Row title={tx("West Companion")} desc={tx("Oyun içi West menüsü (Sağ Shift), düzenlenebilir HUD ve FullBright. Fabric 26.2 ve 1.21.11.")}>
          <Toggle label={tx("West Companion")} on={settings.companionEnabled} onChange={(v) => void update({ companionEnabled: v })} />
        </Row>
      </Group>

      <Group title={tx("Dünya yedekleri")}>
        <Row title={tx("Dünyaları yedekle")} desc={tx("Oyundan çıkınca dünyaların otomatik yedeklenir.")}>
          <Toggle label={tx("Dünyaları yedekle")} on={settings.backupOnExit} onChange={(v) => void update({ backupOnExit: v })} />
        </Row>
        <Row title={tx("Saklanacak yedek")} desc={tx("Her dünya için en son {0} yedek tutulur; eskiler silinir.", settings.backupKeep)}>
          <input className="set-range" type="range" min={1} max={50} value={settings.backupKeep} onChange={(e) => void update({ backupKeep: Number(e.target.value) })} />
        </Row>
        <Row title={tx("Yedek klasörü")} desc={settings.backupDir ?? tx("Varsayılan (West Client veri klasörü)")}>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => void pickBackup()}><FolderOpen size={14} /> {tx("Seç")}</button>
            {settings.backupDir && <button className="btn btn-ghost btn-sm" onClick={() => void update({ backupDir: null })}><RotateCcw size={14} /> {tx("Varsayılan")}</button>}
          </div>
        </Row>
      </Group>
    </>
  );
}

/** Tırnakları koruyarak argüman listesine çevir (Rust'taki ayrıştırıcıyla aynı kural) */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = "", q: string | null = null, any = false;
  for (const c of s) {
    if (q) { if (c === q) q = null; else cur += c; }
    else if (c === '"' || c === "'") { q = c; any = true; }
    else if (/\s/.test(c)) { if (cur || any) { out.push(cur); cur = ""; any = false; } }
    else cur += c;
  }
  if (cur || any) out.push(cur);
  return out;
}
const joinArgs = (a: string[]) => a.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");

function JavaTab() {
  const { settings, update } = useSettings();
  const [hw, setHw] = useState<Hardware | null>(null);
  const [javas, setJavas] = useState<JavaInstall[]>([]);
  const [installing, setInstalling] = useState<number | null>(null);
  const [jvm, setJvm] = useState(joinArgs(settings.game.jvmArgs));
  const load = () => api.listJava().then((j) => setJavas(j ?? [])).catch(() => {});
  useEffect(() => {
    if (!isTauri()) return;
    void api.getHardware().then(setHw);
    void load();
  }, []);
  const total = hw?.totalMemoryMb ?? 16384;
  const maxMem = Math.max(2048, Math.floor((total - 1024) / 512) * 512);
  const mem = settings.defaultMemoryMb;

  return (
    <>
      <Group title={tx("Bellek")}>
        <Row title={tx("Varsayılan bellek")} desc={mem ? tx("{0} GB · instance'ın kendi ayarı yoksa", (mem / 1024).toFixed(1)) : tx("Otomatik: donanımına ve mod sayısına göre seçilir")}>
          <div className="row" style={{ gap: 10 }}>
            <label className="check tiny"><input type="checkbox" checked={mem === null} onChange={(e) => void update({ defaultMemoryMb: e.target.checked ? null : 4096 })} /> {tx("Otomatik")}</label>
            {mem !== null && <input className="set-range" type="range" min={1024} max={maxMem} step={512} value={Math.min(mem, maxMem)} onChange={(e) => void update({ defaultMemoryMb: Number(e.target.value) })} />}
          </div>
        </Row>
        <Row title={tx("JVM argümanları")} desc={tx("Tüm instance'lara eklenir (ör. -XX:+UseZGC). Instance'ın kendi argümanları bunlardan sonra gelir.")}>
          <input className="set-input set-wide" spellCheck={false} placeholder="-XX:+UseZGC -Dfoo=bar" value={jvm} onChange={(e) => setJvm(e.target.value)} onBlur={() => void update({ game: { ...settings.game, jvmArgs: splitArgs(jvm) } })} />
        </Row>
      </Group>

      <Group title={tx("Java")}>
        <Row title={tx("Java'yı otomatik kur")} desc={tx("Her Minecraft sürümüne gereken Java kendiliğinden indirilir. Açık bırakman önerilir.")}>
          <Toggle label={tx("Java'yı otomatik kur")} on={settings.autoJava} onChange={(v) => void update({ autoJava: v })} />
        </Row>
        {[8, 17, 21, 25].map((m) => {
          const found = javas.find((j) => j.major === m);
          return (
            <Row key={m} title={<>{tx("Java")} {m} {found && <Check size={14} className="ok-ico" />}</>} desc={found ? `${found.version} · ${found.managed ? tx("West Client kurdu") : tx("sistemde bulundu")}` : m === 25 ? tx("26.x için") : m === 21 ? tx("1.20.5 ve üstü için") : m === 17 ? tx("1.18 – 1.20.4 için") : tx("1.16.5 ve öncesi için")}>
              {!found && (
                <button className="btn btn-ghost btn-sm" disabled={installing !== null} onClick={async () => { setInstalling(m); try { await api.installJava(m); await load(); } finally { setInstalling(null); } }}>
                  {installing === m ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {tx("Kur")}
                </button>
              )}
            </Row>
          );
        })}
      </Group>
      {hw && <p className="set-hw"><Cpu size={14} /> {hw.cpuBrand} · {hw.logicalCores} {tx("çekirdek ·")} {(hw.totalMemoryMb / 1024).toFixed(1)} {tx("GB RAM")}</p>}
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

function LaunchTab() {
  const { settings, update } = useSettings();
  const g = settings.game;
  const [d, setD] = useState({ preLaunch: g.preLaunch, postExit: g.postExit, wrapper: g.wrapper });
  const save = () => void update({ game: { ...g, ...d } });
  return (
    <>
      <Group>
        <Row title={tx("Başlatma öncesi komut")} desc={tx("Oyun açılmadan çalışır ve bitmesi beklenir; hata dönerse oyun açılmaz.")}>
          <input className="set-input set-wide" spellCheck={false} placeholder={tx("ör. yedekle.sh")} value={d.preLaunch} onChange={(e) => setD({ ...d, preLaunch: e.target.value })} onBlur={save} />
        </Row>
        <Row title={tx("Oyun sonrası komut")} desc={tx("Oyun kapandıktan sonra çalışır.")}>
          <input className="set-input set-wide" spellCheck={false} placeholder={tx("ör. bildirim gönder")} value={d.postExit} onChange={(e) => setD({ ...d, postExit: e.target.value })} onBlur={save} />
        </Row>
        <Row title={tx("Sarmalayıcı komut")} desc={tx("Java'yı bu komutla başlatır (Linux'ta gamemoderun, prime-run, mangohud gibi).")}>
          <input className="set-input set-wide" spellCheck={false} placeholder="gamemoderun" value={d.wrapper} onChange={(e) => setD({ ...d, wrapper: e.target.value })} onBlur={save} />
        </Row>
      </Group>
      <div className="set-help">
        <strong>{tx("Kullanılabilen değişkenler")}</strong>
        <ul>
          <li><code>$INST_NAME</code> {tx("instance adı")}</li>
          <li><code>$INST_ID</code> {tx("instance kimliği")}</li>
          <li><code>$INST_DIR</code> {tx("instance klasörü")}</li>
          <li><code>$INST_MC_DIR</code> {tx("oyun klasörü (.minecraft)")}</li>
          <li><code>$INST_JAVA</code> {tx("kullanılan Java")}</li>
          <li><code>$INST_MC_VERSION</code> {tx("Minecraft sürümü")}</li>
        </ul>
        <span className="muted tiny">{tx("Windows'ta %INST_NAME% biçiminde yazılır. Komutlar senin hesabınla çalışır; yalnızca güvendiğin komutları yaz.")}</span>
      </div>
    </>
  );
}

function DownloadsTab() {
  const { settings, update } = useSettings();
  const [size, setSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => { if (isTauri()) api.cacheSize().then(setSize).catch(() => setSize(null)); };
  useEffect(load, []);
  const fmt = (b: number) => (b > 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);
  return (
    <>
      <Group>
        <Row title={tx("Aynı anda indirme")} desc={tx("{0} dosya. İnternetin yavaşsa düşür.", settings.maxConcurrentDownloads)}>
          <input className="set-range" type="range" min={4} max={64} value={settings.maxConcurrentDownloads} onChange={(e) => void update({ maxConcurrentDownloads: Number(e.target.value) })} />
        </Row>
        <Row title={tx("İndirme önbelleği")} desc={size === null ? tx("Hesaplanıyor…") : tx("{0} · sürüm listeleri ve geçici indirmeler. Instance'ların ve oyun dosyaların etkilenmez.", fmt(size))}>
          <button className="btn btn-ghost btn-sm" disabled={busy || !size} onClick={async () => { setBusy(true); try { await api.clearCache(); load(); } finally { setBusy(false); } }}>
            {busy ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} {tx("Temizle")}
          </button>
        </Row>
      </Group>
    </>
  );
}

function UpdatesTab() {
  const { settings, update } = useSettings();
  const { status, check, checking, setOpen, error } = useUpdate();
  const info = status?.info;
  return (
    <Group>
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
  );
}

function AdvancedTab() {
  const { settings, update, replace } = useSettings();
  const [dir, setDir] = useState<string | null>(null);
  useEffect(() => { if (isTauri()) api.getDataDir().then(setDir).catch(() => {}); }, []);
  const reset = async () => {
    if (!(await askConfirm(tx("Tüm ayarlar varsayılana dönsün mü? Instance'ların, hesapların ve dünyaların etkilenmez."), { confirmLabel: tx("Sıfırla") }))) return;
    replace(await api.resetSettings());
  };
  return (
    <>
      <Group>
        <Row title={tx("Veri klasörü")} desc={dir ?? "…"}>
          <button className="btn btn-ghost btn-sm" disabled={!dir} onClick={() => dir && void api.openPath(dir)}><FolderOpen size={14} /> {tx("Aç")}</button>
        </Row>
        <Row title={tx("Discord uygulama kimliği")} desc={tx("Boş bırak: West Client'ın kendi Discord uygulaması kullanılır.")}>
          <input className="set-input" spellCheck={false} placeholder={tx("İsteğe bağlı")} defaultValue={settings.discordClientId ?? ""} onBlur={(e) => void update({ discordClientId: e.target.value.trim() || null })} />
        </Row>
        <Row title={tx("Ayarları sıfırla")} desc={tx("Tüm ayarları varsayılana döndürür. Dil korunur.")}>
          <button className="btn btn-danger btn-sm" onClick={() => void reset()}><RotateCcw size={14} /> {tx("Sıfırla")}</button>
        </Row>
      </Group>
      <div className="set-about">
        <Info size={16} />
        <div>
          <strong>{tx("West Client")}</strong>
          <span className="muted small">{tx("Minecraft için modern launcher. Minecraft, Mojang Studios'un tescilli markasıdır; West Client Mojang veya Microsoft ile bağlantılı değildir.")}</span>
        </div>
      </div>
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
    <Group>
      <Row title={tx("Launcher kilidi")} desc={has ? tx("Açık: West Client açılırken şifre soruyor.") : tx("Bilgisayarı başkasıyla paylaşıyorsan West Client açılırken şifre sorsun.")}>
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
