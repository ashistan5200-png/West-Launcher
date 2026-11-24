import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowLeftRight, Brush, Crop, Droplets, Eraser, Hand, Lasso, Loader2, Move, PaintBucket, Pipette, RectangleHorizontal,
  Save, Shapes, Sparkles, Stamp, Sun, Type, Wand2, X, ZoomIn, Blend as BlendIcon, Check, Undo2, Redo2, HelpCircle, Minus, Plus,
  Layers as LayersIcon, Palette, History as HistoryIcon, Zap,
} from "lucide-react";
import { tx } from "@/lib/i18n";
import {
  activeLayer, alphaBounds, applySel, blurCanvas, c2d, clone, combineSel, composite, defaultText, flatten, floodMask, growSel, hexToRgb, invertSel,
  mk, newDoc, newLayer, patchLayer, pushHistory, renderText, rgbToHex, selEdges, selFromMask, textBounds, throughSel, uid,
  type Doc, type History, type Layer, type SelMode,
} from "./core";
import { ADJUSTMENTS, defaults, FILTERS, type Op, type Values } from "./fx";
import { ColorPanel, EffectsDialog, HistoryPanel, LayersPanel, NumDialog, OpDialog, TextPanel, type NumField } from "./panels";
import { AshiGuide, firstTime, type GuideStep } from "@/components/AshiGuide";

type Tool = "move" | "marquee" | "lasso" | "wand" | "crop" | "picker" | "heal" | "brush" | "clone" | "eraser" | "gradient" | "bucket" | "tone" | "focus" | "text" | "shape" | "hand" | "zoom";

const TOOLS: { id: Tool; icon: typeof Brush; label: string; key: string }[] = [
  { id: "move", icon: Move, label: "Taşı", key: "V" },
  { id: "marquee", icon: RectangleHorizontal, label: "Seçim çerçevesi", key: "M" },
  { id: "lasso", icon: Lasso, label: "Kement", key: "L" },
  { id: "wand", icon: Wand2, label: "Sihirli değnek", key: "W" },
  { id: "crop", icon: Crop, label: "Kırp", key: "C" },
  { id: "picker", icon: Pipette, label: "Damlalık", key: "I" },
  { id: "heal", icon: Sparkles, label: "Leke düzeltme", key: "J" },
  { id: "brush", icon: Brush, label: "Fırça", key: "B" },
  { id: "clone", icon: Stamp, label: "Klon damgası", key: "S" },
  { id: "eraser", icon: Eraser, label: "Silgi", key: "E" },
  { id: "gradient", icon: BlendIcon, label: "Degrade", key: "G" },
  { id: "bucket", icon: PaintBucket, label: "Boya kovası", key: "K" },
  { id: "tone", icon: Sun, label: "Soldur / Yak / Sünger", key: "O" },
  { id: "focus", icon: Droplets, label: "Bulanıklaştır / Keskinleştir / Parmak", key: "R" },
  { id: "text", icon: Type, label: "Yazı", key: "T" },
  { id: "shape", icon: Shapes, label: "Şekil", key: "U" },
  { id: "hand", icon: Hand, label: "El", key: "H" },
  { id: "zoom", icon: ZoomIn, label: "Yakınlaştır", key: "Z" },
];

/** Araç çubuğundaki gruplar: aynı işi gören araçlar tek düğmede; tekrar tıklayınca seçenekler açılır */
const GROUPS: { id: string; tools: Tool[] }[] = [
  { id: "move", tools: ["move"] },
  { id: "select", tools: ["marquee", "lasso", "wand"] },
  { id: "crop", tools: ["crop"] },
  { id: "brush", tools: ["brush"] },
  { id: "eraser", tools: ["eraser"] },
  { id: "retouch", tools: ["heal", "clone"] },
  { id: "fill", tools: ["gradient", "bucket"] },
  { id: "tone", tools: ["tone", "focus"] },
  { id: "text", tools: ["text"] },
  { id: "shape", tools: ["shape"] },
  { id: "picker", tools: ["picker"] },
];

interface Brush { size: number; hardness: number; opacity: number; flow: number }
interface Tf { layerId: string; float: HTMLCanvasElement; base: HTMLCanvasElement; box: { x: number; y: number; w: number; h: number }; cx: number; cy: number; sx: number; sy: number; rot: number; sel: HTMLCanvasElement | null }
type Pt = { x: number; y: number };

interface Props {
  image: HTMLImageElement;
  title: string;
  onClose: () => void;
  onSaveCopy: (c: HTMLCanvasElement) => Promise<void>;
  onCopy: (c: HTMLCanvasElement) => Promise<void>;
  onExport: (c: HTMLCanvasElement, fmt: "png" | "jpg") => Promise<void>;
  /** Basit düzenleyiciye dön */
  onSimple?: () => void;
}

/**
 * WestPhoto: katmanlı, maskeli, seçimli, geçmişli tam bir görüntü düzenleyici. Ekran görüntüsü düzenleyicisinde
 * "WestPhoto modu" açılınca bu ekran gelir. Orijinal dosya hiç değişmez; sonuç kopya olarak kaydedilir.
 */
export default function WestPhoto({ image, title, onClose, onSaveCopy, onCopy, onExport, onSimple }: Props) {
  const [hist, setHist] = useState<History>(() => ({ items: [{ label: "Aç", doc: newDoc(image) }], index: 0 }));
  const doc = hist.items[hist.index].doc;
  const docRef = useRef(doc);
  docRef.current = doc;

  const [tool, setToolRaw] = useState<Tool>("brush");
  const [fg, setFg] = useState("#e8a33d");
  const [bg, setBg] = useState("#ffffff");
  const [brush, setBrush] = useState<Brush>({ size: 24, hardness: 70, opacity: 100, flow: 100 });
  const [tol, setTol] = useState(32);
  const [contig, setContig] = useState(true);
  const [sampleAll, setSampleAll] = useState(false);
  const [selMode, setSelMode] = useState<SelMode>("new");
  const [marqueeShape, setMarqueeShape] = useState<"rect" | "ellipse">("rect");
  const [feather, setFeather] = useState(0);
  const [grad, setGrad] = useState<{ type: "linear" | "radial" | "reflected"; trans: boolean }>({ type: "linear", trans: false });
  const [shape, setShape] = useState<{ kind: "rect" | "round" | "ellipse" | "line" | "arrow"; fill: boolean; stroke: boolean; sw: number }>({ kind: "rect", fill: true, stroke: false, sw: 6 });
  const [toneMode, setToneMode] = useState<"dodge" | "burn" | "sponge-" | "sponge+">("dodge");
  const [focusMode, setFocusMode] = useState<"blur" | "sharpen" | "smudge">("blur");
  const [strength, setStrength] = useState(50);
  const [cropAspect, setCropAspect] = useState<number | null>(null);
  const [grid, setGrid] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "op"; op: Op; values: Values } | { kind: "fx" } | { kind: "num"; title: string; fields: NumField[]; run: (v: number[]) => void }>(null);
  const [tf, setTf] = useState<Tf | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ x: number; y: number; c: string } | null>(null);
  const [zoomPct, setZoomPct] = useState(100);
  const [panel, setPanel] = useState<"layers" | "quick" | "color" | "history">("layers");
  const [fly, setFly] = useState<string | null>(null);
  const [lastInGroup, setLastInGroup] = useState<Record<string, Tool>>({});
  const [guide, setGuide] = useState(false);
  useEffect(() => { if (firstTime("west.guide.westphoto")) window.setTimeout(() => setGuide(true), 600); }, []);
  const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const lastFilter = useRef<{ op: Op; values: Values } | null>(null);
  const clipboard = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);

  const wrap = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLCanvasElement>(null);
  const comp = useMemo(() => mk(doc.w, doc.h), []); // eslint-disable-line react-hooks/exhaustive-deps
  const vz = useRef({ zoom: 1, px: 0, py: 0 });
  const preview = useRef<{ id: string; canvas?: HTMLCanvasElement; mask?: HTMLCanvasElement } | null>(null);
  const extra = useRef<{ after: string; canvas: HTMLCanvasElement } | null>(null);
  const overlay = useRef<{ marquee?: { x: number; y: number; w: number; h: number; ellipse: boolean }; lasso?: Pt[]; line?: [Pt, Pt]; selOffset?: Pt; cursor?: Pt; cloneSrc?: Pt | null }>({});
  const edges = useRef<{ segs: Float32Array; sel: HTMLCanvasElement | null; step: number }>({ segs: new Float32Array(), sel: null, step: 1 });
  const dirty = useRef(true);
  const raf = useRef(0);
  const space = useRef(false);
  const cloneSrc = useRef<Pt | null>(null);

  const setTool = (t: Tool) => {
    setToolRaw(t);
    setMenu(null);
    setFly(null);
    const g = GROUPS.find((x) => x.tools.includes(t));
    if (g) setLastInGroup((m) => ({ ...m, [g.id]: t }));
  };
  const layer = activeLayer(doc);

  // ── geçmiş ──
  const commit = useCallback((label: string, next: Doc) => { setHist((h) => pushHistory(h, label, next)); dirty.current = true; }, []);
  const silent = useCallback((fn: (d: Doc) => Doc) => {
    setHist((h) => ({ ...h, items: h.items.map((it, i) => (i === h.index ? { ...it, doc: fn(it.doc) } : it)) }));
    dirty.current = true;
  }, []);
  const undo = () => setHist((h) => ({ ...h, index: Math.max(0, h.index - 1) }));
  const redo = () => setHist((h) => ({ ...h, index: Math.min(h.items.length - 1, h.index + 1) }));
  useEffect(() => { dirty.current = true; draw(); }, [hist]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── çizim ──
  const draw = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = view.current, d = docRef.current;
      if (!c) return;
      if (dirty.current) {
        const ov = preview.current;
        const docForComp = ov?.mask ? patchLayer(d, ov.id, { mask: ov.mask }) : d;
        composite(docForComp, comp, ov?.canvas ? { id: ov.id, canvas: ov.canvas } : null, extra.current);
        dirty.current = false;
      }
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext("2d")!;
      const { zoom, px, py } = vz.current;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = "#16171c";
      g.fillRect(0, 0, W, H);
      // dama tahtası + belge
      g.save();
      g.translate(px, py);
      g.shadowColor = "rgba(0,0,0,0.5)";
      g.shadowBlur = 18;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, d.w * zoom, d.h * zoom);
      g.restore();
      g.save();
      g.beginPath();
      g.rect(px, py, d.w * zoom, d.h * zoom);
      g.clip();
      g.fillStyle = checker(g);
      g.fillRect(px, py, d.w * zoom, d.h * zoom);
      g.imageSmoothingEnabled = zoom < 2;
      g.imageSmoothingQuality = "high";
      g.drawImage(comp, px, py, d.w * zoom, d.h * zoom);
      if (grid) {
        const step = Math.max(8, Math.round(64 / zoom)) * zoom;
        g.strokeStyle = "rgba(255,255,255,0.12)";
        g.lineWidth = 1;
        g.beginPath();
        for (let x = px; x < px + d.w * zoom; x += step) { g.moveTo(Math.round(x) + 0.5, py); g.lineTo(Math.round(x) + 0.5, py + d.h * zoom); }
        for (let y = py; y < py + d.h * zoom; y += step) { g.moveTo(px, Math.round(y) + 0.5); g.lineTo(px + d.w * zoom, Math.round(y) + 0.5); }
        g.stroke();
      }
      g.restore();
      drawOverlay(g, d);
    });
  }, [comp, grid]); // eslint-disable-line react-hooks/exhaustive-deps

  const toScreen = (x: number, y: number) => ({ x: vz.current.px + x * vz.current.zoom, y: vz.current.py + y * vz.current.zoom });

  const drawOverlay = (g: CanvasRenderingContext2D, d: Doc) => {
    const { zoom } = vz.current;
    const o = overlay.current;
    // yürüyen karıncalar
    if (d.sel) {
      const step = Math.max(1, Math.floor(1 / zoom));
      if (edges.current.sel !== d.sel || edges.current.step !== step) edges.current = { segs: selEdges(d.sel, step), sel: d.sel, step };
      const s = edges.current.segs, off = o.selOffset ?? { x: 0, y: 0 };
      g.save();
      g.beginPath();
      for (let i = 0; i < s.length; i += 4) {
        const a = toScreen(s[i] + off.x, s[i + 1] + off.y), b = toScreen(s[i + 2] + off.x, s[i + 3] + off.y);
        g.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
        g.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
      }
      g.lineWidth = 1;
      g.strokeStyle = "#000";
      g.stroke();
      g.setLineDash([4, 4]);
      g.lineDashOffset = -(performance.now() / 60) % 8;
      g.strokeStyle = "#fff";
      g.stroke();
      g.restore();
    }
    g.save();
    g.lineWidth = 1;
    g.setLineDash([5, 4]);
    g.strokeStyle = "#fff";
    if (o.marquee) {
      const m = o.marquee, a = toScreen(m.x, m.y);
      g.beginPath();
      if (m.ellipse) g.ellipse(a.x + (m.w * zoom) / 2, a.y + (m.h * zoom) / 2, Math.abs(m.w * zoom) / 2, Math.abs(m.h * zoom) / 2, 0, 0, Math.PI * 2);
      else g.rect(a.x + 0.5, a.y + 0.5, m.w * zoom, m.h * zoom);
      g.stroke();
    }
    if (o.lasso && o.lasso.length > 1) {
      g.beginPath();
      o.lasso.forEach((p, i) => { const s = toScreen(p.x, p.y); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      g.stroke();
    }
    if (o.line) {
      const a = toScreen(o.line[0].x, o.line[0].y), b = toScreen(o.line[1].x, o.line[1].y);
      g.setLineDash([]);
      g.strokeStyle = "rgba(0,0,0,0.6)";
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 1.2; g.stroke();
      for (const p of [a, b]) { g.beginPath(); g.arc(p.x, p.y, 4, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); }
    }
    g.restore();
    // kırpma
    if (cropRectRef.current) {
      const r = cropRectRef.current, a = toScreen(r.x, r.y), W = g.canvas.width, H = g.canvas.height;
      g.save();
      g.fillStyle = "rgba(0,0,0,0.55)";
      g.beginPath();
      g.rect(0, 0, W, H);
      g.rect(a.x, a.y, r.w * zoom, r.h * zoom);
      g.fill("evenodd");
      g.strokeStyle = "#fff";
      g.strokeRect(a.x + 0.5, a.y + 0.5, r.w * zoom, r.h * zoom);
      g.strokeStyle = "rgba(255,255,255,0.35)";
      for (let k = 1; k < 3; k++) {
        g.beginPath();
        g.moveTo(a.x + (r.w * zoom * k) / 3, a.y); g.lineTo(a.x + (r.w * zoom * k) / 3, a.y + r.h * zoom);
        g.moveTo(a.x, a.y + (r.h * zoom * k) / 3); g.lineTo(a.x + r.w * zoom, a.y + (r.h * zoom * k) / 3);
        g.stroke();
      }
      g.restore();
    }
    // serbest dönüştürme kutusu
    const t = tfRef.current;
    if (t) {
      const c = toScreen(t.cx, t.cy), hw = (t.box.w / 2) * t.sx * zoom, hh = (t.box.h / 2) * t.sy * zoom;
      g.save();
      g.translate(c.x, c.y);
      g.rotate(t.rot);
      g.strokeStyle = "#4da3ff";
      g.lineWidth = 1.2;
      g.strokeRect(-hw, -hh, hw * 2, hh * 2);
      for (const [hx, hy] of HANDLES) { g.fillStyle = "#fff"; g.fillRect(hx * hw - 4, hy * hh - 4, 8, 8); g.strokeRect(hx * hw - 4, hy * hh - 4, 8, 8); }
      g.beginPath(); g.arc(0, 0, 3, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
    // fırça imleci
    if (o.cursor && ["brush", "eraser", "clone", "heal", "tone", "focus"].includes(toolRef.current)) {
      const s = toScreen(o.cursor.x, o.cursor.y);
      g.save();
      g.beginPath();
      g.arc(s.x, s.y, Math.max(1, (brushRef.current.size / 2) * zoom), 0, Math.PI * 2);
      g.strokeStyle = "rgba(0,0,0,0.7)"; g.lineWidth = 2.5; g.stroke();
      g.strokeStyle = "#fff"; g.lineWidth = 1; g.stroke();
      if (toolRef.current === "clone" && cloneSrc.current) {
        const q = toScreen(cloneSrc.current.x + (o.cloneSrc ? o.cloneSrc.x : 0), cloneSrc.current.y + (o.cloneSrc ? o.cloneSrc.y : 0));
        g.beginPath(); g.moveTo(q.x - 6, q.y); g.lineTo(q.x + 6, q.y); g.moveTo(q.x, q.y - 6); g.lineTo(q.x, q.y + 6); g.stroke();
      }
      g.restore();
    }
  };

  const toolRef = useRef(tool); toolRef.current = tool;
  const brushRef = useRef(brush); brushRef.current = brush;
  const tfRef = useRef(tf); tfRef.current = tf;
  const cropRectRef = useRef(cropRect); cropRectRef.current = cropRect;

  // Karıncalar için yavaş döngü
  useEffect(() => {
    if (!doc.sel) return;
    const t = window.setInterval(draw, 120);
    return () => window.clearInterval(t);
  }, [doc.sel, draw]);

  // ── görünüm ──
  const fit = useCallback(() => {
    const c = view.current, d = docRef.current;
    if (!c) return;
    const z = Math.min((c.clientWidth - 40) / d.w, (c.clientHeight - 40) / d.h, 4);
    vz.current = { zoom: z, px: (c.clientWidth - d.w * z) / 2, py: (c.clientHeight - d.h * z) / 2 };
    setZoomPct(Math.round(z * 100));
    draw();
  }, [draw]);
  const zoomAt = (f: number, sx?: number, sy?: number) => {
    const c = view.current!;
    const cx = sx ?? c.clientWidth / 2, cy = sy ?? c.clientHeight / 2, v = vz.current;
    const z = Math.min(32, Math.max(0.02, v.zoom * f));
    vz.current = { zoom: z, px: cx - ((cx - v.px) / v.zoom) * z, py: cy - ((cy - v.py) / v.zoom) * z };
    setZoomPct(Math.round(z * 100));
    draw();
  };
  const actual = () => { const c = view.current!; const d = docRef.current; vz.current = { zoom: 1, px: (c.clientWidth - d.w) / 2, py: (c.clientHeight - d.h) / 2 }; setZoomPct(100); draw(); };
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => draw());
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => draw(), [grid, cropRect, tf, draw]);

  const toDoc = (e: { clientX: number; clientY: number }): Pt => {
    const r = view.current!.getBoundingClientRect(), v = vz.current;
    return { x: (e.clientX - r.left - v.px) / v.zoom, y: (e.clientY - r.top - v.py) / v.zoom };
  };

  // ── katman hedefi ──
  const target = (d: Doc, l: Layer) => (d.editMask && l.mask ? l.mask : l.canvas);
  const withTarget = (d: Doc, l: Layer, c: HTMLCanvasElement): Doc =>
    d.editMask && l.mask ? patchLayer(d, l.id, { mask: c }) : patchLayer(d, l.id, { canvas: c, text: null });
  const setPreview = (l: Layer, c: HTMLCanvasElement | null) => {
    const d = docRef.current;
    preview.current = c ? (d.editMask && l.mask ? { id: l.id, mask: c } : { id: l.id, canvas: c }) : null;
    dirty.current = true;
    draw();
  };

  // ── fırça damgası ──
  const dabCanvas = useRef(mk(2, 2));
  const makeDab = (r: number, hard: number, fill: string | ((g: CanvasRenderingContext2D, s: number) => void)): HTMLCanvasElement => {
    const s = Math.max(2, Math.ceil(r * 2) + 2);
    const c = dabCanvas.current;
    if (c.width !== s) { c.width = s; c.height = s; }
    const g = c2d(c);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, s, s);
    if (typeof fill === "string") { g.fillStyle = fill; g.fillRect(0, 0, s, s); } else fill(g, s);
    g.globalCompositeOperation = "destination-in";
    const gr = g.createRadialGradient(s / 2, s / 2, Math.max(0, r * (hard / 100) - 0.5), s / 2, s / 2, Math.max(0.6, r));
    gr.addColorStop(0, "rgba(0,0,0,1)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = hard >= 100 ? "#000" : gr;
    if (hard >= 100) { g.beginPath(); g.arc(s / 2, s / 2, Math.max(0.5, r), 0, Math.PI * 2); g.fill(); } else g.fillRect(0, 0, s, s);
    return c;
  };
  /** Damgayı (seçimle kırpılmış olarak) hedef tuvale basar */
  const stamp = (dst: HTMLCanvasElement, dab: HTMLCanvasElement, x: number, y: number, alpha: number, op: GlobalCompositeOperation = "source-over") => {
    const s = dab.width, sel = docRef.current.sel;
    let src = dab;
    if (sel) {
      src = clone(dab);
      const g = c2d(src);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(sel, -(Math.round(x) - s / 2), -(Math.round(y) - s / 2));
    }
    const g = c2d(dst);
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(src, Math.round(x) - s / 2, Math.round(y) - s / 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
  };

  // ── işaretçi ──
  const act = useRef<null | {
    kind: string; start: Pt; last: Pt; base?: HTMLCanvasElement; work?: HTMLCanvasElement; stroke?: HTMLCanvasElement; layer?: Layer;
    float?: HTMLCanvasElement; mode?: SelMode; panStart?: { px: number; py: number; cx: number; cy: number }; handle?: [number, number] | "move" | "rotate"; tf0?: Tf; a0?: number;
  }>(null);

  const modeFrom = (e: React.PointerEvent): SelMode => (e.shiftKey && e.altKey ? "int" : e.shiftKey ? "add" : e.altKey ? "sub" : selMode);

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setMenu(null);
    const p = toDoc(e);
    const d = docRef.current;
    const l = activeLayer(d);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 1 || space.current || tool === "hand") {
      act.current = { kind: "pan", start: p, last: p, panStart: { px: vz.current.px, py: vz.current.py, cx: e.clientX, cy: e.clientY } };
      return;
    }
    if (e.button !== 0) return;
    // dönüştürme kutusu her araçtan önce gelir
    if (tf) {
      const h = hitTf(tf, p);
      act.current = { kind: "tf", start: p, last: p, handle: h, tf0: tf, a0: Math.atan2(p.y - tf.cy, p.x - tf.cx) };
      return;
    }
    if (tool === "zoom") { zoomAt(e.altKey ? 1 / 1.5 : 1.5, e.clientX - view.current!.getBoundingClientRect().left, e.clientY - view.current!.getBoundingClientRect().top); return; }
    if (tool === "picker") { pick(p, e.altKey); return; }
    if (tool === "crop") { act.current = { kind: "crop", start: p, last: p }; setCropRect({ x: p.x, y: p.y, w: 0, h: 0 }); return; }
    if (tool === "marquee") { act.current = { kind: "marquee", start: p, last: p, mode: modeFrom(e) }; return; }
    if (tool === "lasso") { act.current = { kind: "lasso", start: p, last: p, mode: modeFrom(e) }; overlay.current.lasso = [p]; return; }
    if (tool === "wand") { wand(p, modeFrom(e)); return; }
    if (tool === "text") { textClick(p); return; }
    if (l.locked && tool !== "shape") { flashMsg(tx("Katman kilitli")); return; }
    if (tool === "bucket") { bucket(p); return; }
    if (tool === "move") {
      if (l.text) { act.current = { kind: "movetext", start: p, last: p, layer: l }; return; }
      const base = target(d, l);
      if (d.sel) {
        const float = clone(base); const fg2 = c2d(float); fg2.globalCompositeOperation = "destination-in"; fg2.drawImage(d.sel, 0, 0);
        const rest = clone(base); const rg = c2d(rest); rg.globalCompositeOperation = "destination-out"; rg.drawImage(d.sel, 0, 0);
        act.current = { kind: "move", start: p, last: p, base: rest, float, layer: l, work: mk(d.w, d.h) };
      } else act.current = { kind: "move", start: p, last: p, base: mk(d.w, d.h), float: base, layer: l, work: mk(d.w, d.h) };
      return;
    }
    if (tool === "gradient") { act.current = { kind: "gradient", start: p, last: p, base: target(d, l), layer: l, work: mk(d.w, d.h), stroke: mk(d.w, d.h) }; return; }
    if (tool === "shape") { act.current = { kind: "shape", start: p, last: p, work: mk(d.w, d.h) }; return; }
    if (tool === "clone" && e.altKey) { cloneSrc.current = p; flashMsg(tx("Klon kaynağı ayarlandı")); return; }
    if (tool === "clone" && !cloneSrc.current) { flashMsg(tx("Önce Alt+tık ile kaynak noktası seç")); return; }
    // fırça ailesi
    const base = target(d, l);
    const work = clone(base);
    act.current = { kind: "paint", start: p, last: p, base, work, stroke: mk(d.w, d.h), layer: l };
    overlay.current.cloneSrc = { x: 0, y: 0 };
    paintTo(p, p, true);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toDoc(e);
    overlay.current.cursor = p;
    const d = docRef.current;
    const xi = Math.floor(p.x), yi = Math.floor(p.y);
    if (xi >= 0 && yi >= 0 && xi < d.w && yi < d.h) {
      const px = c2d(comp).getImageData(xi, yi, 1, 1).data;
      setStatus({ x: xi, y: yi, c: rgbToHex(px[0], px[1], px[2]) });
    } else setStatus(null);
    const a = act.current;
    if (!a) { draw(); return; }
    if (a.kind === "pan" && a.panStart) {
      vz.current.px = a.panStart.px + (e.clientX - a.panStart.cx);
      vz.current.py = a.panStart.py + (e.clientY - a.panStart.cy);
      draw();
      return;
    }
    if (a.kind === "tf" && a.tf0) { setTf(dragTf(a.tf0, a.handle!, a.start, p, a.a0!, e.shiftKey)); return; }
    if (a.kind === "crop") {
      let w = p.x - a.start.x, h = p.y - a.start.y;
      if (cropAspect) h = Math.sign(h || 1) * Math.abs(w) / cropAspect;
      setCropRect(normRect(a.start.x, a.start.y, w, h, d));
      return;
    }
    if (a.kind === "marquee") {
      let w = p.x - a.start.x, h = p.y - a.start.y;
      if (e.shiftKey && a.mode === "new") { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w) * s; h = Math.sign(h) * s; }
      const r = normRect(a.start.x, a.start.y, w, h, null);
      overlay.current.marquee = { ...r, ellipse: marqueeShape === "ellipse" };
      draw();
      return;
    }
    if (a.kind === "lasso") { overlay.current.lasso!.push(p); draw(); return; }
    if (a.kind === "movetext" && a.layer?.text) {
      const t = { ...a.layer.text, x: a.layer.text.x + (p.x - a.start.x), y: a.layer.text.y + (p.y - a.start.y) };
      preview.current = { id: a.layer.id, canvas: renderText(d.w, d.h, t) };
      dirty.current = true;
      draw();
      a.last = p;
      return;
    }
    if (a.kind === "move" && a.layer) {
      const dx = Math.round(p.x - a.start.x), dy = Math.round(p.y - a.start.y), w = a.work!, g = c2d(w);
      g.clearRect(0, 0, w.width, w.height);
      g.drawImage(a.base!, 0, 0);
      g.drawImage(a.float!, dx, dy);
      overlay.current.selOffset = d.sel ? { x: dx, y: dy } : undefined;
      setPreview(a.layer, w);
      a.last = p;
      return;
    }
    if (a.kind === "gradient" && a.layer) {
      overlay.current.line = [a.start, p];
      renderGradient(a.stroke!, a.start, p);
      const w = a.work!, g = c2d(w);
      g.clearRect(0, 0, w.width, w.height);
      g.drawImage(a.base!, 0, 0);
      g.globalAlpha = brush.opacity / 100;
      g.drawImage(a.stroke!, 0, 0);
      g.globalAlpha = 1;
      setPreview(a.layer, w);
      a.last = p;
      return;
    }
    if (a.kind === "shape") {
      const w = a.work!;
      renderShape(w, a.start, p, e.shiftKey);
      extra.current = { after: activeLayer(d).id, canvas: w };
      dirty.current = true;
      draw();
      a.last = p;
      return;
    }
    if (a.kind === "paint") { paintTo(a.last, p, false); a.last = p; }
  };

  const onUp = () => {
    const a = act.current;
    act.current = null;
    if (!a) return;
    const d = docRef.current;
    overlay.current.selOffset = undefined;
    overlay.current.line = undefined;
    if (a.kind === "marquee") {
      const m = overlay.current.marquee;
      overlay.current.marquee = undefined;
      if (!m || m.w < 2 || m.h < 2) { if (a.mode === "new" && d.sel) commit("Seçimi kaldır", { ...d, sel: null }); else draw(); return; }
      const sel = applySel(d, (g) => { g.beginPath(); if (m.ellipse) g.ellipse(m.x + m.w / 2, m.y + m.h / 2, m.w / 2, m.h / 2, 0, 0, Math.PI * 2); else g.rect(m.x, m.y, m.w, m.h); g.fill(); }, a.mode!, feather);
      commit(m.ellipse ? "Elips seçim" : "Dikdörtgen seçim", { ...d, sel });
      return;
    }
    if (a.kind === "lasso") {
      const pts = overlay.current.lasso ?? [];
      overlay.current.lasso = undefined;
      if (pts.length < 3) { draw(); return; }
      const sel = applySel(d, (g) => { g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.fill(); }, a.mode!, feather);
      commit("Kement seçimi", { ...d, sel });
      return;
    }
    if (a.kind === "movetext" && a.layer?.text) {
      const t = { ...a.layer.text, x: a.layer.text.x + (a.last.x - a.start.x), y: a.layer.text.y + (a.last.y - a.start.y) };
      preview.current = null;
      commit("Yazıyı taşı", patchLayer(d, a.layer.id, { text: t, canvas: renderText(d.w, d.h, t) }));
      return;
    }
    if (a.kind === "move" && a.layer) {
      const dx = Math.round(a.last.x - a.start.x), dy = Math.round(a.last.y - a.start.y);
      preview.current = null;
      if (!dx && !dy) { draw(); return; }
      const out = clone(a.work!);
      let next = withTarget(d, a.layer, out);
      if (!d.editMask && a.layer.mask && !d.sel) next = patchLayer(next, a.layer.id, { mask: shift(a.layer.mask, dx, dy) });
      if (d.sel) next = { ...next, sel: shift(d.sel, dx, dy) };
      commit("Taşı", next);
      return;
    }
    if (a.kind === "gradient" && a.layer) {
      preview.current = null;
      if (Math.hypot(a.last.x - a.start.x, a.last.y - a.start.y) < 2) { draw(); return; }
      commit("Degrade", withTarget(d, a.layer, clone(a.work!)));
      return;
    }
    if (a.kind === "shape") {
      extra.current = null;
      if (Math.hypot(a.last.x - a.start.x, a.last.y - a.start.y) < 2) { draw(); return; }
      const nl = { ...newLayer(d.w, d.h, tx("Şekil")), canvas: a.work! };
      const i = d.layers.findIndex((x) => x.id === d.active);
      const layers = [...d.layers];
      layers.splice(i + 1, 0, nl);
      commit("Şekil", { ...d, layers, active: nl.id, editMask: false });
      return;
    }
    if (a.kind === "paint" && a.layer) {
      preview.current = null;
      const label = { brush: "Fırça", eraser: "Silgi", clone: "Klon damgası", heal: "Leke düzeltme", tone: "Ton aracı", focus: "Odak aracı" }[tool as string] ?? "Boya";
      commit(label, withTarget(d, a.layer, a.work!));
      return;
    }
    draw();
  };

  // ── boyama ──
  const paintTo = (from: Pt, to: Pt, first: boolean) => {
    const a = act.current!;
    const l = a.layer!;
    const r = brush.size / 2;
    const spacing = Math.max(1, brush.size * (tool === "focus" && focusMode === "smudge" ? 0.08 : 0.15));
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const n = first ? 1 : Math.max(1, Math.floor(dist / spacing));
    const masking = docRef.current.editMask && !!l.mask;
    for (let i = first ? 0 : 1; i <= n; i++) {
      const t = first ? 1 : i / n;
      const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
      const flow = brush.flow / 100;
      if (tool === "brush" || tool === "eraser") {
        stamp(a.stroke!, makeDab(r, brush.hardness, masking ? "#ffffff" : fg), x, y, flow);
      } else if (tool === "clone" && cloneSrc.current) {
        const off = { x: cloneSrc.current.x - a.start.x, y: cloneSrc.current.y - a.start.y };
        overlay.current.cloneSrc = { x: x - a.start.x, y: y - a.start.y };
        stamp(a.stroke!, makeDab(r, brush.hardness, (g, s) => g.drawImage(a.base!, -(x + off.x - s / 2), -(y + off.y - s / 2))), x, y, flow);
      } else if (tool === "heal") {
        const off = bestPatch(a.base!, x, y, r);
        stamp(a.stroke!, makeDab(r, Math.min(brush.hardness, 40), (g, s) => { g.filter = "blur(1px)"; g.drawImage(a.base!, -(x + off.x - s / 2), -(y + off.y - s / 2)); g.filter = "none"; }), x, y, 1);
      } else if (tool === "tone" || tool === "focus") {
        directDab(a.work!, x, y, r, first ? null : { x: x - (to.x - from.x) / n, y: y - (to.y - from.y) / n });
      }
    }
    if (tool === "tone" || tool === "focus") { setPreview(l, a.work!); return; }
    // iş tuvali = taban + darbe × opaklık
    const w = a.work!, g = c2d(w);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, w.width, w.height);
    g.drawImage(a.base!, 0, 0);
    const dark = (() => { const [rr, gg, bb] = hexToRgb(fg); return 0.299 * rr + 0.587 * gg + 0.114 * bb < 128; })();
    const erase = tool === "eraser" || (masking && tool === "brush" && dark);
    g.globalAlpha = brush.opacity / 100;
    g.globalCompositeOperation = erase ? "destination-out" : "source-over";
    g.drawImage(a.stroke!, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    setPreview(l, w);
  };

  /** Soldur/yak/sünger ve bulanıklaştır/keskinleştir/parmak: iş tuvalinde yerinde değişiklik */
  const directDab = (w: HTMLCanvasElement, x: number, y: number, r: number, prev: Pt | null) => {
    const s = Math.ceil(r * 2) + 2, x0 = Math.round(x) - s / 2, y0 = Math.round(y) - s / 2;
    const k = strength / 100;
    if (tool === "focus" && focusMode === "smudge") {
      if (!prev) return;
      const dab = makeDab(r, brush.hardness, (g, sz) => g.drawImage(w, -(Math.round(prev.x) - sz / 2), -(Math.round(prev.y) - sz / 2)));
      stamp(w, dab, x, y, k * 0.9);
      return;
    }
    if (tool === "focus" && focusMode === "blur") {
      const dab = makeDab(r, brush.hardness, (g) => { g.filter = `blur(${1 + k * 3}px)`; g.drawImage(w, -x0, -y0); g.filter = "none"; });
      stamp(w, dab, x, y, 0.5 + k * 0.5);
      return;
    }
    const wg = c2d(w);
    const sx = Math.max(0, x0), sy = Math.max(0, y0), sw = Math.min(w.width, x0 + s) - sx, sh = Math.min(w.height, y0 + s) - sy;
    if (sw <= 0 || sh <= 0) return;
    const id = wg.getImageData(sx, sy, sw, sh), dd = id.data, orig = new Uint8ClampedArray(dd);
    const sel = docRef.current.sel ? c2d(docRef.current.sel).getImageData(sx, sy, sw, sh).data : null;
    for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
      const dist = Math.hypot(sx + i + 0.5 - x, sy + j + 0.5 - y);
      if (dist > r) continue;
      const hard = brush.hardness / 100;
      let wgt = dist <= r * hard ? 1 : 1 - (dist - r * hard) / Math.max(0.001, r * (1 - hard));
      const q = (j * sw + i) * 4;
      if (sel) wgt *= sel[q + 3] / 255;
      if (wgt <= 0) continue;
      const R = orig[q], G = orig[q + 1], B = orig[q + 2];
      if (tool === "tone") {
        const L = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
        const a = wgt * k * 0.18;
        if (toneMode === "dodge") { const f = 1 + a * (1.2 - L); dd[q] = R * f + a * 20; dd[q + 1] = G * f + a * 20; dd[q + 2] = B * f + a * 20; }
        else if (toneMode === "burn") { const f = 1 - a * (0.4 + L * 0.6); dd[q] = R * f; dd[q + 1] = G * f; dd[q + 2] = B * f; }
        else { const avg = (R + G + B) / 3, f = toneMode === "sponge+" ? 1 + a * 2 : 1 - a * 2; dd[q] = avg + (R - avg) * f; dd[q + 1] = avg + (G - avg) * f; dd[q + 2] = avg + (B - avg) * f; }
      } else if (tool === "focus" && focusMode === "sharpen") {
        const at = (ii: number, jj: number, c: number) => orig[((Math.min(sh - 1, Math.max(0, jj)) * sw + Math.min(sw - 1, Math.max(0, ii))) * 4) + c];
        for (let c = 0; c < 3; c++) {
          const lap = 4 * at(i, j, c) - at(i - 1, j, c) - at(i + 1, j, c) - at(i, j - 1, c) - at(i, j + 1, c);
          dd[q + c] = orig[q + c] + lap * wgt * k * 0.35;
        }
      }
    }
    wg.putImageData(id, sx, sy);
  };

  const bestPatch = (src: HTMLCanvasElement, x: number, y: number, r: number): Pt => {
    const g = c2d(src);
    const avg = (cx: number, cy: number, rad: number) => {
      const s = Math.max(1, Math.round(rad * 2));
      const sx = Math.round(cx - rad), sy = Math.round(cy - rad);
      if (sx < 0 || sy < 0 || sx + s > src.width || sy + s > src.height) return null;
      const d = g.getImageData(sx, sy, s, s).data;
      let R = 0, G = 0, B = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
      return [R / n, G / n, B / n];
    };
    const ring = avg(x, y, r * 1.8) ?? [128, 128, 128];
    let best = { x: r * 2.4, y: 0 }, bd = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, ox = Math.cos(a) * r * 2.4, oy = Math.sin(a) * r * 2.4;
      const c = avg(x + ox, y + oy, r);
      if (!c) continue;
      const diff = Math.abs(c[0] - ring[0]) + Math.abs(c[1] - ring[1]) + Math.abs(c[2] - ring[2]);
      if (diff < bd) { bd = diff; best = { x: ox, y: oy }; }
    }
    return best;
  };

  const renderGradient = (c: HTMLCanvasElement, a: Pt, b: Pt) => {
    const g = c2d(c);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, c.width, c.height);
    const end = grad.trans ? fg + "00" : bg;
    let gr: CanvasGradient;
    if (grad.type === "radial") gr = g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)));
    else if (grad.type === "reflected") { gr = g.createLinearGradient(a.x - (b.x - a.x), a.y - (b.y - a.y), b.x, b.y); gr.addColorStop(0, end); gr.addColorStop(0.5, fg); gr.addColorStop(1, end); }
    else gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
    if (grad.type !== "reflected") { gr.addColorStop(0, fg); gr.addColorStop(1, end); }
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    const sel = docRef.current.sel;
    if (sel) { g.globalCompositeOperation = "destination-in"; g.drawImage(sel, 0, 0); g.globalCompositeOperation = "source-over"; }
  };

  const renderShape = (c: HTMLCanvasElement, a: Pt, b: Pt, constrain: boolean) => {
    const g = c2d(c);
    g.clearRect(0, 0, c.width, c.height);
    let w = b.x - a.x, h = b.y - a.y;
    if (constrain && shape.kind !== "line" && shape.kind !== "arrow") { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    g.fillStyle = fg;
    g.strokeStyle = shape.kind === "line" || shape.kind === "arrow" ? fg : bg;
    g.lineWidth = shape.sw;
    g.lineJoin = "round";
    g.lineCap = "round";
    g.beginPath();
    if (shape.kind === "line" || shape.kind === "arrow") {
      g.moveTo(a.x, a.y); g.lineTo(a.x + w, a.y + h); g.stroke();
      if (shape.kind === "arrow") {
        const ang = Math.atan2(h, w), L = Math.max(12, shape.sw * 3.5);
        g.beginPath(); g.moveTo(a.x + w, a.y + h);
        g.lineTo(a.x + w - Math.cos(ang - 0.45) * L, a.y + h - Math.sin(ang - 0.45) * L);
        g.lineTo(a.x + w - Math.cos(ang + 0.45) * L, a.y + h - Math.sin(ang + 0.45) * L);
        g.closePath(); g.fill();
      }
      return;
    }
    const r = normRect(a.x, a.y, w, h, null);
    if (shape.kind === "ellipse") g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else if (shape.kind === "round") g.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.18);
    else g.rect(r.x, r.y, r.w, r.h);
    if (shape.fill) g.fill();
    if (shape.stroke) g.stroke();
  };

  // ── tek tık araçları ──
  const pick = (p: Pt, toBg: boolean) => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
    const d = c2d(comp).getImageData(x, y, 1, 1).data;
    const hx = rgbToHex(d[0], d[1], d[2]);
    if (toBg) setBg(hx); else setFg(hx);
  };

  const wand = (p: Pt, mode: SelMode) => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
    const src = sampleAll ? comp : activeLayer(doc).canvas;
    const m = floodMask(c2d(src).getImageData(0, 0, doc.w, doc.h), x, y, tol, contig);
    const sel = combineSel(doc, feather > 0 ? blurCanvas(selFromMask(doc.w, doc.h, m), feather) : selFromMask(doc.w, doc.h, m), mode);
    commit("Sihirli değnek", { ...doc, sel });
  };

  const bucket = (p: Pt) => {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
    const l = activeLayer(doc), base = target(doc, l);
    const m = floodMask(c2d(sampleAll ? comp : base).getImageData(0, 0, doc.w, doc.h), x, y, tol, contig);
    const fill = selFromMask(doc.w, doc.h, m);
    const fg2 = c2d(fill);
    fg2.globalCompositeOperation = "source-in";
    fg2.fillStyle = doc.editMask && l.mask ? "#fff" : fg;
    fg2.fillRect(0, 0, doc.w, doc.h);
    if (doc.sel) { fg2.globalCompositeOperation = "destination-in"; fg2.drawImage(doc.sel, 0, 0); }
    const out = clone(base), og = c2d(out);
    og.globalAlpha = brush.opacity / 100;
    og.drawImage(fill, 0, 0);
    commit("Boya kovası", withTarget(doc, l, out));
  };

  const textClick = (p: Pt) => {
    const hit = [...doc.layers].reverse().find((l) => l.text && l.visible && inRect(p, textBounds(l.text)));
    if (hit) { silent((d) => ({ ...d, active: hit.id, editMask: false })); setPanel("color"); return; }
    const t = defaultText(Math.round(p.x), Math.round(p.y), fg);
    t.size = Math.max(16, Math.round(doc.h / 14));
    const nl: Layer = { ...newLayer(doc.w, doc.h, tx("Yazı")), text: t, canvas: renderText(doc.w, doc.h, t) };
    const i = doc.layers.findIndex((x) => x.id === doc.active);
    const layers = [...doc.layers];
    layers.splice(i + 1, 0, nl);
    commit("Yazı katmanı", { ...doc, layers, active: nl.id, editMask: false });
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".wp-text textarea")?.select(), 60);
  };

  // ── serbest dönüştürme ──
  const startTf = () => {
    const d = docRef.current, l = activeLayer(d);
    if (l.locked) return flashMsg(tx("Katman kilitli"));
    const base = l.text ? l.canvas : target(d, l);
    let float = base, rest = mk(d.w, d.h);
    if (d.sel) {
      float = clone(base); const g = c2d(float); g.globalCompositeOperation = "destination-in"; g.drawImage(d.sel, 0, 0);
      rest = clone(base); const rg = c2d(rest); rg.globalCompositeOperation = "destination-out"; rg.drawImage(d.sel, 0, 0);
    }
    const box = alphaBounds(float);
    if (!box) return flashMsg(tx("Dönüştürülecek piksel yok"));
    const crop = mk(box.w, box.h);
    c2d(crop).drawImage(float, -box.x, -box.y);
    setTool("move");
    setTf({ layerId: l.id, float: crop, base: rest, box, cx: box.x + box.w / 2, cy: box.y + box.h / 2, sx: 1, sy: 1, rot: 0, sel: d.sel });
  };
  const tfCanvas = (t: Tf) => {
    const out = clone(t.base), g = c2d(out);
    g.imageSmoothingQuality = "high";
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.translate(t.cx, t.cy);
    g.rotate(t.rot);
    g.scale(t.sx, t.sy);
    g.drawImage(t.float, -t.box.w / 2, -t.box.h / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return out;
  };
  useEffect(() => {
    if (!tf) return;
    const l = docRef.current.layers.find((x) => x.id === tf.layerId);
    if (l) setPreview(l, tfCanvas(tf));
  }, [tf]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyTf = () => {
    if (!tf) return;
    const d = docRef.current, l = d.layers.find((x) => x.id === tf.layerId)!;
    const out = tfCanvas(tf);
    preview.current = null;
    let next = withTarget(d, l, out);
    if (tf.sel) {
      const s = mk(d.w, d.h), g = c2d(s);
      g.translate(tf.cx, tf.cy); g.rotate(tf.rot); g.scale(tf.sx, tf.sy);
      g.drawImage(tf.sel, -(tf.box.x + tf.box.w / 2), -(tf.box.y + tf.box.h / 2));
      next = { ...next, sel: s };
    }
    setTf(null);
    commit("Serbest dönüştür", next);
  };
  const cancelTf = () => { setTf(null); preview.current = null; dirty.current = true; draw(); };
  const hitTf = (t: Tf, p: Pt): [number, number] | "move" | "rotate" => {
    const z = vz.current.zoom, dx = p.x - t.cx, dy = p.y - t.cy, c = Math.cos(-t.rot), s = Math.sin(-t.rot);
    const lx = dx * c - dy * s, ly = dx * s + dy * c, hw = (t.box.w / 2) * Math.abs(t.sx), hh = (t.box.h / 2) * Math.abs(t.sy), tol = 9 / z;
    for (const [hx, hy] of HANDLES) if (Math.abs(lx - hx * hw) < tol && Math.abs(ly - hy * hh) < tol) return [hx, hy];
    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return "move";
    return "rotate";
  };
  const dragTf = (t0: Tf, h: [number, number] | "move" | "rotate", start: Pt, p: Pt, a0: number, shiftKey: boolean): Tf => {
    if (h === "move") return { ...t0, cx: t0.cx + (p.x - start.x), cy: t0.cy + (p.y - start.y) };
    if (h === "rotate") {
      let r = t0.rot + Math.atan2(p.y - t0.cy, p.x - t0.cx) - a0;
      if (shiftKey) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
      return { ...t0, rot: r };
    }
    const dx = p.x - t0.cx, dy = p.y - t0.cy, c = Math.cos(-t0.rot), s = Math.sin(-t0.rot);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    let sx = h[0] ? (lx * h[0]) / (t0.box.w / 2) : t0.sx, sy = h[1] ? (ly * h[1]) / (t0.box.h / 2) : t0.sy;
    if (shiftKey && h[0] && h[1]) { const k = Math.max(sx / t0.sx, sy / t0.sy); sx = t0.sx * k; sy = t0.sy * k; }
    return { ...t0, sx: Math.max(0.01, sx), sy: Math.max(0.01, sy) };
  };

  // ── kırpma ──
  const applyCrop = (r = cropRect) => {
    if (!r || r.w < 2 || r.h < 2) return;
    const d = docRef.current, x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
    const cut = (c: HTMLCanvasElement | null) => { if (!c) return null; const o = mk(w, h); c2d(o).drawImage(c, -x, -y); return o; };
    const layers = d.layers.map((l) => ({ ...l, canvas: cut(l.canvas)!, mask: cut(l.mask), text: l.text ? { ...l.text, x: l.text.x - x, y: l.text.y - y } : null }));
    setCropRect(null);
    commit("Kırp", { ...d, w, h, layers, sel: cut(d.sel) });
    window.setTimeout(fit, 30);
  };

  // ── belge işlemleri ──
  const mapAll = (label: string, w: number, h: number, fn: (c: HTMLCanvasElement) => HTMLCanvasElement, keepText = false) => {
    const d = docRef.current;
    commit(label, { ...d, w, h, layers: d.layers.map((l) => ({ ...l, canvas: fn(l.canvas), mask: l.mask ? fn(l.mask) : null, text: keepText ? l.text : null })), sel: d.sel ? fn(d.sel) : null });
    window.setTimeout(fit, 30);
  };
  const rotateDoc = (deg: 90 | -90 | 180) => {
    const d = docRef.current, sw = deg === 180 ? d.w : d.h, sh = deg === 180 ? d.h : d.w;
    mapAll(tx("Tuvali döndür"), sw, sh, (c) => { const o = mk(sw, sh), g = c2d(o); g.translate(sw / 2, sh / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(c, -c.width / 2, -c.height / 2); return o; });
  };
  const flipDoc = (hz: boolean) => { const d = docRef.current; mapAll(tx("Tuvali çevir"), d.w, d.h, (c) => flipC(c, hz)); };
  const flipLayer = (hz: boolean) => { const d = docRef.current, l = activeLayer(d); commit(hz ? "Yatay çevir" : "Dikey çevir", withTarget(d, l, throughSel(target(d, l), flipC(target(d, l), hz), null))); };

  const imageSize = () => {
    const d = docRef.current;
    setDialog({
      kind: "num", title: tx("Görüntü boyutu"), fields: [{ label: tx("Genişlik (px)"), value: d.w, min: 1, max: 16000 }, { label: tx("Yükseklik (px)"), value: d.h, min: 1, max: 16000 }], run: ([w, h]) => {
        const kx = w / d.w, ky = h / d.h;
        commit("Görüntü boyutu", {
          ...d, w, h, sel: d.sel ? scaleC(d.sel, w, h) : null,
          layers: d.layers.map((l) => {
            if (l.text) { const t = { ...l.text, x: l.text.x * kx, y: l.text.y * ky, size: l.text.size * Math.min(kx, ky) }; return { ...l, text: t, canvas: renderText(w, h, t), mask: l.mask ? scaleC(l.mask, w, h) : null }; }
            return { ...l, canvas: scaleC(l.canvas, w, h), mask: l.mask ? scaleC(l.mask, w, h) : null };
          }),
        });
        window.setTimeout(fit, 30);
      },
    });
  };
  const canvasSize = () => {
    const d = docRef.current;
    setDialog({
      kind: "num", title: tx("Tuval boyutu (ortalanır)"), fields: [{ label: tx("Genişlik (px)"), value: d.w, min: 1, max: 16000 }, { label: tx("Yükseklik (px)"), value: d.h, min: 1, max: 16000 }], run: ([w, h]) => {
        const ox = Math.round((w - d.w) / 2), oy = Math.round((h - d.h) / 2);
        const re = (c: HTMLCanvasElement) => { const o = mk(w, h); c2d(o).drawImage(c, ox, oy); return o; };
        commit("Tuval boyutu", { ...d, w, h, sel: d.sel ? re(d.sel) : null, layers: d.layers.map((l) => ({ ...l, canvas: l.text ? renderText(w, h, { ...l.text, x: l.text.x + ox, y: l.text.y + oy }) : re(l.canvas), text: l.text ? { ...l.text, x: l.text.x + ox, y: l.text.y + oy } : null, mask: l.mask ? reMask(l.mask, w, h, ox, oy) : null })) });
        window.setTimeout(fit, 30);
      },
    });
  };

  // ── katman işlemleri ──
  const addLayer = (l?: Layer, label = "Yeni katman") => {
    const d = docRef.current, nl = l ?? newLayer(d.w, d.h, tx("Katman {0}", d.layers.length));
    const i = d.layers.findIndex((x) => x.id === d.active), layers = [...d.layers];
    layers.splice(i + 1, 0, nl);
    commit(label, { ...d, layers, active: nl.id, editMask: false });
  };
  const dupLayer = () => { const d = docRef.current, l = activeLayer(d); addLayer({ ...l, id: uid(), name: `${l.name} ${tx("kopya")}`, canvas: clone(l.canvas), mask: l.mask ? clone(l.mask) : null }, "Katmanı çoğalt"); };
  const delLayer = () => {
    const d = docRef.current;
    if (d.layers.length < 2) return flashMsg(tx("Son katman silinemez"));
    const i = d.layers.findIndex((x) => x.id === d.active), layers = d.layers.filter((x) => x.id !== d.active);
    commit("Katmanı sil", { ...d, layers, active: layers[Math.max(0, i - 1)].id, editMask: false });
  };
  const moveLayer = (dir: 1 | -1) => {
    const d = docRef.current, i = d.layers.findIndex((x) => x.id === d.active), j = i + dir;
    if (j < 0 || j >= d.layers.length) return;
    const layers = [...d.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    commit(dir > 0 ? "Öne getir" : "Geri gönder", { ...d, layers });
  };
  const mergeDown = () => {
    const d = docRef.current, i = d.layers.findIndex((x) => x.id === d.active);
    if (i < 1) return;
    const lower = d.layers[i - 1], upper = d.layers[i];
    const out = clone(lower.mask ? (() => { const t = clone(lower.canvas), g = c2d(t); g.globalCompositeOperation = "destination-in"; g.drawImage(lower.mask!, 0, 0); return t; })() : lower.canvas);
    const tmpDoc: Doc = { ...d, layers: [{ ...lower, canvas: out, mask: null, opacity: 1, blend: "source-over", fx: {} }, upper] };
    const flat = flatten(tmpDoc);
    const layers = d.layers.filter((x) => x.id !== upper.id).map((x) => (x.id === lower.id ? { ...lower, canvas: flat, mask: null, text: null, fx: {}, opacity: lower.opacity } : x));
    commit("Aşağı birleştir", { ...d, layers, active: lower.id, editMask: false });
  };
  const mergeVisible = () => { const d = docRef.current, flat = flatten(d); const nl = newLayer(d.w, d.h, tx("Birleştirilmiş"), flat); commit("Görünenleri birleştir", { ...d, layers: [...d.layers.filter((l) => !l.visible), nl], active: nl.id, editMask: false }); };
  const flattenAll = () => { const d = docRef.current, flat = mk(d.w, d.h), g = c2d(flat); g.fillStyle = "#fff"; g.fillRect(0, 0, d.w, d.h); g.drawImage(flatten(d), 0, 0); const nl = newLayer(d.w, d.h, tx("Arka plan"), flat); commit("Düzleştir", { ...d, layers: [nl], active: nl.id, editMask: false }); };
  const addMask = (fromSel: boolean) => {
    const d = docRef.current, l = activeLayer(d), m = mk(d.w, d.h), g = c2d(m);
    if (fromSel && d.sel) g.drawImage(d.sel, 0, 0); else { g.fillStyle = "#fff"; g.fillRect(0, 0, d.w, d.h); }
    commit("Katman maskesi", { ...patchLayer(d, l.id, { mask: m, maskOn: true }), editMask: true, sel: fromSel ? null : d.sel });
  };
  const applyMask = () => {
    const d = docRef.current, l = activeLayer(d);
    if (!l.mask) return;
    const c = clone(l.canvas), g = c2d(c);
    g.globalCompositeOperation = "destination-in"; g.drawImage(l.mask, 0, 0);
    commit("Maskeyi uygula", { ...patchLayer(d, l.id, { canvas: c, mask: null, text: null }), editMask: false });
  };
  const removeMask = () => { const d = docRef.current, l = activeLayer(d); commit("Maskeyi sil", { ...patchLayer(d, l.id, { mask: null }), editMask: false }); };
  const rasterize = () => { const d = docRef.current, l = activeLayer(d); if (l.text) commit("Rasterleştir", patchLayer(d, l.id, { text: null })); };
  const selFromLayer = (id?: string) => { const d = docRef.current, l = d.layers.find((x) => x.id === (id ?? d.active))!; commit("Katman saydamlığından seç", { ...d, sel: clone(l.canvas) }); };

  // ── düzen ──
  const fillSel = (color: string) => {
    const d = docRef.current, l = activeLayer(d), base = target(d, l), fill = mk(d.w, d.h), g = c2d(fill);
    g.fillStyle = d.editMask && l.mask ? color : color;
    g.fillRect(0, 0, d.w, d.h);
    commit("Doldur", withTarget(d, l, throughSel(base, (() => { const o = clone(base); c2d(o).drawImage(fill, 0, 0); return o; })(), d.sel)));
  };
  const strokeSel = () => {
    const d = docRef.current;
    if (!d.sel) return flashMsg(tx("Önce bir seçim yap"));
    setDialog({
      kind: "num", title: tx("Kontur genişliği"), fields: [{ label: tx("Genişlik (px)"), value: 4, min: 1, max: 100 }], run: ([w]) => {
        const l = activeLayer(d), out = clone(target(d, l));
        const ring = growSel(d.sel!, w), rg = c2d(ring);
        rg.globalCompositeOperation = "destination-out"; rg.drawImage(d.sel!, 0, 0);
        rg.globalCompositeOperation = "source-in"; rg.fillStyle = fg; rg.fillRect(0, 0, d.w, d.h);
        c2d(out).drawImage(ring, 0, 0);
        commit("Kontur", withTarget(d, l, out));
      },
    });
  };
  const clearSel = () => {
    const d = docRef.current, l = activeLayer(d);
    if (!d.sel) return;
    const out = clone(target(d, l)), g = c2d(out);
    g.globalCompositeOperation = "destination-out"; g.drawImage(d.sel, 0, 0);
    commit("Sil", withTarget(d, l, out));
  };
  const copySel = (merged = false) => {
    const d = docRef.current, src = merged ? flatten(d) : activeLayer(d).canvas, c = clone(src);
    if (d.sel) { const g = c2d(c); g.globalCompositeOperation = "destination-in"; g.drawImage(d.sel, 0, 0); }
    const b = alphaBounds(c);
    if (!b) return;
    const out = mk(b.w, b.h);
    c2d(out).drawImage(c, -b.x, -b.y);
    clipboard.current = { canvas: out, x: b.x, y: b.y };
    void onCopy(out).catch(() => undefined);
    flashMsg(tx("Kopyalandı"));
  };
  const cut = () => { copySel(); clearSel(); };
  const paste = () => {
    const c = clipboard.current, d = docRef.current;
    if (!c) return flashMsg(tx("Pano boş"));
    addLayer(newLayer(d.w, d.h, tx("Yapıştırılan"), c.canvas, c.x, c.y), "Yapıştır");
  };
  const placeImage = (f: File) => {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      const d = docRef.current, k = Math.min(1, d.w / img.width, d.h / img.height), w = img.width * k, h = img.height * k;
      const l = newLayer(d.w, d.h, f.name.replace(/\.[^.]+$/, ""));
      c2d(l.canvas).drawImage(img, (d.w - w) / 2, (d.h - h) / 2, w, h);
      addLayer(l, "Görüntü yerleştir");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  // ── ayarlama/filtre ──
  const openOp = (op: Op) => {
    setMenu(null);
    if (!op.params.length && !op.special) return runOp(op, {});
    setDialog({ kind: "op", op, values: defaults(op) });
  };
  const opPreview = (op: Op, v: Values | null) => {
    const d = docRef.current, l = activeLayer(d);
    if (!v) { preview.current = null; dirty.current = true; draw(); return; }
    const base = target(d, l);
    setPreview(l, throughSel(base, op.run(base, v, { fg, bg }), d.sel));
  };
  const runOp = (op: Op, v: Values) => {
    const d = docRef.current, l = activeLayer(d);
    if (l.locked) return flashMsg(tx("Katman kilitli"));
    setBusy(op.label);
    window.setTimeout(() => {
      try {
        const base = target(d, l);
        preview.current = null;
        commit(op.label, withTarget(d, l, throughSel(base, op.run(base, v, { fg, bg }), d.sel)));
        if (FILTERS.some((f) => f.id === op.id)) lastFilter.current = { op, values: v };
      } finally { setBusy(null); setDialog(null); }
    }, 16);
  };
  const autoTone = () => {
    const d = docRef.current, l = activeLayer(d), base = target(d, l), dd = c2d(base).getImageData(0, 0, d.w, d.h).data;
    const lo = [0, 0, 0], hi = [255, 255, 255];
    for (let c = 0; c < 3; c++) {
      const h = new Uint32Array(256); let n = 0;
      for (let i = c; i < dd.length; i += 4) if (dd[i - c + 3] > 8) { h[dd[i]]++; n++; }
      const cut = n * 0.005; let s = 0;
      for (let v = 0; v < 256; v++) { s += h[v]; if (s > cut) { lo[c] = v; break; } }
      s = 0;
      for (let v = 255; v >= 0; v--) { s += h[v]; if (s > cut) { hi[c] = v; break; } }
    }
    const out = clone(base), g = c2d(out), id = g.getImageData(0, 0, d.w, d.h);
    for (let i = 0; i < id.data.length; i += 4) for (let c = 0; c < 3; c++) id.data[i + c] = ((id.data[i + c] - lo[c]) * 255) / Math.max(1, hi[c] - lo[c]);
    g.putImageData(id, 0, 0);
    commit("Otomatik ton", withTarget(d, l, throughSel(base, out, d.sel)));
  };

  // ── mesaj ──
  const [msg, setMsg] = useState<string | null>(null);
  const flashMsg = (m: string) => { setMsg(m); window.setTimeout(() => setMsg((x) => (x === m ? null : x)), 2200); };

  // ── klavye ──
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (document.querySelector(".guide-layer")) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if (k === " ") { space.current = true; e.preventDefault(); return; }
      if (tfRef.current) { if (k === "enter") { applyTf(); return; } if (k === "escape") { cancelTf(); return; } }
      if (cropRectRef.current) { if (k === "enter") { applyCrop(cropRectRef.current); return; } if (k === "escape") { setCropRect(null); return; } }
      if (ctrl) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? redo() : undo()), y: redo, a: () => commit("Tümünü seç", { ...docRef.current, sel: (() => { const s = mk(docRef.current.w, docRef.current.h), g = c2d(s); g.fillStyle = "#fff"; g.fillRect(0, 0, s.width, s.height); return s; })() }),
          d: () => commit("Seçimi kaldır", { ...docRef.current, sel: null }), i: () => e.shiftKey && commit("Seçimi tersine çevir", { ...docRef.current, sel: invertSel(docRef.current) }),
          j: dupLayer, e: () => (e.shiftKey ? mergeVisible() : mergeDown()), n: () => e.shiftKey && addLayer(), t: startTf,
          c: () => copySel(e.shiftKey), x: cut, v: paste, s: () => void save(), f: () => lastFilter.current && runOp(lastFilter.current.op, lastFilter.current.values),
          "0": fit, "1": actual, "=": () => zoomAt(1.25), "+": () => zoomAt(1.25), "-": () => zoomAt(0.8), "]": () => moveLayer(1), "[": () => moveLayer(-1),
          l: () => openOp(ADJUSTMENTS.find((x) => x.id === "levels")!), m: () => openOp(ADJUSTMENTS.find((x) => x.id === "curves")!), u: () => openOp(ADJUSTMENTS.find((x) => x.id === "hsl")!),
          backspace: () => fillSel(bg),
        };
        const f = map[k];
        if (f) { e.preventDefault(); f(); }
        return;
      }
      if (e.altKey && k === "backspace") { e.preventDefault(); fillSel(fg); return; }
      if (k === "delete" || k === "backspace") { clearSel(); return; }
      if (k === "escape") { setMenu(null); return; }
      if (k === "x") { setFg(bg); setBg(fg); return; }
      if (k === "d") { setFg("#000000"); setBg("#ffffff"); return; }
      if (k === "[") { setBrush((b) => ({ ...b, size: Math.max(1, Math.round(b.size / 1.2)) })); draw(); return; }
      if (k === "]") { setBrush((b) => ({ ...b, size: Math.min(1000, Math.round(b.size * 1.2) + 1) })); draw(); return; }
      if (/^[0-9]$/.test(k) && ["brush", "eraser", "clone", "gradient"].includes(toolRef.current)) { setBrush((b) => ({ ...b, opacity: k === "0" ? 100 : +k * 10 })); return; }
      if (toolRef.current === "move" && k.startsWith("arrow")) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1, dx = k === "arrowleft" ? -n : k === "arrowright" ? n : 0, dy = k === "arrowup" ? -n : k === "arrowdown" ? n : 0;
        const d = docRef.current, l = activeLayer(d);
        if (l.text) { const t = { ...l.text, x: l.text.x + dx, y: l.text.y + dy }; commit("Taşı", patchLayer(d, l.id, { text: t, canvas: renderText(d.w, d.h, t) })); }
        else commit("Taşı", withTarget(d, l, shift(target(d, l), dx, dy)));
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) setTool(t.id);
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  });

  const onWheel = (e: React.WheelEvent) => {
    const r = view.current!.getBoundingClientRect();
    if (e.ctrlKey || e.altKey || !e.shiftKey) { zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); return; }
    vz.current.px -= e.deltaY;
    draw();
  };

  const save = async () => { setBusy("save"); try { await onSaveCopy(flattenOpaque(docRef.current)); } finally { setBusy(null); } };
  const flattenOpaque = (d: Doc) => flatten(d);

  // ── menüler ──
  const fileIn = useRef<HTMLInputElement>(null);
  type Item = { l: string; k?: string; f: () => void; off?: boolean } | "-" | { h: string };
  const menus: { id: string; label: string; items: Item[] }[] = [
    { id: "file", label: tx("Dosya"), items: [
      { l: tx("Görüntü yerleştir (yeni katman)…"), f: () => fileIn.current?.click() },
      "-",
      { l: tx("Kopya olarak kaydet"), k: "Ctrl+S", f: () => void save() },
      { l: tx("PNG olarak dışa aktar…"), f: () => void onExport(flatten(docRef.current), "png") },
      { l: tx("JPG olarak dışa aktar…"), f: () => void onExport(flatten(docRef.current), "jpg") },
      { l: tx("Birleşik kopyala (panoya)"), k: "Ctrl+Shift+C", f: () => copySel(true) },
      "-",
      { l: tx("Kapat"), f: onClose },
    ] },
    { id: "edit", label: tx("Düzen"), items: [
      { l: tx("Geri al"), k: "Ctrl+Z", f: undo, off: hist.index === 0 },
      { l: tx("Yinele"), k: "Ctrl+Y", f: redo, off: hist.index >= hist.items.length - 1 },
      "-",
      { l: tx("Kes"), k: "Ctrl+X", f: cut, off: !doc.sel },
      { l: tx("Kopyala"), k: "Ctrl+C", f: () => copySel() },
      { l: tx("Yapıştır"), k: "Ctrl+V", f: paste },
      { l: tx("Temizle"), k: "Del", f: clearSel, off: !doc.sel },
      "-",
      { l: tx("Ön plan rengiyle doldur"), k: "Alt+⌫", f: () => fillSel(fg) },
      { l: tx("Arka plan rengiyle doldur"), k: "Ctrl+⌫", f: () => fillSel(bg) },
      { l: tx("Seçime kontur ver…"), f: strokeSel, off: !doc.sel },
      "-",
      { l: tx("Serbest dönüştür"), k: "Ctrl+T", f: startTf },
      { l: tx("Katmanı yatay çevir"), f: () => flipLayer(true) },
      { l: tx("Katmanı dikey çevir"), f: () => flipLayer(false) },
    ] },
    { id: "image", label: tx("Görüntü"), items: [
      { l: tx("Görüntü boyutu…"), f: imageSize },
      { l: tx("Tuval boyutu…"), f: canvasSize },
      { l: tx("Seçime kırp"), f: () => { const b = doc.sel && alphaBounds(doc.sel); if (b) applyCrop(b); }, off: !doc.sel },
      "-",
      { l: tx("90° saat yönünde döndür"), f: () => rotateDoc(90) },
      { l: tx("90° saat yönünün tersine"), f: () => rotateDoc(-90) },
      { l: tx("180° döndür"), f: () => rotateDoc(180) },
      { l: tx("Tuvali yatay çevir"), f: () => flipDoc(true) },
      { l: tx("Tuvali dikey çevir"), f: () => flipDoc(false) },
      "-",
      { l: tx("Otomatik ton"), f: autoTone },
    ] },
    { id: "layer", label: tx("Katman"), items: [
      { l: tx("Yeni katman"), k: "Ctrl+Shift+N", f: () => addLayer() },
      { l: tx("Katmanı çoğalt"), k: "Ctrl+J", f: dupLayer },
      { l: tx("Katmanı sil"), f: delLayer },
      "-",
      { l: tx("Maske ekle (tümünü göster)"), f: () => addMask(false), off: !!layer.mask },
      { l: tx("Seçimden maske ekle"), f: () => addMask(true), off: !!layer.mask || !doc.sel },
      { l: tx("Maskeyi uygula"), f: applyMask, off: !layer.mask },
      { l: tx("Maskeyi sil"), f: removeMask, off: !layer.mask },
      "-",
      { l: tx("Katman stili…"), f: () => setDialog({ kind: "fx" }) },
      { l: tx("Yazıyı rasterleştir"), f: rasterize, off: !layer.text },
      "-",
      { l: tx("Öne getir"), k: "Ctrl+]", f: () => moveLayer(1) },
      { l: tx("Geri gönder"), k: "Ctrl+[", f: () => moveLayer(-1) },
      { l: tx("Aşağı birleştir"), k: "Ctrl+E", f: mergeDown },
      { l: tx("Görünenleri birleştir"), k: "Ctrl+Shift+E", f: mergeVisible },
      { l: tx("Görüntüyü düzleştir"), f: flattenAll },
    ] },
    { id: "select", label: tx("Seç"), items: [
      { l: tx("Tümü"), k: "Ctrl+A", f: () => { const d = docRef.current, s = mk(d.w, d.h), g = c2d(s); g.fillStyle = "#fff"; g.fillRect(0, 0, d.w, d.h); commit("Tümünü seç", { ...d, sel: s }); } },
      { l: tx("Seçimi kaldır"), k: "Ctrl+D", f: () => commit("Seçimi kaldır", { ...docRef.current, sel: null }), off: !doc.sel },
      { l: tx("Tersine çevir"), k: "Ctrl+Shift+I", f: () => commit("Seçimi tersine çevir", { ...docRef.current, sel: invertSel(docRef.current) }) },
      "-",
      { l: tx("Genişlet…"), f: () => numSel(tx("Seçimi genişlet"), (v) => growSel(docRef.current.sel!, v)), off: !doc.sel },
      { l: tx("Daralt…"), f: () => numSel(tx("Seçimi daralt"), (v) => growSel(docRef.current.sel!, -v)), off: !doc.sel },
      { l: tx("Yumuşat (geçiş)…"), f: () => numSel(tx("Seçimi yumuşat"), (v) => blurCanvas(docRef.current.sel!, v)), off: !doc.sel },
      "-",
      { l: tx("Katman saydamlığından seç"), f: () => selFromLayer() },
      { l: tx("Renk aralığı (ön plan rengi)"), f: () => colorRange() },
    ] },
    { id: "adjust", label: tx("Ayarlama"), items: ADJUSTMENTS.map((op) => ({ l: tx(op.label) + (op.params.length || op.special ? "…" : ""), f: () => openOp(op) })) },
    { id: "filter", label: tx("Filtre"), items: [
      { l: lastFilter.current ? tx("Tekrarla: {0}", tx(lastFilter.current.op.label)) : tx("Son filtreyi tekrarla"), k: "Ctrl+F", f: () => lastFilter.current && runOp(lastFilter.current.op, lastFilter.current.values), off: !lastFilter.current },
      ...[...new Set(FILTERS.map((f) => f.group))].flatMap((g) => [{ h: tx(g) } as Item, ...FILTERS.filter((f) => f.group === g).map((op) => ({ l: tx(op.label) + (op.params.length ? "…" : ""), f: () => openOp(op) }))]),
    ] },
    { id: "view", label: tx("Görünüm"), items: [
      { l: tx("Yakınlaştır"), k: "Ctrl++", f: () => zoomAt(1.25) },
      { l: tx("Uzaklaştır"), k: "Ctrl+-", f: () => zoomAt(0.8) },
      { l: tx("Ekrana sığdır"), k: "Ctrl+0", f: fit },
      { l: tx("Gerçek boyut (%100)"), k: "Ctrl+1", f: actual },
      "-",
      { l: grid ? tx("Izgarayı gizle") : tx("Izgarayı göster"), f: () => setGrid((g) => !g) },
    ] },
  ];
  const numSel = (title: string, fn: (v: number) => HTMLCanvasElement) => setDialog({ kind: "num", title, fields: [{ label: tx("Piksel"), value: 4, min: 1, max: 200 }], run: ([v]) => commit(title, { ...docRef.current, sel: fn(v) }) });
  const colorRange = () => {
    const d = docRef.current, src = flatten(d), id = c2d(src).getImageData(0, 0, d.w, d.h), [r, g, b] = hexToRgb(fg);
    const m = new Uint8Array(d.w * d.h);
    for (let i = 0; i < m.length; i++) { const k = i * 4; if (Math.abs(id.data[k] - r) + Math.abs(id.data[k + 1] - g) + Math.abs(id.data[k + 2] - b) <= tol * 3) m[i] = 1; }
    commit("Renk aralığı", { ...d, sel: selFromMask(d.w, d.h, m) });
  };

  const textLayer = layer.text ? layer : null;
  const updateText = (patch: Partial<NonNullable<Layer["text"]>>, label = "Yazıyı düzenle") => {
    const d = docRef.current, l = activeLayer(d);
    if (!l.text) return;
    const t = { ...l.text, ...patch };
    commit(label, patchLayer(d, l.id, { text: t, canvas: renderText(d.w, d.h, t) }));
  };

  const quick = (id: string, v: Values) => {
    const op = [...ADJUSTMENTS, ...FILTERS].find((o) => o.id === id);
    if (op) runOp(op, { ...defaults(op), ...v });
  };

  const guideSteps: GuideStep[] = [
    { title: tx("WestPhoto'ya hoş geldin!"), text: tx("Ekran görüntülerini katmanlarla, seçimlerle ve filtrelerle düzenleyebileceğin tam bir editör. Kısaca gezdireyim."), mood: "wave" },
    { target: "wp-tools", title: tx("Araçlar"), text: tx("Taşı, seçim, kırp, fırça, silgi, rötuş, degrade, ton, yazı ve şekil. Köşesinde nokta olan araca tekrar tıklayınca benzer araçlar açılır (ör. Seçim → Kement, Sihirli değnek)."), mood: "idle" },
    { target: "wp-opts", title: tx("Araç ayarları"), text: tx("Seçili aracın boyutu, sertliği, opaklığı gibi ayarları bu şeritte. Araç değişince şerit de değişir."), mood: "think" },
    { target: "wp-stage", title: tx("Tuval"), text: tx("Tekerlekle yakınlaş, boşluk tuşunu basılı tutup sürükleyerek kaydır. Seçim yaptığında her işlem yalnızca seçili alana uygulanır."), mood: "search" },
    { target: "wp-quick", title: tx("Hızlı düzenleme"), text: tx("Tek tıkla otomatik ton, canlı renkler, siyah-beyaz, minyatür gibi görünümler; tüm ayarlamalar ve filtreler de burada."), mood: "celebrate", enter: () => setPanel("quick") },
    { target: "wp-tabs", title: tx("Katmanlar"), text: tx("Her şeyi ayrı katmanlarda tut: göster/gizle, opaklık, karışım modu, maske ve gölge gibi stiller. Yazılar düzenlenebilir katman olarak kalır."), mood: "think", enter: () => setPanel("layers") },
    { target: "wp-menus", title: tx("Tüm komutlar"), text: tx("Görüntü boyutu, döndürme, seçimi genişletme, katman birleştirme gibi her şey üstteki menülerde. Kısayollar menüde yazıyor."), mood: "idle" },
    { target: "wp-save", title: tx("Kaydet"), text: tx("Bitince kopya olarak kaydet; orijinal ekran görüntün hiç değişmez. Takılırsan ? düğmesiyle beni tekrar çağır."), mood: "wave" },
  ];

  const cursor = tool === "hand" || space.current ? "grab" : tool === "zoom" ? "zoom-in" : tool === "move" ? "move" : tool === "text" ? "text" : ["brush", "eraser", "clone", "heal", "tone", "focus"].includes(tool) ? "none" : "crosshair";

  return (
    <div className="wp" onPointerDown={(e) => { const t = e.target as HTMLElement; if (!t.closest(".wp-menu")) setMenu(null); if (!t.closest(".wp-tgroup")) setFly(null); }}>
      <header className="wp-bar">
        <span className="wp-brand"><b>West</b>Photo</span>
        <nav className="wp-menus" data-guide="wp-menus">
          {menus.map((m) => (
            <div key={m.id} className="wp-menu">
              <button className={clsx(menu === m.id && "open")} onClick={() => setMenu(menu === m.id ? null : m.id)} onMouseEnter={() => menu && setMenu(m.id)}>{m.label}</button>
              {menu === m.id && (
                <div className="wp-drop">
                  {m.items.map((it, i) =>
                    it === "-" ? <hr key={i} /> : "h" in it ? <div key={i} className="wp-drop-h">{it.h}</div> : (
                      <button key={i} disabled={it.off} onClick={() => { setMenu(null); it.f(); }}>
                        <span>{it.l}</span>{it.k && <kbd>{it.k}</kbd>}
                      </button>
                    ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <span className="grow" />
        <span className="wp-title truncate">{title}</span>
        <span className="grow" />
        {busy && <span className="muted tiny"><Loader2 size={12} className="spin" /> {busy === "save" ? tx("Kaydediliyor…") : tx(busy)}</span>}
        <div className="wp-iconrow">
          <button className="icon-btn" title={tx("Geri al (Ctrl+Z)")} disabled={hist.index === 0} onClick={undo}><Undo2 size={16} /></button>
          <button className="icon-btn" title={tx("Yinele (Ctrl+Y)")} disabled={hist.index >= hist.items.length - 1} onClick={redo}><Redo2 size={16} /></button>
        </div>
        <div className="wp-zoom">
          <button title={tx("Uzaklaştır")} onClick={() => zoomAt(0.8)}><Minus size={13} /></button>
          <button className="wp-zoom-v" title={tx("Ekrana sığdır")} onClick={fit}>{zoomPct}%</button>
          <button title={tx("Yakınlaştır")} onClick={() => zoomAt(1.25)}><Plus size={13} /></button>
        </div>
        <button className="icon-btn" title={tx("Ashi'den yardım al")} onClick={() => setGuide(true)}><HelpCircle size={16} /></button>
        {onSimple && <button className="btn btn-ghost btn-sm" title={tx("Basit düzenleyiciye dön")} onClick={onSimple}>{tx("Basit mod")}</button>}
        <button data-guide="wp-save" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void save()}><Save size={14} /> {tx("Kopya olarak kaydet")}</button>
        <button className="icon-btn" title={tx("WestPhoto'yu kapat")} onClick={onClose}><X size={17} /></button>
        <input ref={fileIn} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) placeImage(f); e.target.value = ""; }} />
      </header>

      {/* Seçenek çubuğu */}
      <div className="wp-opts" data-guide="wp-opts">
        <span className="wp-opts-tool">{tx(TOOLS.find((t) => t.id === tool)!.label)}</span>
        {tf ? (
          <>
            <label>{tx("G")} <input type="number" value={Math.round(tf.sx * 100)} onChange={(e) => setTf({ ...tf, sx: Math.max(1, +e.target.value) / 100 })} />%</label>
            <label>{tx("Y")} <input type="number" value={Math.round(tf.sy * 100)} onChange={(e) => setTf({ ...tf, sy: Math.max(1, +e.target.value) / 100 })} />%</label>
            <label>{tx("Açı")} <input type="number" value={Math.round((tf.rot * 180) / Math.PI)} onChange={(e) => setTf({ ...tf, rot: (+e.target.value * Math.PI) / 180 })} />°</label>
            <button className="btn btn-ghost btn-sm" onClick={() => setTf({ ...tf, sx: -tf.sx })}><ArrowLeftRight size={13} /> {tx("Yatay çevir")}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTf({ ...tf, sy: -tf.sy })}>{tx("Dikey çevir")}</button>
            <span className="grow" />
            <span className="muted tiny">{tx("Köşe: ölçekle (Shift orantılı) · içi: taşı · dışı: döndür (Shift 15°)")}</span>
            <button className="btn btn-ghost btn-sm" onClick={cancelTf}>{tx("İptal")}</button>
            <button className="btn btn-primary btn-sm" onClick={applyTf}><Check size={13} /> {tx("Uygula")}</button>
          </>
        ) : (
          <>
            {["brush", "eraser", "clone", "heal", "tone", "focus"].includes(tool) && (
              <>
                <Slider label={tx("Boyut")} v={brush.size} min={1} max={500} on={(v) => setBrush({ ...brush, size: v })} unit="px" />
                <Slider label={tx("Sertlik")} v={brush.hardness} min={0} max={100} on={(v) => setBrush({ ...brush, hardness: v })} unit="%" />
                {["brush", "eraser", "clone"].includes(tool) && <Slider label={tx("Opaklık")} v={brush.opacity} min={1} max={100} on={(v) => setBrush({ ...brush, opacity: v })} unit="%" />}
                {["brush", "eraser", "clone"].includes(tool) && <Slider label={tx("Akış")} v={brush.flow} min={1} max={100} on={(v) => setBrush({ ...brush, flow: v })} unit="%" />}
              </>
            )}
            {tool === "tone" && (
              <>
                <Seg v={toneMode} on={setToneMode} opts={[["dodge", tx("Soldur")], ["burn", tx("Yak")], ["sponge-", tx("Sünger: soldur")], ["sponge+", tx("Sünger: doygunlaştır")]]} />
                <Slider label={tx("Pozlama")} v={strength} min={1} max={100} on={setStrength} unit="%" />
              </>
            )}
            {tool === "focus" && (
              <>
                <Seg v={focusMode} on={setFocusMode} opts={[["blur", tx("Bulanıklaştır")], ["sharpen", tx("Keskinleştir")], ["smudge", tx("Parmak")]]} />
                <Slider label={tx("Güç")} v={strength} min={1} max={100} on={setStrength} unit="%" />
              </>
            )}
            {tool === "clone" && <span className="muted tiny">{tx("Alt+tık: kaynak noktası")}</span>}
            {(tool === "marquee" || tool === "lasso" || tool === "wand") && (
              <>
                <Seg v={selMode} on={setSelMode} opts={[["new", tx("Yeni")], ["add", tx("Ekle")], ["sub", tx("Çıkar")], ["int", tx("Kesiştir")]]} />
                {tool === "marquee" && <Seg v={marqueeShape} on={setMarqueeShape} opts={[["rect", tx("Dikdörtgen")], ["ellipse", tx("Elips")]]} />}
                {tool !== "wand" && <Slider label={tx("Yumuşatma")} v={feather} min={0} max={100} on={setFeather} unit="px" />}
              </>
            )}
            {(tool === "wand" || tool === "bucket") && (
              <>
                <Slider label={tx("Tolerans")} v={tol} min={0} max={255} on={setTol} />
                <label className="check"><input type="checkbox" checked={contig} onChange={(e) => setContig(e.target.checked)} /> {tx("Bitişik")}</label>
                <label className="check"><input type="checkbox" checked={sampleAll} onChange={(e) => setSampleAll(e.target.checked)} /> {tx("Tüm katmanlardan örnekle")}</label>
              </>
            )}
            {tool === "bucket" && <Slider label={tx("Opaklık")} v={brush.opacity} min={1} max={100} on={(v) => setBrush({ ...brush, opacity: v })} unit="%" />}
            {tool === "gradient" && (
              <>
                <Seg v={grad.type} on={(t) => setGrad({ ...grad, type: t })} opts={[["linear", tx("Doğrusal")], ["radial", tx("Dairesel")], ["reflected", tx("Yansımalı")]]} />
                <Seg v={grad.trans ? "t" : "b"} on={(t) => setGrad({ ...grad, trans: t === "t" })} opts={[["b", tx("Ön → arka")], ["t", tx("Ön → saydam")]]} />
                <Slider label={tx("Opaklık")} v={brush.opacity} min={1} max={100} on={(v) => setBrush({ ...brush, opacity: v })} unit="%" />
              </>
            )}
            {tool === "shape" && (
              <>
                <Seg v={shape.kind} on={(k) => setShape({ ...shape, kind: k })} opts={[["rect", tx("Dikdörtgen")], ["round", tx("Yuvarlak köşe")], ["ellipse", tx("Elips")], ["line", tx("Çizgi")], ["arrow", tx("Ok")]]} />
                <label className="check"><input type="checkbox" checked={shape.fill} onChange={(e) => setShape({ ...shape, fill: e.target.checked })} /> {tx("Dolgu (ön plan)")}</label>
                <label className="check"><input type="checkbox" checked={shape.stroke} onChange={(e) => setShape({ ...shape, stroke: e.target.checked })} /> {tx("Kontur (arka plan)")}</label>
                <Slider label={tx("Kalınlık")} v={shape.sw} min={1} max={80} on={(v) => setShape({ ...shape, sw: v })} unit="px" />
              </>
            )}
            {tool === "crop" && (
              <>
                <Seg v={String(cropAspect)} on={(v) => setCropAspect(v === "null" ? null : +v)} opts={[["null", tx("Serbest")], [String(16 / 9), "16:9"], [String(4 / 3), "4:3"], ["1", "1:1"], [String(9 / 16), "9:16"]]} />
                {cropRect && <><button className="btn btn-ghost btn-sm" onClick={() => setCropRect(null)}>{tx("İptal")}</button><button className="btn btn-primary btn-sm" onClick={() => applyCrop()}><Check size={13} /> {tx("Kırp")}</button></>}
              </>
            )}
            {tool === "move" && <><button className="btn btn-ghost btn-sm" onClick={startTf}>{tx("Serbest dönüştür (Ctrl+T)")}</button><span className="muted tiny">{tx("Ok tuşları: 1 px · Shift: 10 px")}</span></>}
            {tool === "text" && <span className="muted tiny">{tx("Tıkla: yeni yazı · var olan yazıya tıkla: düzenle (sağ panel)")}</span>}
            {tool === "picker" && <span className="muted tiny">{tx("Tık: ön plan · Alt+tık: arka plan")}</span>}
            {tool === "zoom" && <span className="muted tiny">{tx("Tık: yakınlaştır · Alt+tık: uzaklaştır")}</span>}
            {doc.editMask && layer.mask && <span className="wp-maskpill">{tx("Maske düzenleniyor: beyaz gösterir, siyah gizler")}</span>}
          </>
        )}
      </div>

      <div className="wp-main">
        <aside className="wp-tools" data-guide="wp-tools">
          {GROUPS.map((g) => {
            const cur = g.tools.includes(tool) ? tool : lastInGroup[g.id] ?? g.tools[0];
            const info = TOOLS.find((x) => x.id === cur)!;
            const on = g.tools.includes(tool);
            return (
              <div key={g.id} className="wp-tgroup">
                <button
                  className={clsx(on && "active")}
                  title={`${tx(info.label)} (${info.key})${g.tools.length > 1 ? " · " + tx("tekrar tıkla: diğer araçlar") : ""}`}
                  onClick={() => (on && g.tools.length > 1 ? setFly(fly === g.id ? null : g.id) : setTool(cur))}
                >
                  <info.icon size={17} />
                  {g.tools.length > 1 && <i className="wp-more" />}
                </button>
                {fly === g.id && (
                  <div className="wp-fly">
                    {g.tools.map((id) => {
                      const t = TOOLS.find((x) => x.id === id)!;
                      return <button key={id} className={clsx(tool === id && "active")} onClick={() => setTool(id)}><t.icon size={15} /> <span>{tx(t.label)}</span> <kbd>{t.key}</kbd></button>;
                    })}
                  </div>
                )}
              </div>
            );
          })}
          <span className="grow" />
          <div className="wp-fgbg">
            <label className="fg" style={{ background: fg }} title={tx("Ön plan rengi")}><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} /></label>
            <label className="bg" style={{ background: bg }} title={tx("Arka plan rengi")}><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
            <button className="swap" title={tx("Renkleri değiştir (X)")} onClick={() => { setFg(bg); setBg(fg); }}>⇄</button>
          </div>
        </aside>

        <div className="wp-stage" ref={wrap} data-guide="wp-stage">
          <canvas
            ref={view}
            style={{ cursor }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={() => { overlay.current.cursor = undefined; draw(); }}
            onWheel={onWheel}
            onDoubleClick={() => { if (tool === "hand") fit(); }}
            onContextMenu={(e) => e.preventDefault()}
          />
          {msg && <div className="wp-toast">{msg}</div>}
          <div className="wp-coord">{doc.w}×{doc.h}{status && <> · {status.x}, {status.y} <i className="wp-sw" style={{ background: status.c }} /></>}</div>
        </div>

        <aside className="wp-side">
          <div className="wp-tabs" data-guide="wp-tabs">
            {([["layers", LayersIcon, tx("Katmanlar")], ["quick", Zap, tx("Hızlı")], ["color", Palette, tx("Renk")], ["history", HistoryIcon, tx("Geçmiş")]] as const).map(([id, Icon, label]) => (
              <button key={id} data-guide={id === "quick" ? "wp-quick" : undefined} className={clsx(panel === id && "active")} title={label} onClick={() => setPanel(id)}><Icon size={14} /> <span>{label}</span></button>
            ))}
          </div>
          {panel === "layers" && (
            <>
              {textLayer?.text && <div className="wp-panel"><TextPanel t={textLayer.text} onChange={updateText} /></div>}
              <LayersPanel
                doc={doc}
                onSelect={(id, mask) => silent((d) => ({ ...d, active: id, editMask: mask && !!d.layers.find((l) => l.id === id)?.mask }))}
                onPatch={(id, p, label) => (label ? commit(label, patchLayer(docRef.current, id, p)) : silent((d) => patchLayer(d, id, p)))}
                onAdd={() => addLayer()}
                onDup={dupLayer}
                onDel={delLayer}
                onMask={() => (layer.mask ? removeMask() : addMask(!!doc.sel))}
                onFx={() => setDialog({ kind: "fx" })}
                onMove={moveLayer}
                onMerge={mergeDown}
                onSelectPixels={(id) => selFromLayer(id)}
              />
            </>
          )}
          {panel === "quick" && (
            <div className="wp-panel wp-quick">
              <h5>{tx("Tek tıkla görünüm")}</h5>
              <div className="wp-looks">
                {LOOKS.map((l) => (
                  <button key={l.label} onClick={() => (l.op === "auto" ? autoTone() : quick(l.op, l.v))} style={{ background: l.bg }}><span>{tx(l.label)}</span></button>
                ))}
              </div>
              <h5>{tx("Ayarlamalar")}</h5>
              <div className="wp-chips">{ADJUSTMENTS.map((op) => <button key={op.id} onClick={() => openOp(op)}>{tx(op.label)}</button>)}</div>
              <h5>{tx("Filtreler")}</h5>
              <div className="wp-chips">{FILTERS.map((op) => <button key={op.id} onClick={() => openOp(op)}>{tx(op.label)}</button>)}</div>
              <p className="muted tiny">{tx("Seçim varsa yalnızca seçili alana uygulanır. Ctrl+Z ile geri alabilirsin.")}</p>
            </div>
          )}
          {panel === "color" && <div className="wp-panel"><ColorPanel fg={fg} bg={bg} setFg={setFg} setBg={setBg} /></div>}
          {panel === "history" && <div className="wp-panel"><HistoryPanel hist={hist} onJump={(i) => setHist((h) => ({ ...h, index: i }))} /></div>}
        </aside>
      </div>


      {dialog?.kind === "op" && (
        <OpDialog
          op={dialog.op}
          values={dialog.values}
          src={target(doc, layer)}
          onPreview={(v) => opPreview(dialog.op, v)}
          onCancel={() => { opPreview(dialog.op, null); setDialog(null); }}
          onApply={(v) => runOp(dialog.op, v)}
          busy={!!busy}
        />
      )}
      {dialog?.kind === "fx" && (
        <EffectsDialog
          layer={layer}
          onPreview={(fx) => { silent((d) => patchLayer(d, layer.id, { fx })); }}
          onDone={(fx, before) => { silent((d) => patchLayer(d, layer.id, { fx: before })); commit("Katman stili", patchLayer(docRef.current, layer.id, { fx })); setDialog(null); }}
          onCancel={(before) => { silent((d) => patchLayer(d, layer.id, { fx: before })); setDialog(null); }}
        />
      )}
      <AshiGuide steps={guideSteps} open={guide} onClose={() => setGuide(false)} label={tx("WestPhoto rehberi")} />
      {dialog?.kind === "num" && <NumDialog title={dialog.title} fields={dialog.fields} onCancel={() => setDialog(null)} onApply={(v) => { setDialog(null); dialog.run(v); }} />}
    </div>
  );
}

const LOOKS: { label: string; op: string; v: Values; bg: string }[] = [
  { label: "Otomatik", op: "auto", v: {}, bg: "linear-gradient(135deg,#3a6ea5,#e8a33d)" },
  { label: "Canlı", op: "vibrance", v: { v: 45, s: 10 }, bg: "linear-gradient(135deg,#ff5f6d,#ffc371)" },
  { label: "Sıcak", op: "photo", v: { c: "#ec8a2d", dn: 25, pl: true }, bg: "linear-gradient(135deg,#f6a35b,#b0522c)" },
  { label: "Soğuk", op: "photo", v: { c: "#3a86ff", dn: 22, pl: true }, bg: "linear-gradient(135deg,#4facfe,#2a3f8f)" },
  { label: "Siyah-Beyaz", op: "bw", v: {}, bg: "linear-gradient(135deg,#e6e6e6,#2b2b2b)" },
  { label: "Kontrast", op: "bc", v: { b: 0, c: 28 }, bg: "linear-gradient(135deg,#111,#f2f2f2)" },
  { label: "Işıltı", op: "glow", v: { t: 165, r: 18, k: 60 }, bg: "linear-gradient(135deg,#fceabb,#f8b500)" },
  { label: "Minyatür", op: "tilt", v: {}, bg: "linear-gradient(135deg,#43cea2,#185a9d)" },
  { label: "Vinyet", op: "vignette", v: {}, bg: "radial-gradient(circle,#c9b28a,#2a2016)" },
  { label: "Keskin", op: "unsharp", v: {}, bg: "linear-gradient(135deg,#8e9eab,#eef2f3)" },
];

const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const inRect = (p: Pt, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
function normRect(x: number, y: number, w: number, h: number, d: Doc | null) {
  let r = { x: w < 0 ? x + w : x, y: h < 0 ? y + h : y, w: Math.abs(w), h: Math.abs(h) };
  if (d) { const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y); r = { x: x0, y: y0, w: Math.min(d.w, r.x + r.w) - x0, h: Math.min(d.h, r.y + r.h) - y0 }; }
  return r;
}
function shift(c: HTMLCanvasElement, dx: number, dy: number) { const o = mk(c.width, c.height); c2d(o).drawImage(c, dx, dy); return o; }
function flipC(c: HTMLCanvasElement, hz: boolean) { const o = mk(c.width, c.height), g = c2d(o); g.translate(hz ? c.width : 0, hz ? 0 : c.height); g.scale(hz ? -1 : 1, hz ? 1 : -1); g.drawImage(c, 0, 0); return o; }
function scaleC(c: HTMLCanvasElement, w: number, h: number) { const o = mk(w, h), g = c2d(o); g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, w, h); return o; }
function reMask(m: HTMLCanvasElement, w: number, h: number, ox: number, oy: number) { const o = mk(w, h), g = c2d(o); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.clearRect(ox, oy, m.width, m.height); g.drawImage(m, ox, oy); return o; }
let checkerPat: CanvasPattern | null = null;
function checker(g: CanvasRenderingContext2D) {
  if (checkerPat) return checkerPat;
  const c = mk(16, 16), x = c2d(c);
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, 16, 16);
  x.fillStyle = "#d9d9de"; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  checkerPat = g.createPattern(c, "repeat")!;
  return checkerPat;
}

function Slider({ label, v, min, max, on, unit }: { label: string; v: number; min: number; max: number; on: (v: number) => void; unit?: string }) {
  return (
    <label className="wp-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)} />
      <input type="number" min={min} max={max} value={v} onChange={(e) => on(Math.min(max, Math.max(min, +e.target.value || min)))} />
      {unit && <i>{unit}</i>}
    </label>
  );
}
function Seg<T extends string>({ v, on, opts }: { v: T; on: (v: T) => void; opts: [T, string][] }) {
  return <div className="segmented mini">{opts.map(([k, l]) => <button key={k} className={clsx(v === k && "active")} onClick={() => on(k)}>{l}</button>)}</div>;
}
