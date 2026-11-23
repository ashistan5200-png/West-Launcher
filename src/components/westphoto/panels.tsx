import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Layers as LayersIcon, Lock, Plus, Sparkles, SquareDashed, Trash2, Unlock, Merge, AlignLeft, AlignCenter, AlignRight, Bold, Italic } from "lucide-react";
import { tx } from "@/lib/i18n";
import { BLENDS, c2d, type Doc, type Effects, type History, type Layer, type TextData } from "./core";
import { curveLut, histogram, type Op, type Param, type Values } from "./fx";

// ── Renk ──
const SWATCHES = ["#000000", "#ffffff", "#7f7f7f", "#c0392b", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#2c3e8f", "#9b59b6", "#e84393", "#6d4c41", "#a1887f", "#5d8a3a", "#7ec850", "#4a7bd0", "#d8b26a", "#3c3c46", "#e8a33d"];
export function ColorPanel({ fg, bg, setFg, setBg }: { fg: string; bg: string; setFg: (c: string) => void; setBg: (c: string) => void }) {
  const [which, setWhich] = useState<"fg" | "bg">("fg");
  const cur = which === "fg" ? fg : bg, set = which === "fg" ? setFg : setBg;
  const [h, s, v] = hsv(cur);
  return (
    <div className="wp-color">
      <div className="wp-color-which">
        <button className={clsx(which === "fg" && "active")} onClick={() => setWhich("fg")}><i style={{ background: fg }} /> {tx("Ön plan")}</button>
        <button className={clsx(which === "bg" && "active")} onClick={() => setWhich("bg")}><i style={{ background: bg }} /> {tx("Arka plan")}</button>
      </div>
      <SvPad h={h} s={s} v={v} onChange={(ns, nv) => set(hsv2hex(h, ns, nv))} />
      <input className="wp-hue" type="range" min={0} max={359} value={Math.round(h)} onChange={(e) => set(hsv2hex(+e.target.value, s, v))} />
      <div className="wp-color-row">
        <input type="color" value={cur} onChange={(e) => set(e.target.value)} />
        <input className="wp-hex" value={cur} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && set(e.target.value.toLowerCase())} />
      </div>
      <div className="wp-swatches">{SWATCHES.map((c) => <button key={c} style={{ background: c }} onClick={() => set(c)} title={c} />)}</div>
    </div>
  );
}
function SvPad({ h, s, v, onChange }: { h: number; s: number; v: number; onChange: (s: number, v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)));
  };
  return (
    <div ref={ref} className="wp-sv" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }} onPointerMove={(e) => e.buttons & 1 && move(e)}>
      <i style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
    </div>
  );
}
function hsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}
function hsv2hex(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

// ── Geçmiş ──
export function HistoryPanel({ hist, onJump }: { hist: History; onJump: (i: number) => void }) {
  return (
    <div className="wp-history">
      {hist.items.map((it, i) => (
        <button key={i} className={clsx(i === hist.index && "active", i > hist.index && "future")} onClick={() => onJump(i)}>
          {tx(it.label)}
        </button>
      ))}
    </div>
  );
}

// ── Yazı ──
const FONTS = ["Plus Jakarta Sans", "Inter", "Arial", "Georgia", "Times New Roman", "Impact", "Verdana", "Trebuchet MS", "Courier New", "Comic Sans MS", "JetBrains Mono"];
export function TextPanel({ t, onChange }: { t: TextData; onChange: (p: Partial<TextData>, label?: string) => void }) {
  const [draft, setDraft] = useState(t.text);
  useEffect(() => setDraft(t.text), [t.text]);
  return (
    <div className="wp-text">
      <textarea value={draft} rows={3} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== t.text && onChange({ text: draft || " " })} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onChange({ text: draft || " " }); }} />
      <select value={t.font} onChange={(e) => onChange({ font: e.target.value })}>{FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}</select>
      <div className="wp-row">
        <label>{tx("Boyut")} <input type="number" min={4} max={1000} value={Math.round(t.size)} onChange={(e) => onChange({ size: Math.max(4, +e.target.value) })} /></label>
        <label>{tx("Satır")} <input type="number" min={0.6} max={3} step={0.05} value={t.lineHeight} onChange={(e) => onChange({ lineHeight: +e.target.value })} /></label>
        <input type="color" value={t.color} onChange={(e) => onChange({ color: e.target.value })} title={tx("Renk")} />
      </div>
      <div className="wp-row">
        <button className={clsx("icon-btn", t.bold && "on")} onClick={() => onChange({ bold: !t.bold })}><Bold size={14} /></button>
        <button className={clsx("icon-btn", t.italic && "on")} onClick={() => onChange({ italic: !t.italic })}><Italic size={14} /></button>
        <span className="grow" />
        {(["left", "center", "right"] as const).map((a) => {
          const I = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
          return <button key={a} className={clsx("icon-btn", t.align === a && "on")} onClick={() => onChange({ align: a })}><I size={14} /></button>;
        })}
      </div>
      <div className="wp-row">
        <label>{tx("Kontur")} <input type="number" min={0} max={40} value={t.strokeWidth} onChange={(e) => onChange({ strokeWidth: Math.max(0, +e.target.value) })} /></label>
        <input type="color" value={t.strokeColor} onChange={(e) => onChange({ strokeColor: e.target.value })} title={tx("Kontur rengi")} />
      </div>
      <p className="muted tiny">{tx("Taşı aracıyla sürükleyerek yerini değiştir. Gölge/parıltı için Katman stili.")}</p>
    </div>
  );
}

// ── Katmanlar ──
function Thumb({ c, version }: { c: HTMLCanvasElement; version: unknown }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    const k = Math.min(44 / c.width, 30 / c.height);
    t.width = Math.max(1, Math.round(c.width * k));
    t.height = Math.max(1, Math.round(c.height * k));
    const g = t.getContext("2d")!;
    g.clearRect(0, 0, t.width, t.height);
    g.drawImage(c, 0, 0, t.width, t.height);
  }, [c, version]);
  return <canvas ref={ref} className="wp-thumb" />;
}

export function LayersPanel(p: {
  doc: Doc; onSelect: (id: string, mask: boolean) => void; onPatch: (id: string, patch: Partial<Layer>, label?: string) => void;
  onAdd: () => void; onDup: () => void; onDel: () => void; onMask: () => void; onFx: () => void; onMove: (d: 1 | -1) => void; onMerge: () => void; onSelectPixels: (id: string) => void;
}) {
  const { doc } = p;
  const active = doc.layers.find((l) => l.id === doc.active)!;
  const [rename, setRename] = useState<string | null>(null);
  const [opDraft, setOpDraft] = useState<number | null>(null);
  return (
    <div className="wp-layers">
      <div className="wp-layers-head">
        <LayersIcon size={14} /> <strong>{tx("Katmanlar")}</strong>
      </div>
      <div className="wp-row">
        <select value={active.blend} onChange={(e) => p.onPatch(active.id, { blend: e.target.value as GlobalCompositeOperation }, "Karışım modu")}>
          {BLENDS.map((b) => <option key={b.id} value={b.id}>{tx(b.label)}</option>)}
        </select>
        <label className="wp-op">{tx("Opaklık")}
          <input type="range" min={0} max={100} value={opDraft ?? Math.round(active.opacity * 100)}
            onChange={(e) => { setOpDraft(+e.target.value); p.onPatch(active.id, { opacity: +e.target.value / 100 }); }}
            onPointerUp={(e) => { p.onPatch(active.id, { opacity: +(e.target as HTMLInputElement).value / 100 }, "Opaklık"); setOpDraft(null); }} />
          <span>{opDraft ?? Math.round(active.opacity * 100)}%</span>
        </label>
      </div>
      <div className="wp-layer-list">
        {[...doc.layers].reverse().map((l) => (
          <div key={l.id} className={clsx("wp-layer", l.id === doc.active && "active")} onClick={() => p.onSelect(l.id, false)}>
            <button className="wp-eye" onClick={(e) => { e.stopPropagation(); p.onPatch(l.id, { visible: !l.visible }, l.visible ? "Katmanı gizle" : "Katmanı göster"); }}>
              {l.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <span className={clsx("wp-thumbwrap", l.id === doc.active && !doc.editMask && "on")} title={tx("Ctrl+tık: pikselleri seç")} onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); p.onSelectPixels(l.id); } }}>
              {l.text ? <span className="wp-T">T</span> : <Thumb c={l.canvas} version={l.canvas} />}
            </span>
            {l.mask && (
              <span className={clsx("wp-thumbwrap mask", l.id === doc.active && doc.editMask && "on", !l.maskOn && "off")} title={tx("Maske · Shift+tık: aç/kapa")}
                onClick={(e) => { e.stopPropagation(); if (e.shiftKey) p.onPatch(l.id, { maskOn: !l.maskOn }, "Maske aç/kapa"); else p.onSelect(l.id, true); }}>
                <Thumb c={l.mask} version={l.mask} />
              </span>
            )}
            {rename === l.id ? (
              <input autoFocus defaultValue={l.name} onClick={(e) => e.stopPropagation()} onBlur={(e) => { p.onPatch(l.id, { name: e.target.value || l.name }, "Yeniden adlandır"); setRename(null); }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(null); }} />
            ) : (
              <span className="wp-lname truncate" onDoubleClick={(e) => { e.stopPropagation(); setRename(l.id); }}>{l.name}</span>
            )}
            {Object.keys(l.fx).length > 0 && <Sparkles size={12} className="muted" />}
            <button className="wp-eye" title={tx("Kilitle")} onClick={(e) => { e.stopPropagation(); p.onPatch(l.id, { locked: !l.locked }, l.locked ? "Kilidi aç" : "Kilitle"); }}>
              {l.locked ? <Lock size={12} /> : <Unlock size={12} className="faint" />}
            </button>
          </div>
        ))}
      </div>
      <div className="wp-layer-actions">
        <button title={tx("Katman stili")} onClick={p.onFx}><Sparkles size={14} /></button>
        <button title={active.mask ? tx("Maskeyi sil") : tx("Maske ekle")} onClick={p.onMask}><SquareDashed size={14} /></button>
        <button title={tx("Yukarı")} onClick={() => p.onMove(1)}><ArrowUp size={14} /></button>
        <button title={tx("Aşağı")} onClick={() => p.onMove(-1)}><ArrowDown size={14} /></button>
        <button title={tx("Aşağı birleştir")} onClick={p.onMerge}><Merge size={14} /></button>
        <button title={tx("Çoğalt")} onClick={p.onDup}><Copy size={14} /></button>
        <button title={tx("Yeni katman")} onClick={p.onAdd}><Plus size={14} /></button>
        <button title={tx("Sil")} onClick={p.onDel}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

// ── Ayarlama / filtre penceresi ──
export function OpDialog({ op, values, src, onPreview, onCancel, onApply, busy }: { op: Op; values: Values; src: HTMLCanvasElement; onPreview: (v: Values | null) => void; onCancel: () => void; onApply: (v: Values) => void; busy: boolean }) {
  const [v, setV] = useState<Values>(() => (op.special === "curves" ? { ...values, curves: JSON.stringify({ rgb: [[0, 0], [255, 255]] }) } : values));
  const [live, setLive] = useState(true);
  const t = useRef(0);
  useEffect(() => {
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => onPreview(live ? v : null), 90);
    return () => window.clearTimeout(t.current);
  }, [v, live]); // eslint-disable-line react-hooks/exhaustive-deps
  const hist = useMemo(() => (op.special ? histogram(src) : null), [op.special, src]);
  const set = (k: string, x: number | string | boolean) => setV((o) => ({ ...o, [k]: x }));
  return (
    <div className="wp-dialog-back">
      <div className="wp-dialog">
        <h3>{tx(op.label)}</h3>
        {op.special === "levels" && hist && <Histo h={hist} ch={String(v.ch)} marks={[Number(v.ib), Number(v.iw)]} />}
        {op.special === "curves" && hist && <CurveEditor h={hist} ch={String(v.ch)} value={String(v.curves)} onChange={(c) => set("curves", c)} />}
        {op.params.map((p) => <ParamRow key={p.key} p={p} v={v[p.key]} on={(x) => set(p.key, x)} />)}
        <div className="wp-dialog-foot">
          <label className="check"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> {tx("Önizleme")}</label>
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={() => setV(op.special === "curves" ? { ...values, curves: JSON.stringify({ rgb: [[0, 0], [255, 255]] }) } : values)}>{tx("Sıfırla")}</button>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>{tx("İptal")}</button>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onApply(v)}>{tx("Uygula")}</button>
        </div>
      </div>
    </div>
  );
}
function ParamRow({ p, v, on }: { p: Param; v: Values[string]; on: (x: number | string | boolean) => void }) {
  if (p.kind === "select") return <label className="wp-param"><span>{tx(p.label)}</span><select value={String(v)} onChange={(e) => on(e.target.value)}>{p.options.map((o) => <option key={o.v} value={o.v}>{tx(o.l)}</option>)}</select></label>;
  if (p.kind === "bool") return <label className="check wp-param-b"><input type="checkbox" checked={!!v} onChange={(e) => on(e.target.checked)} /> {tx(p.label)}</label>;
  if (p.kind === "color") return <label className="wp-param"><span>{tx(p.label)}</span><input type="color" value={String(v)} onChange={(e) => on(e.target.value)} /></label>;
  const step = p.step ?? 1;
  return (
    <label className="wp-param">
      <span>{tx(p.label)}</span>
      <input type="range" min={p.min} max={p.max} step={step} value={Number(v)} onChange={(e) => on(+e.target.value)} onDoubleClick={() => on(p.def)} />
      <input type="number" min={p.min} max={p.max} step={step} value={Number(v)} onChange={(e) => on(Math.min(p.max, Math.max(p.min, +e.target.value)))} />
    </label>
  );
}

function Histo({ h, ch, marks }: { h: ReturnType<typeof histogram>; ch: string; marks?: number[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, 256, 100);
    const arr = ch === "r" ? h.r : ch === "g" ? h.g : ch === "b" ? h.b : h.l;
    const mx = Math.max(...Array.from(arr).slice(2, 254), 1);
    g.fillStyle = ch === "r" ? "#e66" : ch === "g" ? "#6c6" : ch === "b" ? "#69f" : "#bbb";
    for (let i = 0; i < 256; i++) { const v = Math.min(100, (arr[i] / mx) * 100); g.fillRect(i, 100 - v, 1, v); }
    if (marks) { g.fillStyle = "#fff"; for (const m of marks) g.fillRect(m, 0, 1, 100); }
  }, [h, ch, marks]);
  return <canvas ref={ref} width={256} height={100} className="wp-histo" />;
}

function CurveEditor({ h, ch, value, onChange }: { h: ReturnType<typeof histogram>; ch: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const all = JSON.parse(value) as Record<string, [number, number][]>;
  const pts = all[ch] ?? [[0, 0], [255, 255]];
  const drag = useRef<number | null>(null);
  useEffect(() => {
    const c = ref.current!, g = c.getContext("2d")!;
    g.clearRect(0, 0, 256, 256);
    const arr = ch === "r" ? h.r : ch === "g" ? h.g : ch === "b" ? h.b : h.l;
    const mx = Math.max(...Array.from(arr).slice(2, 254), 1);
    g.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 256; i++) { const v = Math.min(256, (arr[i] / mx) * 256); g.fillRect(i, 256 - v, 1, v); }
    g.strokeStyle = "rgba(255,255,255,0.1)";
    for (let i = 64; i < 256; i += 64) { g.beginPath(); g.moveTo(i + 0.5, 0); g.lineTo(i + 0.5, 256); g.moveTo(0, i + 0.5); g.lineTo(256, i + 0.5); g.stroke(); }
    g.beginPath(); g.moveTo(0, 256); g.lineTo(256, 0); g.stroke();
    const lut = curveLut(pts);
    g.strokeStyle = ch === "r" ? "#f66" : ch === "g" ? "#6d6" : ch === "b" ? "#6af" : "#fff";
    g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x < 256; x++) { const y = 255 - lut[x]; if (x) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
    g.fillStyle = "#fff";
    for (const [x, y] of pts) { g.beginPath(); g.arc(x, 255 - y, 4, 0, Math.PI * 2); g.fill(); }
  }, [value, ch, h]); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(); return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round(255 - ((e.clientY - r.top) / r.height) * 255)].map((v) => Math.min(255, Math.max(0, v))) as [number, number]; };
  const save = (np: [number, number][]) => onChange(JSON.stringify({ ...all, [ch]: np }));
  return (
    <div className="wp-curve">
      <canvas ref={ref} width={256} height={256}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const [x, y] = pos(e);
          let i = pts.findIndex((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - y) < 12);
          if (i < 0) { const np = [...pts, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]); i = np.findIndex((p) => p[0] === x && p[1] === y); save(np); }
          drag.current = i;
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const [x, y] = pos(e), i = drag.current, np = pts.map((p) => [...p] as [number, number]);
          const lo = i > 0 ? np[i - 1][0] + 1 : 0, hi = i < np.length - 1 ? np[i + 1][0] - 1 : 255;
          np[i] = [i === 0 ? Math.min(x, hi) : i === np.length - 1 ? Math.max(x, lo) : Math.min(hi, Math.max(lo, x)), y];
          save(np);
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={(e) => { const [x] = pos(e); const i = pts.findIndex((p) => Math.abs(p[0] - x) < 8); if (i > 0 && i < pts.length - 1) save(pts.filter((_, k) => k !== i)); }}
      />
      <p className="muted tiny">{tx("Tıkla: nokta ekle · sürükle: eğriyi bük · çift tık: noktayı sil")}</p>
    </div>
  );
}

// ── Katman stili ──
export function EffectsDialog({ layer, onPreview, onDone, onCancel }: { layer: Layer; onPreview: (fx: Effects) => void; onDone: (fx: Effects, before: Effects) => void; onCancel: (before: Effects) => void }) {
  const before = useRef(layer.fx).current;
  const [fx, setFx] = useState<Effects>(layer.fx);
  useEffect(() => onPreview(fx), [fx]); // eslint-disable-line react-hooks/exhaustive-deps
  const tog = <K extends keyof Effects>(k: K, def: NonNullable<Effects[K]>) => setFx((f) => { const n = { ...f }; if (n[k]) delete n[k]; else n[k] = def; return n; });
  const upd = <K extends keyof Effects>(k: K, p: Partial<NonNullable<Effects[K]>>) => setFx((f) => ({ ...f, [k]: { ...(f[k] as object), ...p } }));
  return (
    <div className="wp-dialog-back">
      <div className="wp-dialog">
        <h3>{tx("Katman stili")} · {layer.name}</h3>
        <section className="wp-fx">
          <label className="check"><input type="checkbox" checked={!!fx.shadow} onChange={() => tog("shadow", { x: 8, y: 8, blur: 14, color: "#000000", opacity: 0.6 })} /> <b>{tx("Gölge")}</b></label>
          {fx.shadow && <>
            <FxNum label={tx("X")} v={fx.shadow.x} min={-200} max={200} on={(x) => upd("shadow", { x })} />
            <FxNum label={tx("Y")} v={fx.shadow.y} min={-200} max={200} on={(y) => upd("shadow", { y })} />
            <FxNum label={tx("Bulanıklık")} v={fx.shadow.blur} min={0} max={150} on={(blur) => upd("shadow", { blur })} />
            <FxNum label={tx("Opaklık %")} v={Math.round(fx.shadow.opacity * 100)} min={0} max={100} on={(o) => upd("shadow", { opacity: o / 100 })} />
            <input type="color" value={fx.shadow.color} onChange={(e) => upd("shadow", { color: e.target.value })} />
          </>}
        </section>
        <section className="wp-fx">
          <label className="check"><input type="checkbox" checked={!!fx.glow} onChange={() => tog("glow", { blur: 24, color: "#ffd27a", opacity: 0.8 })} /> <b>{tx("Dış parıltı")}</b></label>
          {fx.glow && <>
            <FxNum label={tx("Boyut")} v={fx.glow.blur} min={1} max={200} on={(blur) => upd("glow", { blur })} />
            <FxNum label={tx("Opaklık %")} v={Math.round(fx.glow.opacity * 100)} min={0} max={100} on={(o) => upd("glow", { opacity: o / 100 })} />
            <input type="color" value={fx.glow.color} onChange={(e) => upd("glow", { color: e.target.value })} />
          </>}
        </section>
        <section className="wp-fx">
          <label className="check"><input type="checkbox" checked={!!fx.stroke} onChange={() => tog("stroke", { width: 4, color: "#000000" })} /> <b>{tx("Kontur")}</b></label>
          {fx.stroke && <>
            <FxNum label={tx("Kalınlık")} v={fx.stroke.width} min={1} max={60} on={(width) => upd("stroke", { width })} />
            <input type="color" value={fx.stroke.color} onChange={(e) => upd("stroke", { color: e.target.value })} />
          </>}
        </section>
        <section className="wp-fx">
          <label className="check"><input type="checkbox" checked={!!fx.overlay} onChange={() => tog("overlay", { color: "#e8a33d", opacity: 0.5 })} /> <b>{tx("Renk kaplaması")}</b></label>
          {fx.overlay && <>
            <FxNum label={tx("Opaklık %")} v={Math.round(fx.overlay.opacity * 100)} min={0} max={100} on={(o) => upd("overlay", { opacity: o / 100 })} />
            <input type="color" value={fx.overlay.color} onChange={(e) => upd("overlay", { color: e.target.value })} />
          </>}
        </section>
        <div className="wp-dialog-foot">
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" onClick={() => onCancel(before)}>{tx("İptal")}</button>
          <button className="btn btn-primary btn-sm" onClick={() => onDone(fx, before)}>{tx("Tamam")}</button>
        </div>
      </div>
    </div>
  );
}
function FxNum({ label, v, min, max, on }: { label: string; v: number; min: number; max: number; on: (v: number) => void }) {
  return <label className="wp-fxnum"><span>{label}</span><input type="range" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)} /><input type="number" value={v} min={min} max={max} onChange={(e) => on(+e.target.value)} /></label>;
}

// ── Sayı penceresi ──
export interface NumField { label: string; value: number; min: number; max: number }
export function NumDialog({ title, fields, onCancel, onApply }: { title: string; fields: NumField[]; onCancel: () => void; onApply: (v: number[]) => void }) {
  const [v, setV] = useState(fields.map((f) => f.value));
  const [link, setLink] = useState(fields.length === 2);
  const ratio = fields.length === 2 ? fields[0].value / fields[1].value : 1;
  return (
    <div className="wp-dialog-back">
      <form className="wp-dialog narrow" onSubmit={(e) => { e.preventDefault(); onApply(v.map((x, i) => Math.min(fields[i].max, Math.max(fields[i].min, Math.round(x))))); }}>
        <h3>{title}</h3>
        {fields.map((f, i) => (
          <label key={i} className="wp-param">
            <span>{f.label}</span>
            <input type="number" autoFocus={i === 0} min={f.min} max={f.max} value={v[i]} onChange={(e) => {
              const x = +e.target.value, n = [...v];
              n[i] = x;
              if (link && fields.length === 2) n[1 - i] = Math.round(i === 0 ? x / ratio : x * ratio);
              setV(n);
            }} />
          </label>
        ))}
        {fields.length === 2 && <label className="check"><input type="checkbox" checked={link} onChange={(e) => setLink(e.target.checked)} /> {tx("Oranı koru")}</label>}
        <div className="wp-dialog-foot">
          <span className="grow" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{tx("İptal")}</button>
          <button className="btn btn-primary btn-sm">{tx("Tamam")}</button>
        </div>
      </form>
    </div>
  );
}
export { c2d };
