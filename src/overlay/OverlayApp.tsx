import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { emit } from "@tauri-apps/api/event";
import {
  Activity, Boxes, Check, Clock, Cpu, FolderOpen, Gauge, Image as ImageIcon, Keyboard, Layers, LayoutDashboard, MemoryStick,
  Palette, Power, Search, Sparkles, Sun, Undo2, X,
} from "lucide-react";
import clsx from "clsx";
import { api, events, isTauri } from "@/lib/ipc";
import { applyTheme, ACCENT_PRESETS } from "@/lib/theme";
import { LOADER_LABEL } from "@/lib/format";
import type { CompanionInfo, ContentFile, GameModes, GameStats, Instance, Settings } from "@/lib/types";
import { InstanceBanner } from "@/components/InstanceBanner";
import { ContentIcon } from "@/components/ContentIcon";
import { ConfirmHost, askConfirm } from "@/components/ConfirmDialog";
import { Logo } from "@/components/Logo";
import { BIND_LABEL, GROUPS, bindName, parseBinds, prettyKey } from "./keys";
import "./overlay.css";

type Section = "home" | "mods" | "modes" | "keys" | "perf" | "look";
const NAV: { id: Section; label: string; icon: typeof Boxes; group: string }[] = [
  { id: "home", label: "Genel bakış", icon: LayoutDashboard, group: "Oyun" },
  { id: "mods", label: "Modlar", icon: Boxes, group: "Oyun" },
  { id: "modes", label: "Oyun modları", icon: Layers, group: "Oyun" },
  { id: "keys", label: "Tuşlar", icon: Keyboard, group: "Oyun" },
  { id: "perf", label: "Performans", icon: Activity, group: "Sistem" },
  { id: "look", label: "Görünüm", icon: Palette, group: "Sistem" },
];

const THEMES: { id: Settings["overlayTheme"]; label: string }[] = [
  { id: "night", label: "Gece camı" },
  { id: "day", label: "Gün camı" },
  { id: "pixel-night", label: "Piksel gece" },
  { id: "pixel-day", label: "Piksel gün" },
];

const HOTKEYS = ["F6", "F7", "F8", "F9", "F10", "F12", "Alt+W", "Ctrl+Tab"];

/** Oyun açıkken yapılamayan işlemler oyun kapanınca uygulanır (jar dosyaları oyun tarafından kilitli). */
type Pending = { toggles: Record<string, boolean>; mode: string | null };
const PKEY = (id: string) => `west.overlay.pending.${id}`;
const loadPending = (id: string): Pending => {
  try { return { toggles: {}, mode: null, ...JSON.parse(localStorage.getItem(PKEY(id)) ?? "{}") }; } catch { return { toggles: {}, mode: null }; }
};
const savePending = (id: string, p: Pending) => { try { localStorage.setItem(PKEY(id), JSON.stringify(p)); } catch { /* yoksa bellekte kalır */ } };

const clock = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(x).padStart(2, "0")}`;
};

export function OverlayApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [section, setSection] = useState<Section>("home");
  const [openTick, setOpenTick] = useState(0);
  const [, tick] = useState(0);

  const inst = instances.find((i) => i.id === runningId) ?? null;

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    const [s, list, run] = await Promise.all([api.getSettings(), api.listInstances(), api.running()]);
    setSettings(s);
    applyTheme(s.theme);
    setInstances(list);
    const live = run[0];
    setRunningId(live?.instanceId ?? null);
    if (live) setStartedAt(Date.now() - live.uptimeSecs * 1000);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("overlay-root");
    void refresh();
    const un = events.onOverlayOpen(() => { void refresh(); setOpenTick((n) => n + 1); });
    // Oyun kapanınca bekleyen değişiklikleri uygula
    const unExit = events.onGameExit(async (x) => {
      const p = loadPending(x.instanceId);
      const on = Object.entries(p.toggles).filter(([, v]) => v).map(([k]) => k);
      const off = Object.entries(p.toggles).filter(([, v]) => !v).map(([k]) => k);
      try {
        if (p.mode) await api.applyMode(x.instanceId, p.mode);
        if (on.length) await api.setContentEnabled(x.instanceId, on, true);
        if (off.length) await api.setContentEnabled(x.instanceId, off, false);
      } finally {
        savePending(x.instanceId, { toggles: {}, mode: null });
      }
    });
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".confirm")) void api.overlayHide(); };
    window.addEventListener("keydown", esc);
    return () => { void un.then((f) => f()); void unExit.then((f) => f()); window.clearInterval(t); window.removeEventListener("keydown", esc); };
  }, [refresh]);

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch, theme: { ...settings.theme, ...(patch.theme ?? {}) } };
    setSettings(next);
    applyTheme(next.theme);
    await api.saveSettings(next);
    // Ana pencere kendi kopyasını yenilesin, yoksa sonraki kaydı bunu ezer
    void emit("settings-changed");
  };

  const theme = settings?.overlayTheme ?? "night";
  const reduce = settings?.theme.reduceMotion ?? false;
  const session = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));

  return (
    <div className={clsx("ov", `ov-${theme}`, reduce && "ov-still")} onMouseDown={(e) => { if (e.target === e.currentTarget) void api.overlayHide(); }}>
      <motion.div key={openTick} className="ov-panel" initial={reduce ? false : { opacity: 0, scale: 0.97, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 420, damping: 34 }}>
        <aside className="ov-side">
          <div className="ov-brand"><Logo size={26} /><span>West<b>Overlay</b></span></div>
          {["Oyun", "Sistem"].map((g) => (
            <div key={g} className="ov-navgroup">
              <span className="ov-navlabel">{g}</span>
              {NAV.filter((n) => n.group === g).map((n) => (
                <button key={n.id} className={clsx("ov-nav", section === n.id && "on")} onClick={() => setSection(n.id)}>
                  <n.icon size={17} /> <span className="ov-nav-text">{n.label}</span>
                  {section === n.id && <motion.span layoutId="ov-nav-glow" className="ov-nav-glow" />}
                </button>
              ))}
            </div>
          ))}
          <div className="ov-side-foot">
            {inst ? (
              <>
                <span className="ov-live" />
                <div className="grow">
                  <strong className="truncate">{inst.name}</strong>
                  <span>{LOADER_LABEL[inst.loader.kind]} {inst.mcVersion} · {clock(session)}</span>
                </div>
              </>
            ) : <span className="ov-muted">Çalışan oyun yok</span>}
          </div>
        </aside>

        <main className="ov-main">
          <header className="ov-head">
            <h1>{NAV.find((n) => n.id === section)!.label}</h1>
            <span className="ov-hint"><kbd>{settings?.overlayHotkey ?? "F7"}</kbd> ya da <kbd>Esc</kbd> ile kapat</span>
            <button className="ov-close" onClick={() => void api.overlayHide()} aria-label="Kapat"><X size={18} /></button>
          </header>
          <div className="ov-body">
            <AnimatePresence mode="wait">
              <motion.div key={section} className="ov-section" initial={reduce ? false : { opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.16 }}>
                {!inst && section !== "look" ? (
                  <Empty />
                ) : section === "home" ? <Home inst={inst!} session={session} onGo={setSection} />
                  : section === "mods" ? <Mods inst={inst!} />
                  : section === "modes" ? <Modes inst={inst!} />
                  : section === "keys" ? <Keys inst={inst!} />
                  : section === "perf" ? <Perf inst={inst!} />
                  : <Look settings={settings} onSave={saveSettings} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </motion.div>
      <ConfirmHost />
    </div>
  );
}

function Empty() {
  return (
    <div className="ov-empty">
      <Sparkles size={28} />
      <strong>Şu an açık bir Minecraft yok</strong>
      <span>West Client'tan bir instance başlatınca bu panel o oyunu yönetir.</span>
    </div>
  );
}

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={clsx("ov-switch", on && "on")} onClick={() => onChange(!on)}><span /></button>;
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("ov-card", className)}>{children}</div>;
}

// ───────── Genel bakış ─────────

function Home({ inst, session, onGo }: { inst: Instance; session: number; onGo: (s: Section) => void }) {
  const [comp, setComp] = useState<CompanionInfo | null>(null);
  const [stats, setStats] = useState<GameStats | null>(null);
  const [mods, setMods] = useState<ContentFile[]>([]);
  useEffect(() => {
    api.getCompanion(inst.id).then(setComp).catch(() => setComp(null));
    api.listContent(inst.id).then(setMods).catch(() => setMods([]));
    const poll = () => api.gameStats(inst.id).then(setStats).catch(() => {});
    void poll();
    const t = window.setInterval(poll, 2000);
    return () => window.clearInterval(t);
  }, [inst.id]);
  const setC = (patch: Partial<CompanionInfo["config"]>) => {
    if (!comp) return;
    const config = { ...comp.config, ...patch };
    setComp({ ...comp, config });
    void api.setCompanionConfig(inst.id, config);
  };
  const active = mods.filter((m) => m.enabled && !m.managed).length;

  return (
    <div className="ov-grid">
      <Card className="ov-hero">
        <InstanceBanner instance={inst} className="ov-hero-art" wide />
        <div className="ov-hero-shade" />
        <div className="ov-hero-text">
          <span className="ov-chip"><span className="ov-live" /> Oynanıyor</span>
          <h2>{inst.name}</h2>
          <span>{LOADER_LABEL[inst.loader.kind]} {inst.mcVersion} · <Clock size={13} /> {clock(session)}</span>
        </div>
        <button className="ov-btn danger ov-hero-stop" onClick={async () => { if (await askConfirm(`"${inst.name}" kapatılsın mı? Kaydedilmemiş ilerleme kaybolabilir.`, { confirmLabel: "Oyunu kapat" })) void api.kill(inst.id); }}>
          <Power size={15} /> Oyunu kapat
        </button>
      </Card>

      <Card className="ov-stat" >
        <Cpu size={18} /><div><span>İşlemci</span><strong>%{Math.round(stats?.cpu ?? 0)}</strong></div>
      </Card>
      <Card className="ov-stat">
        <MemoryStick size={18} /><div><span>Bellek</span><strong>{stats ? `${(stats.memoryMb / 1024).toFixed(1)} GB` : "…"}</strong></div>
      </Card>
      <Card className="ov-stat clickable" >
        <button className="ov-stat-btn" onClick={() => onGo("mods")}><Boxes size={18} /><div><span>Açık mod</span><strong>{active}</strong></div></button>
      </Card>

      <Card className="ov-wide">
        <h3><Sparkles size={15} /> Hızlı ayarlar</h3>
        {comp?.compatible && comp.enabled ? (
          <>
            <div className="ov-row"><div><strong><Sun size={14} /> FullBright</strong><span>Mağarada bile her yer aydınlık. Anında uygulanır.</span></div><Toggle label="FullBright" on={comp.config.fullbright} onChange={(v) => setC({ fullbright: v })} /></div>
            <div className="ov-row"><div><strong><Gauge size={14} /> FPS göstergesi</strong><span>Oyunun köşesinde FPS, gecikme ve bellek.</span></div><Toggle label="FPS göstergesi" on={comp.config.fpsOverlay} onChange={(v) => setC({ fpsOverlay: v })} /></div>
          </>
        ) : (
          <p className="ov-muted">Oyun içi FullBright ve FPS göstergesi West Companion moduyla çalışır. Bu sürüm için Companion henüz yok; overlay'in diğer her özelliği yine çalışır.</p>
        )}
      </Card>

      <Card className="ov-wide">
        <h3><FolderOpen size={15} /> Kısayollar</h3>
        <div className="ov-actions">
          <button className="ov-btn" onClick={async () => api.openPath(await api.screenshotsFolder(inst.id))}><ImageIcon size={15} /> Ekran görüntüleri</button>
          <button className="ov-btn" onClick={async () => api.openPath(await api.instancePath(inst.id))}><FolderOpen size={15} /> Instance klasörü</button>
          <button className="ov-btn" onClick={() => onGo("modes")}><Layers size={15} /> Oyun modları</button>
          <button className="ov-btn" onClick={() => onGo("keys")}><Keyboard size={15} /> Tuşlar</button>
        </div>
      </Card>
    </div>
  );
}

// ───────── Modlar ─────────

type ModFilter = "all" | "on" | "off" | "mod" | "resourcepack" | "shader";

function Mods({ inst }: { inst: Instance }) {
  const [items, setItems] = useState<ContentFile[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ModFilter>("all");
  const [pending, setPending] = useState<Pending>(() => loadPending(inst.id));
  useEffect(() => { api.listContent(inst.id).then(setItems).catch(() => setItems([])); setPending(loadPending(inst.id)); }, [inst.id]);

  const effective = (c: ContentFile) => pending.toggles[c.id] ?? c.enabled;
  const view = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (items ?? [])
      .filter((c) => !c.managed)
      .filter((c) => !n || c.title.toLowerCase().includes(n) || (c.author ?? "").toLowerCase().includes(n))
      .filter((c) => filter === "all" || (filter === "on" ? effective(c) : filter === "off" ? !effective(c) : c.kind === filter))
      .sort((a, b) => a.title.localeCompare(b.title, "tr"));
  }, [items, q, filter, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (c: ContentFile, v: boolean) => {
    const toggles = { ...pending.toggles };
    if (v === c.enabled) delete toggles[c.id]; else toggles[c.id] = v;
    const next = { ...pending, toggles };
    setPending(next);
    savePending(inst.id, next);
  };
  const changes = Object.keys(pending.toggles).length;
  const chips: [ModFilter, string][] = [["all", "Hepsi"], ["on", "Açık"], ["off", "Kapalı"], ["mod", "Modlar"], ["resourcepack", "Resource pack"], ["shader", "Shader"]];

  return (
    <div className="ov-stack">
      <div className="ov-toolbar">
        <label className="ov-search"><Search size={15} /><input value={q} placeholder={`${(items ?? []).filter((c) => !c.managed).length} içerik içinde ara…`} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="ov-chips">
        {chips.map(([id, l]) => <button key={id} className={clsx("ov-chipbtn", filter === id && "on")} onClick={() => setFilter(id)}>{l}</button>)}
      </div>
      {changes > 0 && (
        <div className="ov-note">
          <Clock size={15} />
          <span className="grow">{changes} değişiklik oyun kapanınca uygulanacak (açıkken mod dosyaları oyun tarafından kullanılıyor).</span>
          <button className="ov-btn sm" onClick={() => { const p = { ...pending, toggles: {} }; setPending(p); savePending(inst.id, p); }}><Undo2 size={13} /> Geri al</button>
        </div>
      )}
      <div className="ov-mods">
        {items === null ? <p className="ov-muted">Yükleniyor…</p> : view.map((c) => {
          const on = effective(c);
          const changed = pending.toggles[c.id] !== undefined;
          return (
            <div key={c.id} className={clsx("ov-mod", !on && "off", changed && "changed")}>
              <ContentIcon src={c.icon} title={c.title} kind={c.kind} size={46} />
              <div className="ov-mod-text">
                <strong className="truncate" title={c.title}>{c.title}</strong>
                <span className="truncate">{changed ? (on ? "Açılacak" : "Kapatılacak") : c.version ?? c.author ?? c.file}</span>
              </div>
              <Toggle label={c.title} on={on} onChange={(v) => set(c, v)} />
            </div>
          );
        })}
        {items && view.length === 0 && <p className="ov-muted">Eşleşen içerik yok.</p>}
      </div>
    </div>
  );
}

// ───────── Oyun modları ─────────

function Modes({ inst }: { inst: Instance }) {
  const [data, setData] = useState<GameModes | null>(null);
  const [pending, setPending] = useState<Pending>(() => loadPending(inst.id));
  useEffect(() => { api.listModes(inst.id).then(setData).catch(() => setData({ modes: [], active: null })); setPending(loadPending(inst.id)); }, [inst.id]);
  const choose = (id: string | null) => {
    const next = { ...pending, mode: id };
    setPending(next);
    savePending(inst.id, next);
  };
  if (!data) return null;
  if (!data.modes.length) return (
    <div className="ov-empty">
      <Layers size={28} />
      <strong>Henüz oyun modun yok</strong>
      <span>Build ve PvP gibi farklı mod ve tuş düzenleri oluşturmak için West Client'ta instance'ın İçerik sekmesinde "Mod oluştur" de.</span>
    </div>
  );
  return (
    <div className="ov-stack">
      <p className="ov-muted">Seçtiğin mod oyun kapanınca uygulanır; bir sonraki açılışta o düzenle başlarsın.</p>
      <div className="ov-modes">
        {data.modes.map((m) => {
          const active = data.active === m.id;
          const queued = pending.mode === m.id;
          return (
            <button key={m.id} className={clsx("ov-modecard", active && "active", queued && "queued")} onClick={() => choose(queued ? null : m.id)}>
              <span className="ov-mode-ico">{m.icon}</span>
              <strong>{m.name}</strong>
              <span>{m.enabled.length} açık · {m.disabled.length} kapalı{m.hasOptions ? " · tuşlar dahil" : ""}</span>
              <span className="ov-mode-badge">{queued ? <><Clock size={12} /> Çıkışta geçilecek</> : active ? <><Check size={12} /> Şu an</> : "Seç"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ───────── Tuşlar ─────────

function Keys({ inst }: { inst: Instance }) {
  const [binds, setBinds] = useState<{ id: string; value: string }[] | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.readInstanceText(inst.id, "options.txt").then((t) => setBinds(parseBinds(t))).catch(() => { setBinds([]); setErr("options.txt henüz yok; oyunu bir kez açıp kapatınca tuşlar burada görünür."); });
  }, [inst.id]);
  const groups = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = (binds ?? []).filter((b) => !n || bindName(b.id).toLowerCase().includes(n) || prettyKey(b.value).toLowerCase().includes(n));
    const used = new Set<string>();
    return GROUPS.map((g) => {
      const items = list.filter((b) => !used.has(b.id) && (g.id === "mods" ? !BIND_LABEL[b.id] : g.test(b.id) && !!BIND_LABEL[b.id]));
      items.forEach((b) => used.add(b.id));
      return { ...g, items };
    }).filter((g) => g.items.length);
  }, [binds, q]);
  const dupes = useMemo(() => {
    const c = new Map<string, number>();
    for (const b of binds ?? []) if (b.value !== "key.keyboard.unknown") c.set(b.value, (c.get(b.value) ?? 0) + 1);
    return c;
  }, [binds]);

  return (
    <div className="ov-stack">
      <div className="ov-toolbar">
        <label className="ov-search"><Search size={15} /><input value={q} placeholder="Tuş ya da eylem ara…" onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <p className="ov-muted">Değiştirmek için oyunda Seçenekler → Kontroller'i kullan. Aynı tuşa bağlı eylemler turuncu işaretlenir. Build/PvP gibi düzenler arasında Oyun modları ile geçebilirsin.</p>
      {err && <p className="ov-muted">{err}</p>}
      {groups.map((g) => (
        <Card key={g.id}>
          <h3>{g.label}</h3>
          <div className="ov-keys">
            {g.items.map((b) => (
              <div key={b.id} className={clsx("ov-key", (dupes.get(b.value) ?? 0) > 1 && "dupe")}>
                <span className="truncate" title={b.id}>{bindName(b.id)}</span>
                <kbd>{prettyKey(b.value)}</kbd>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ───────── Performans ─────────

function Spark({ data, max, label }: { data: number[]; max: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = w * dpr; cv.height = h * dpr; ctx.scale(dpr, dpr);
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().split(/\s+/).join(",");
    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const x = (i: number) => (i / (60 - 1)) * w;
    const y = (v: number) => h - 4 - (Math.min(v, max) / max) * (h - 10);
    const start = 60 - data.length;
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(start + i), y(v)) : ctx.moveTo(x(start + i), y(v))));
    ctx.strokeStyle = `rgb(${accent})`; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    ctx.lineTo(x(59), h); ctx.lineTo(x(start), h); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgba(${accent},0.35)`); g.addColorStop(1, `rgba(${accent},0)`);
    ctx.fillStyle = g; ctx.fill();
  }, [data, max]);
  return <canvas ref={ref} className="ov-spark" aria-label={label} />;
}

function Perf({ inst }: { inst: Instance }) {
  const [cpu, setCpu] = useState<number[]>([]);
  const [mem, setMem] = useState<number[]>([]);
  const [last, setLast] = useState<GameStats | null>(null);
  useEffect(() => {
    const poll = () => api.gameStats(inst.id).then((s) => {
      setLast(s);
      setCpu((a) => [...a.slice(-59), s.cpu]);
      setMem((a) => [...a.slice(-59), s.memoryMb]);
    }).catch(() => {});
    void poll();
    const t = window.setInterval(poll, 1000);
    return () => window.clearInterval(t);
  }, [inst.id]);
  const memMax = Math.max(1024, ...(mem.length ? mem : [0])) * 1.2;
  const sysPct = last ? Math.round((last.systemUsedMb / Math.max(1, last.systemTotalMb)) * 100) : 0;
  return (
    <div className="ov-grid">
      <Card className="ov-wide">
        <div className="ov-perf-head"><h3><Cpu size={15} /> Oyunun işlemci kullanımı</h3><strong>%{Math.round(last?.cpu ?? 0)}</strong></div>
        <Spark data={cpu} max={100} label="İşlemci" />
      </Card>
      <Card className="ov-wide">
        <div className="ov-perf-head"><h3><MemoryStick size={15} /> Oyunun belleği</h3><strong>{last ? `${(last.memoryMb / 1024).toFixed(2)} GB` : "…"}</strong></div>
        <Spark data={mem} max={memMax} label="Bellek" />
      </Card>
      <Card className="ov-wide">
        <div className="ov-perf-head"><h3>Bilgisayarın belleği</h3><strong>{last ? `${(last.systemUsedMb / 1024).toFixed(1)} / ${(last.systemTotalMb / 1024).toFixed(1)} GB` : "…"}</strong></div>
        <div className="ov-bar"><div style={{ width: `${sysPct}%` }} className={clsx(sysPct > 88 && "hot")} /></div>
        <p className="ov-muted">{sysPct > 88 ? "Bellek neredeyse dolu; arka plandaki uygulamaları kapatmak takılmaları azaltır." : "Ayrılan bellek instance ayarlarından değiştirilebilir."} FPS, oyun içi West Companion HUD'unda görünür.</p>
      </Card>
    </div>
  );
}

// ───────── Görünüm ─────────

function Look({ settings, onSave }: { settings: Settings | null; onSave: (p: Partial<Settings>) => Promise<void> }) {
  if (!settings) return null;
  const t = settings.theme;
  return (
    <div className="ov-stack">
      <Card>
        <h3>Tema</h3>
        <div className="ov-themes">
          {THEMES.map((th) => (
            <button key={th.id} className={clsx("ov-theme", `prev-${th.id}`, settings.overlayTheme === th.id && "on")} onClick={() => void onSave({ overlayTheme: th.id })}>
              <span className="ov-theme-prev"><i /><i /><i /><i /><i /><i /></span>
              <strong>{th.label}</strong>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <div className="ov-row">
          <div><strong>Vurgu rengi</strong><span>West Client ve overlay'in ana rengi.</span></div>
          <div className="ov-swatches">
            {ACCENT_PRESETS.map((c) => (
              <button key={c} className={clsx("ov-swatch", t.accent.toLowerCase() === c && "on")} style={{ background: c }} aria-label={c} onClick={() => void onSave({ theme: { ...t, accent: c } })} />
            ))}
          </div>
        </div>
        <div className="ov-row">
          <div><strong>Animasyonlar</strong><span>Panel geçişleri ve parıltılar.</span></div>
          <Toggle label="Animasyonlar" on={!t.reduceMotion} onChange={(v) => void onSave({ theme: { ...t, reduceMotion: !v } })} />
        </div>
        <div className="ov-row">
          <div><strong>Açma kısayolu</strong><span>Oyun açıkken overlay'i bu tuş açar ve kapatır.</span></div>
          <select className="ov-select" value={settings.overlayHotkey} onChange={(e) => void onSave({ overlayHotkey: e.target.value })}>
            {(HOTKEYS.includes(settings.overlayHotkey) ? HOTKEYS : [settings.overlayHotkey, ...HOTKEYS]).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </Card>
      <p className="ov-muted">İpucu: overlay, Minecraft pencereli ya da kenarlıksız modda en iyi çalışır. Tam ekranda (F11) görünmezse oyunu pencereli moda al.</p>
    </div>
  );
}
