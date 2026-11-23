import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MOUSE, Raycaster, Vector2, type Intersection, type Mesh, type Object3D } from "three";
import { SkinViewer, WalkingAnimation } from "skinview3d";
import { loadSkinToCanvas } from "skinview-utils";
import clsx from "clsx";
import {
  Brush, Check, Download, Droplet, Eraser, Eye, EyeOff, FlipHorizontal2, FolderOpen, Grid3x3, Loader2, Moon, PaintBucket,
  Pipette, Play, Redo2, Save, Sparkles, Sun, Undo2, Upload, X,
} from "lucide-react";
import type { Skin } from "@/lib/types";
import { api } from "@/lib/ipc";
import { tx } from "@/lib/i18n";
import { boxes, editable, faces, locate, mirror, PARTS, type Layer, type PartId } from "./layout";

type Tool = "pencil" | "eraser" | "fill" | "picker" | "shade" | "noise";
type Rgba = [number, number, number, number];

const TOOLS: { id: Tool; icon: typeof Brush; label: string; key: string }[] = [
  { id: "pencil", icon: Brush, label: tx("Kalem"), key: "B" },
  { id: "eraser", icon: Eraser, label: tx("Silgi"), key: "E" },
  { id: "fill", icon: PaintBucket, label: tx("Kova"), key: "G" },
  { id: "picker", icon: Pipette, label: tx("Damlalık"), key: "I" },
  { id: "shade", icon: Moon, label: tx("Gölgelendir / aydınlat"), key: "S" },
  { id: "noise", icon: Sparkles, label: tx("Doku fırçası"), key: "N" },
];

const PRESETS = [
  "#f9d3b4", "#e8b48f", "#c68863", "#a0663f", "#6f4426", "#3e2414",
  "#ffffff", "#c8c8c8", "#8a8a8a", "#4a4a4a", "#1e1e1e", "#000000",
  "#e63946", "#f77f00", "#fcbf49", "#90be6d", "#2a9d8f", "#3a86ff",
  "#5e60ce", "#9d4edd", "#ff70a6", "#7b2cbf", "#264653", "#6a4c93",
];

const PART_LABEL: Record<PartId, string> = {
  head: tx("Kafa"), body: tx("Gövde"), rightArm: tx("Sağ kol"), leftArm: tx("Sol kol"), rightLeg: tx("Sağ bacak"), leftLeg: tx("Sol bacak"),
};

const hex = (c: Rgba) => "#" + c.slice(0, 3).map((n) => n.toString(16).padStart(2, "0")).join("");
const parseHex = (h: string): Rgba => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const SZ = 64;

interface Props {
  initial: Skin | null;
  onClose: () => void;
  onSaved: (skin: Skin, apply: boolean) => void;
}

/**
 * West Skin Editörü: 64×64 skin dokusunu hem 3D model üzerinde hem düz dokuda boyar. Sol tık boyar
 * (modelin dışında döndürür), sağ tık her zaman döndürür, tekerlek yakınlaştırır.
 */
export default function SkinEditor({ initial, onClose, onSaved }: Props) {
  const tex = useMemo(() => { const c = document.createElement("canvas"); c.width = SZ; c.height = SZ; return c; }, []);
  const ctx = useMemo(() => tex.getContext("2d", { willReadFrequently: true })!, [tex]);
  const view3d = useRef<HTMLCanvasElement>(null);
  const flat = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState<Rgba>([58, 134, 255, 255]);
  const [recent, setRecent] = useState<string[]>([]);
  const [size, setSize] = useState(1);
  const [noise, setNoise] = useState(18);
  const [shadeMode, setShadeMode] = useState<"dark" | "light">("dark");
  const [mirrorOn, setMirrorOn] = useState(false);
  const [layer, setLayer] = useState<Layer>("inner");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [slim, setSlim] = useState(initial?.slim ?? false);
  const [name, setName] = useState(initial ? `${initial.name} (düzenlenmiş)`.slice(0, 40) : tx("Benim skinim"));
  const [grid, setGrid] = useState(true);
  const [walk, setWalk] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState<null | "save" | "apply">(null);
  const [err, setErr] = useState<string | null>(null);
  const [, bump] = useState(0);

  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const stroke = useRef<{ seen: Set<number> } | null>(null);
  const st = useRef({ tool, color, size, noise, shadeMode, mirrorOn, layer, hidden, slim });
  st.current = { tool, color, size, noise, shadeMode, mirrorOn, layer, hidden, slim };

  // ── çizim yüzeyleri ──
  const redraw2d = useCallback(() => {
    const c = flat.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const z = c.width / SZ;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    for (let y = 0; y < SZ; y++) for (let x = 0; x < SZ; x++) {
      g.fillStyle = (x + y) % 2 ? "#2b2b33" : "#24242b";
      g.fillRect(x * z, y * z, z, z);
    }
    const { slim: s, hidden: hid, layer: ly } = st.current;
    for (const b of boxes(s)) {
      const off = hid.has(b.part) || hid.has(b.layer);
      for (const r of Object.values(faces(b))) {
        g.fillStyle = b.layer === ly ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.015)";
        g.fillRect(r.x * z, r.y * z, r.w * z, r.h * z);
        g.save();
        g.beginPath();
        g.rect(r.x * z, r.y * z, r.w * z, r.h * z);
        g.clip();
        g.globalAlpha = off ? 0.18 : 1;
        g.drawImage(tex, r.x, r.y, r.w, r.h, r.x * z, r.y * z, r.w * z, r.h * z);
        g.restore();
      }
    }
    if (grid && z >= 5) {
      g.strokeStyle = "rgba(255,255,255,0.06)";
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 1; i < SZ; i++) {
        g.moveTo(i * z + 0.5, 0); g.lineTo(i * z + 0.5, c.height);
        g.moveTo(0, i * z + 0.5); g.lineTo(c.width, i * z + 0.5);
      }
      g.stroke();
    }
    g.strokeStyle = "rgba(255,255,255,0.22)";
    for (const b of boxes(s)) for (const r of Object.values(faces(b))) g.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1);
    if (hoverRef.current) {
      const { x, y } = hoverRef.current;
      const k = st.current.size;
      const o = Math.floor((k - 1) / 2);
      g.strokeStyle = "#fff";
      g.lineWidth = 2;
      g.strokeRect((x - o) * z + 1, (y - o) * z + 1, k * z - 2, k * z - 2);
    }
  }, [grid, tex]); // eslint-disable-line react-hooks/exhaustive-deps
  const hoverRef = useRef<{ x: number; y: number } | null>(null);

  const sync3d = useCallback(() => {
    const v = viewer.current;
    if (!v) return;
    const g = v.skinCanvas.getContext("2d")!;
    if (v.skinCanvas.width !== SZ) { v.loadSkin(tex, { model: st.current.slim ? "slim" : "default" }); return; }
    g.clearRect(0, 0, SZ, SZ);
    g.drawImage(tex, 0, 0);
    const t = (v as unknown as { skinTexture: { needsUpdate: boolean } | null }).skinTexture;
    if (t) t.needsUpdate = true;
  }, [tex]);

  const refresh = useCallback(() => { redraw2d(); sync3d(); }, [redraw2d, sync3d]);

  // ── başlangıç dokusu ──
  const loadFrom = useCallback(async (src: string | null, kind: "skin" | "blank" | "clear") => {
    ctx.clearRect(0, 0, SZ, SZ);
    if (kind === "skin" && src) {
      const img = new Image();
      img.src = src;
      await img.decode().catch(() => undefined);
      const tmp = document.createElement("canvas");
      loadSkinToCanvas(tmp, img); // 64×32 eski skinleri de 64×64'e çevirir
      ctx.drawImage(tmp, 0, 0, SZ, SZ);
    } else if (kind === "blank") {
      for (const b of boxes(st.current.slim)) if (b.layer === "inner") for (const r of Object.values(faces(b))) {
        const base = b.part === "head" ? "#c68863" : b.part === "body" ? "#3a86ff" : b.part.endsWith("Arm") ? "#c68863" : "#264653";
        ctx.fillStyle = base;
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    refresh();
  }, [ctx, refresh]);

  // ── 3D görünüm ──
  useEffect(() => {
    if (!view3d.current) return;
    let v: SkinViewer;
    try {
      v = new SkinViewer({ canvas: view3d.current, width: 420, height: 520, pixelRatio: "match-device", fov: 38, zoom: 0.68 });
    } catch {
      return;
    }
    v.controls.enablePan = false;
    v.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE };
    v.globalLight.intensity = 2.6;
    v.cameraLight.intensity = 0.9;
    v.animation = null;
    v.playerWrapper.rotation.y = -0.45;
    viewer.current = v;
    void loadFrom(initial?.dataUrl ?? null, initial ? "skin" : "blank").then(() => v.loadSkin(tex, { model: st.current.slim ? "slim" : "default" }));
    const fit = () => {
      const el = view3d.current?.parentElement;
      if (el) v.setSize(el.clientWidth, el.clientHeight);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (view3d.current.parentElement) ro.observe(view3d.current.parentElement);
    return () => { ro.disconnect(); v.dispose(); viewer.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { viewer.current?.loadSkin(tex, { model: slim ? "slim" : "default" }); redraw2d(); }, [slim]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (viewer.current) viewer.current.animation = walk ? new WalkingAnimation() : null; if (!walk && viewer.current) resetPose(viewer.current); }, [walk]);
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    for (const p of PARTS) {
      v.playerObject.skin[p].innerLayer.visible = !hidden.has(p) && !hidden.has("inner");
      v.playerObject.skin[p].outerLayer.visible = !hidden.has(p) && !hidden.has("outer");
    }
    redraw2d();
  }, [hidden, redraw2d]);
  useEffect(() => redraw2d(), [layer, grid, redraw2d]);

  // ── piksel işlemleri ──
  const get = (d: ImageData, x: number, y: number): Rgba => { const i = (y * SZ + x) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2], d.data[i + 3]]; };
  const put = (d: ImageData, x: number, y: number, c: Rgba) => { const i = (y * SZ + x) * 4; d.data.set(c, i); };

  const begin = () => {
    undo.current.push(ctx.getImageData(0, 0, SZ, SZ));
    if (undo.current.length > 120) undo.current.shift();
    redo.current = [];
    stroke.current = { seen: new Set() };
    bump((n) => n + 1);
  };
  const end = () => { stroke.current = null; };

  const pickColor = (c: Rgba) => {
    if (c[3] === 0) return;
    setColor([c[0], c[1], c[2], 255]);
  };
  const remember = (c: Rgba) => {
    const h = hex(c);
    setRecent((r) => [h, ...r.filter((x) => x !== h)].slice(0, 10));
  };

  /** (x, y) dokusunda bir fırça darbesi; ayna açıksa karşı tarafa da */
  const apply = (x: number, y: number) => {
    const s = st.current;
    const d = ctx.getImageData(0, 0, SZ, SZ);
    if (s.tool === "picker") { pickColor(get(d, x, y)); setTool("pencil"); return; }
    const at = locate(s.slim, x, y);
    if (!at) return;
    const targets: [number, number][] = [[x, y]];
    if (s.mirrorOn) { const m = mirror(s.slim, x, y); if (m && (m[0] !== x || m[1] !== y)) targets.push(m); }
    for (const [tx0, ty0] of targets) {
      const home = locate(s.slim, tx0, ty0);
      if (!home) continue;
      if (s.tool === "fill") { flood(d, tx0, ty0, home.rect); continue; }
      const o = Math.floor((s.size - 1) / 2);
      for (let dy = 0; dy < s.size; dy++) for (let dx = 0; dx < s.size; dx++) {
        const px = tx0 - o + dx, py = ty0 - o + dy;
        const r = home.rect;
        if (px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) continue;
        if (!editable(s.slim, px, py, s.hidden)) continue;
        const key = py * SZ + px;
        if ((s.tool === "shade" || s.tool === "noise") && stroke.current?.seen.has(key)) continue;
        stroke.current?.seen.add(key);
        put(d, px, py, brushColor(get(d, px, py)));
      }
    }
    ctx.putImageData(d, 0, 0);
    refresh();
  };

  const brushColor = (cur: Rgba): Rgba => {
    const s = st.current;
    if (s.tool === "eraser") return [0, 0, 0, 0];
    if (s.tool === "shade") {
      if (cur[3] === 0) return cur;
      const f = s.shadeMode === "dark" ? 0.86 : 1.14;
      return [clamp(cur[0] * f + (f > 1 ? 6 : 0)), clamp(cur[1] * f + (f > 1 ? 6 : 0)), clamp(cur[2] * f + (f > 1 ? 6 : 0)), cur[3]];
    }
    if (s.tool === "noise" || s.noise > 0 && s.tool === "fill") {
      const n = (Math.random() * 2 - 1) * s.noise;
      return [clamp(s.color[0] + n), clamp(s.color[1] + n), clamp(s.color[2] + n), 255];
    }
    return s.color;
  };

  /** Aynı yüz içinde, aynı renkteki bitişik pikselleri doldurur */
  const flood = (d: ImageData, x: number, y: number, r: { x: number; y: number; w: number; h: number }) => {
    if (!editable(st.current.slim, x, y, st.current.hidden)) return;
    const from = get(d, x, y).join();
    const stack = [[x, y]];
    const seen = new Set<number>();
    while (stack.length) {
      const [px, py] = stack.pop()!;
      const k = py * SZ + px;
      if (seen.has(k) || px < r.x || py < r.y || px >= r.x + r.w || py >= r.y + r.h) continue;
      seen.add(k);
      if (get(d, px, py).join() !== from) continue;
      put(d, px, py, brushColor(get(d, px, py)));
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
  };

  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(ctx.getImageData(0, 0, SZ, SZ));
    ctx.putImageData(prev, 0, 0);
    refresh();
    bump((n) => n + 1);
  }, [ctx, refresh]);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ctx.getImageData(0, 0, SZ, SZ));
    ctx.putImageData(next, 0, 0);
    refresh();
    bump((n) => n + 1);
  }, [ctx, refresh]);

  // ── 3D'de fırça: modelin üstündeyse boya, değilse döndür ──
  useEffect(() => {
    const el = view3d.current;
    if (!el) return;
    const ray = new Raycaster();
    const hit = (e: PointerEvent): [number, number] | null => {
      const v = viewer.current;
      if (!v) return null;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), v.camera);
      const s = st.current;
      const objs: Object3D[] = [];
      for (const p of PARTS) {
        const bp = v.playerObject.skin[p];
        const lay = s.layer === "outer" ? bp.outerLayer : bp.innerLayer;
        if (lay.visible) objs.push(lay);
      }
      const hits = ray.intersectObjects(objs, true);
      const h = hits[0] as Intersection<Mesh> | undefined;
      if (!h?.uv) return null;
      let { x: u, y: w } = h.uv;
      // Yüz kenarına denk gelen tıklama komşu yüzün pikseline kaymasın: üçgenin ortasına çok az yaklaştır
      const uvAttr = h.object.geometry?.attributes.uv;
      if (h.face && uvAttr) {
        const cu = (uvAttr.getX(h.face.a) + uvAttr.getX(h.face.b) + uvAttr.getX(h.face.c)) / 3;
        const cv = (uvAttr.getY(h.face.a) + uvAttr.getY(h.face.b) + uvAttr.getY(h.face.c)) / 3;
        u += (cu - u) * 0.002;
        w += (cv - w) * 0.002;
      }
      const x = Math.min(SZ - 1, Math.max(0, Math.floor(u * SZ)));
      const y = Math.min(SZ - 1, Math.max(0, Math.floor((1 - w) * SZ)));
      return [x, y];
    };
    let painting = false;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = hit(e);
      if (!p) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      painting = true;
      el.setPointerCapture(e.pointerId);
      begin();
      apply(p[0], p[1]);
    };
    const move = (e: PointerEvent) => {
      const p = hit(e);
      el.style.cursor = p ? "crosshair" : "grab";
      if (painting) {
        e.stopImmediatePropagation();
        if (p) apply(p[0], p[1]);
      }
      const hv = p ? { x: p[0], y: p[1] } : null;
      hoverRef.current = hv;
      setHover(hv);
      redraw2d();
    };
    const up = (e: PointerEvent) => {
      if (!painting) return;
      painting = false;
      el.releasePointerCapture(e.pointerId);
      end();
      if (st.current.tool !== "eraser" && st.current.tool !== "shade") remember(st.current.color);
    };
    el.addEventListener("pointerdown", down, { capture: true });
    el.addEventListener("pointermove", move, { capture: true });
    el.addEventListener("pointerup", up, { capture: true });
    return () => {
      el.removeEventListener("pointerdown", down, { capture: true });
      el.removeEventListener("pointermove", move, { capture: true });
      el.removeEventListener("pointerup", up, { capture: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2D'de fırça ──
  const flatPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * SZ), y = Math.floor(((e.clientY - r.top) / r.height) * SZ);
    return x >= 0 && y >= 0 && x < SZ && y < SZ ? { x, y } : null;
  };
  const flatPainting = useRef(false);

  // ── klavye kısayolları ──
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); doRedo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) setTool(t.id);
      else if (k === "x") setMirrorOn((m) => !m);
      else if (k === "l") setLayer((l) => (l === "inner" ? "outer" : "inner"));
      else if (k === "[") setSize((s) => Math.max(1, s - 1));
      else if (k === "]") setSize((s) => Math.min(4, s + 1));
      else if (k === "escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [doUndo, doRedo, onClose]);

  const toggleHidden = (k: string) => setHidden((h) => { const n = new Set(h); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const importFile = (f: File) => {
    const url = URL.createObjectURL(f);
    begin();
    end();
    void loadFrom(url, "skin").finally(() => URL.revokeObjectURL(url));
    if (!name || name === tx("Benim skinim")) setName(f.name.replace(/\.png$/i, "").slice(0, 40));
  };

  const exportPng = () => {
    const a = document.createElement("a");
    a.href = tex.toDataURL("image/png");
    a.download = `${(name || "skin").replace(/[^\w\- ]+/g, "_")}.png`;
    a.click();
  };

  const save = async (andApply: boolean) => {
    setSaving(andApply ? "apply" : "save");
    setErr(null);
    try {
      const skin = await api.saveSkinPng(tex.toDataURL("image/png"), name, slim);
      onSaved(skin, andApply);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(null);
    }
  };

  const hoverInfo = hover ? locate(slim, hover.x, hover.y) : null;

  return (
    <div className="sked-backdrop">
      <div className="sked">
        <header className="sked-top">
          <strong>{tx("Skin Editörü")}</strong>
          <input className="sked-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={tx("Skin adı")} />
          <div className="segmented mini">
            <button className={clsx(!slim && "active")} onClick={() => setSlim(false)}>{tx("Klasik (4px)")}</button>
            <button className={clsx(slim && "active")} onClick={() => setSlim(true)}>{tx("İnce (3px)")}</button>
          </div>
          <span className="grow" />
          <button className="icon-btn" title={tx("Geri al (Ctrl+Z)")} disabled={!undo.current.length} onClick={doUndo}><Undo2 size={16} /></button>
          <button className="icon-btn" title={tx("Yinele (Ctrl+Y)")} disabled={!redo.current.length} onClick={doRedo}><Redo2 size={16} /></button>
          <span className="tb-sep" />
          <button className="btn btn-ghost btn-sm" onClick={() => fileIn.current?.click()}><FolderOpen size={14} /> {tx("PNG aç")}</button>
          <button className="btn btn-ghost btn-sm" onClick={exportPng}><Download size={14} /> {tx("PNG indir")}</button>
          <button className="btn btn-ghost btn-sm" disabled={!!saving} onClick={() => void save(false)}>
            {saving === "save" ? <Loader2 size={14} className="spin" /> : <Save size={14} />} {tx("Arşive kaydet")}
          </button>
          <button className="btn btn-primary btn-sm" disabled={!!saving} onClick={() => void save(true)}>
            {saving === "apply" ? <Loader2 size={14} className="spin" /> : <Check size={14} />} {tx("Kaydet ve uygula")}
          </button>
          <button className="icon-btn" title={tx("Kapat (Esc)")} onClick={onClose}><X size={17} /></button>
          <input ref={fileIn} type="file" accept="image/png" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </header>

        <div className="sked-body">
          {/* Araçlar */}
          <aside className="sked-tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={clsx("sked-tool", tool === t.id && "active")} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
                <t.icon size={18} />
              </button>
            ))}
            <span className="sked-div" />
            <button className={clsx("sked-tool", mirrorOn && "active")} title={tx("Ayna: sol-sağ simetrik çiz (X)")} onClick={() => setMirrorOn((m) => !m)}><FlipHorizontal2 size={18} /></button>
            <button className={clsx("sked-tool", grid && "active")} title={tx("Izgara")} onClick={() => setGrid((g) => !g)}><Grid3x3 size={18} /></button>
            <button className={clsx("sked-tool", walk && "active")} title={tx("Yürüme önizlemesi")} onClick={() => setWalk((w) => !w)}><Play size={18} /></button>
          </aside>

          {/* 3D */}
          <section className="sked-3d">
            <canvas ref={view3d} />
            <div className="sked-layer">
              <div className="segmented mini">
                <button className={clsx(layer === "inner" && "active")} onClick={() => setLayer("inner")}>{tx("Taban katman")}</button>
                <button className={clsx(layer === "outer" && "active")} onClick={() => setLayer("outer")}>{tx("Dış katman")}</button>
              </div>
            </div>
            <p className="sked-hint muted tiny">{tx("Sol tık: boya · modelin dışında sürükle ya da sağ tık: döndür · tekerlek: yakınlaştır · L: katman değiştir")}</p>
          </section>

          {/* 2D doku */}
          <section className="sked-2d">
            <canvas
              ref={flat}
              width={512}
              height={512}
              onPointerDown={(e) => {
                const p = flatPos(e);
                if (!p || e.button !== 0) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                flatPainting.current = true;
                begin();
                apply(p.x, p.y);
              }}
              onPointerMove={(e) => {
                const p = flatPos(e);
                hoverRef.current = p;
                setHover(p);
                if (flatPainting.current && p) apply(p.x, p.y);
                else redraw2d();
              }}
              onPointerUp={() => {
                if (!flatPainting.current) return;
                flatPainting.current = false;
                end();
                if (st.current.tool !== "eraser" && st.current.tool !== "shade") remember(st.current.color);
              }}
              onPointerLeave={() => { hoverRef.current = null; setHover(null); redraw2d(); }}
            />
            <div className="sked-status muted tiny">
              {hover ? `${hover.x}, ${hover.y}` : "—"}
              {hoverInfo && ` · ${PART_LABEL[hoverInfo.box.part]} · ${hoverInfo.box.layer === "inner" ? tx("taban") : tx("dış")} · ${faceLabel(hoverInfo.face)}`}
            </div>
          </section>

          {/* Sağ panel */}
          <aside className="sked-side">
            <div className="sked-block">
              <h4>{tx("Renk")}</h4>
              <div className="sked-color">
                <input type="color" value={hex(color)} onChange={(e) => setColor(parseHex(e.target.value))} />
                <input className="sked-hex" value={hex(color)} onChange={(e) => /^#[0-9a-f]{6}$/i.test(e.target.value) && setColor(parseHex(e.target.value))} />
              </div>
              <div className="sked-swatches">
                {PRESETS.map((c) => <button key={c} style={{ background: c }} className={clsx(hex(color) === c && "on")} onClick={() => { setColor(parseHex(c)); if (tool === "eraser" || tool === "picker") setTool("pencil"); }} />)}
              </div>
              {recent.length > 0 && (
                <>
                  <span className="muted tiny">{tx("Son kullanılanlar")}</span>
                  <div className="sked-swatches">{recent.map((c) => <button key={c} style={{ background: c }} onClick={() => setColor(parseHex(c))} />)}</div>
                </>
              )}
            </div>

            <div className="sked-block">
              <h4>{tx("Fırça")}</h4>
              <div className="segmented mini">
                {[1, 2, 3, 4].map((n) => <button key={n} className={clsx(size === n && "active")} onClick={() => setSize(n)}>{n}px</button>)}
              </div>
              {tool === "shade" && (
                <div className="segmented mini">
                  <button className={clsx(shadeMode === "dark" && "active")} onClick={() => setShadeMode("dark")}><Moon size={12} /> {tx("Karart")}</button>
                  <button className={clsx(shadeMode === "light" && "active")} onClick={() => setShadeMode("light")}><Sun size={12} /> {tx("Aydınlat")}</button>
                </div>
              )}
              <label className="sked-range">
                <span className="small">{tx("Doku (gürültü)")}</span>
                <input type="range" min={0} max={40} value={noise} onChange={(e) => setNoise(+e.target.value)} />
                <span className="muted tiny">{noise}</span>
              </label>
              <p className="muted tiny">{tx("Doku fırçası ve kova, rengi bu kadar rastgele açıp koyulaştırır; kumaş ve saç için ideal.")}</p>
            </div>

            <div className="sked-block">
              <h4>{tx("Görünürlük")}</h4>
              <div className="sked-parts">
                {PARTS.map((p) => (
                  <button key={p} className={clsx("sked-part", hidden.has(p) && "off")} onClick={() => toggleHidden(p)}>
                    {hidden.has(p) ? <EyeOff size={13} /> : <Eye size={13} />} {PART_LABEL[p]}
                  </button>
                ))}
                <button className={clsx("sked-part", hidden.has("inner") && "off")} onClick={() => toggleHidden("inner")}>{hidden.has("inner") ? <EyeOff size={13} /> : <Eye size={13} />} {tx("Taban")}</button>
                <button className={clsx("sked-part", hidden.has("outer") && "off")} onClick={() => toggleHidden("outer")}>{hidden.has("outer") ? <EyeOff size={13} /> : <Eye size={13} />} {tx("Dış katman")}</button>
              </div>
              <p className="muted tiny">{tx("Gizli parçalar boyanmaz; içteki katmana ulaşmak için dış katmanı gizle.")}</p>
            </div>

            <div className="sked-block">
              <h4>{tx("Başlangıç")}</h4>
              <div className="sked-start">
                {initial && <button className="btn btn-ghost btn-sm" onClick={() => { begin(); end(); void loadFrom(initial.dataUrl, "skin"); }}><Upload size={13} /> {tx("Seçili skin")}</button>}
                <button className="btn btn-ghost btn-sm" onClick={() => { begin(); end(); void loadFrom(null, "blank"); }}><Droplet size={13} /> {tx("Temel şablon")}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { begin(); end(); void loadFrom(null, "clear"); }}><Eraser size={13} /> {tx("Tamamen temizle")}</button>
              </div>
            </div>
            {err && <p className="hint error">{err}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}

function faceLabel(f: string) {
  return ({ top: tx("üst"), bottom: tx("alt"), right: tx("sağ yan"), front: tx("ön"), left: tx("sol yan"), back: tx("arka") } as Record<string, string>)[f] ?? f;
}

function resetPose(v: SkinViewer) {
  const s = v.playerObject.skin;
  for (const p of PARTS) s[p].rotation.set(0, 0, 0);
  v.playerObject.position.set(0, 0, 0);
  v.playerObject.rotation.set(0, 0, 0);
}
