// WestPhoto çekirdeği: belge, katmanlar, maskeler, seçim, birleştirme (composite) ve geçmiş.
// Belge değişmez (immutable) tutulur: bir katmanın pikselleri değişecekse önce tuvali kopyalanır, böylece
// geçmiş adımları değişmeyen katmanların tuvallerini paylaşır ve bellek yalnızca değişen katmanlar kadar artar.

export type Blend = GlobalCompositeOperation;

export interface TextData {
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: CanvasTextAlign;
  x: number;
  y: number;
  lineHeight: number;
  strokeColor: string;
  strokeWidth: number;
}

export interface Effects {
  shadow?: { x: number; y: number; blur: number; color: string; opacity: number };
  glow?: { blur: number; color: string; opacity: number };
  stroke?: { width: number; color: string };
  overlay?: { color: string; opacity: number };
}

export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  mask: HTMLCanvasElement | null;
  maskOn: boolean;
  visible: boolean;
  opacity: number;
  blend: Blend;
  locked: boolean;
  text: TextData | null;
  fx: Effects;
}

export interface Doc {
  w: number;
  h: number;
  layers: Layer[]; // alttan üste
  active: string;
  sel: HTMLCanvasElement | null; // alfa = seçili
  editMask: boolean;
}

export const BLENDS: { id: Blend; label: string }[] = [
  { id: "source-over", label: "Normal" },
  { id: "multiply", label: "Çarp" },
  { id: "screen", label: "Ekran" },
  { id: "overlay", label: "Bindirme" },
  { id: "darken", label: "Koyulaştır" },
  { id: "lighten", label: "Açıklaştır" },
  { id: "color-dodge", label: "Renk soldurma" },
  { id: "color-burn", label: "Renk yakma" },
  { id: "hard-light", label: "Sert ışık" },
  { id: "soft-light", label: "Yumuşak ışık" },
  { id: "difference", label: "Fark" },
  { id: "exclusion", label: "Dışlama" },
  { id: "hue", label: "Ton" },
  { id: "saturation", label: "Doygunluk" },
  { id: "color", label: "Renk" },
  { id: "luminosity", label: "Parlaklık" },
  { id: "lighter", label: "Doğrusal ekle" },
];

let seq = 0;
export const uid = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export function mk(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const c2d = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;
export function clone(c: HTMLCanvasElement): HTMLCanvasElement {
  const n = mk(c.width, c.height);
  c2d(n).drawImage(c, 0, 0);
  return n;
}

export function newLayer(w: number, h: number, name: string, src?: CanvasImageSource | null, x = 0, y = 0): Layer {
  const canvas = mk(w, h);
  if (src) c2d(canvas).drawImage(src, x, y);
  return { id: uid(), name, canvas, mask: null, maskOn: true, visible: true, opacity: 1, blend: "source-over", locked: false, text: null, fx: {} };
}

export function newDoc(img: CanvasImageSource & { width: number; height: number }): Doc {
  const bg = newLayer(img.width, img.height, "Arka plan", img);
  return { w: img.width, h: img.height, layers: [bg], active: bg.id, sel: null, editMask: false };
}

export const activeLayer = (d: Doc) => d.layers.find((l) => l.id === d.active) ?? d.layers[d.layers.length - 1];
export const patchLayer = (d: Doc, id: string, p: Partial<Layer>): Doc => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) });

// ── metin katmanı ──
export function defaultText(x: number, y: number, color: string): TextData {
  return { text: "West", font: "Plus Jakarta Sans", size: 64, color, bold: true, italic: false, align: "left", x, y, lineHeight: 1.2, strokeColor: "#000000", strokeWidth: 0 };
}
export function renderText(w: number, h: number, t: TextData): HTMLCanvasElement {
  const c = mk(w, h);
  const g = c2d(c);
  g.font = `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.size}px "${t.font}", sans-serif`;
  g.textAlign = t.align;
  g.textBaseline = "top";
  g.lineJoin = "round";
  t.text.split("\n").forEach((line, i) => {
    const y = t.y + i * t.size * t.lineHeight;
    if (t.strokeWidth > 0) {
      g.strokeStyle = t.strokeColor;
      g.lineWidth = t.strokeWidth * 2;
      g.strokeText(line, t.x, y);
    }
    g.fillStyle = t.color;
    g.fillText(line, t.x, y);
  });
  return c;
}
export function textBounds(t: TextData): { x: number; y: number; w: number; h: number } {
  const g = c2d(mk(1, 1));
  g.font = `${t.italic ? "italic " : ""}${t.bold ? "700 " : "400 "}${t.size}px "${t.font}", sans-serif`;
  const lines = t.text.split("\n");
  const w = Math.max(...lines.map((l) => g.measureText(l).width), 4);
  const h = lines.length * t.size * t.lineHeight;
  const x = t.align === "center" ? t.x - w / 2 : t.align === "right" || t.align === "end" ? t.x - w : t.x;
  return { x, y: t.y, w, h };
}

// ── birleştirme ──
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

let scratch: HTMLCanvasElement | null = null;
function tmp(w: number, h: number) {
  if (!scratch || scratch.width !== w || scratch.height !== h) scratch = mk(w, h);
  const g = c2d(scratch);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return scratch;
}

/** Katmanın maske + "renk kaplaması" uygulanmış hali (geçici tuvalde) */
export function layerImage(l: Layer, src: HTMLCanvasElement = l.canvas): HTMLCanvasElement {
  if (!(l.mask && l.maskOn) && !l.fx.overlay) return src;
  const t = tmp(src.width, src.height);
  const g = c2d(t);
  g.drawImage(src, 0, 0);
  if (l.fx.overlay) {
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = rgba(l.fx.overlay.color, l.fx.overlay.opacity);
    g.fillRect(0, 0, t.width, t.height);
  }
  if (l.mask && l.maskOn) {
    g.globalCompositeOperation = "destination-in";
    g.drawImage(l.mask, 0, 0);
  }
  g.globalCompositeOperation = "source-over";
  return t;
}

/** Tüm görünür katmanları `out` tuvaline çizer. `override` ile bir katmanın yerine önizleme tuvali konur. */
export function composite(d: Doc, out: HTMLCanvasElement, override?: { id: string; canvas: HTMLCanvasElement } | null, extra?: { after: string; canvas: HTMLCanvasElement } | null) {
  if (out.width !== d.w || out.height !== d.h) { out.width = d.w; out.height = d.h; }
  const g = c2d(out);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.clearRect(0, 0, d.w, d.h);
  for (const l of d.layers) {
    if (!l.visible) continue;
    const src = override?.id === l.id ? override.canvas : l.canvas;
    const img = layerImage(l, src);
    drawFx(g, l, img);
    g.globalAlpha = l.opacity;
    g.globalCompositeOperation = l.blend;
    g.drawImage(img, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    if (extra?.after === l.id) g.drawImage(extra.canvas, 0, 0);
  }
}

function drawFx(g: CanvasRenderingContext2D, l: Layer, img: HTMLCanvasElement) {
  const { shadow, glow, stroke } = l.fx;
  const FAR = img.width + 100;
  if (shadow) {
    g.save();
    g.shadowColor = rgba(shadow.color, shadow.opacity * l.opacity);
    g.shadowBlur = shadow.blur;
    g.shadowOffsetX = FAR + shadow.x;
    g.shadowOffsetY = shadow.y;
    g.drawImage(img, -FAR, 0);
    g.restore();
  }
  if (glow) {
    g.save();
    g.shadowColor = rgba(glow.color, glow.opacity * l.opacity);
    g.shadowBlur = glow.blur;
    g.shadowOffsetX = FAR;
    for (let i = 0; i < 2; i++) g.drawImage(img, -FAR, 0);
    g.restore();
  }
  if (stroke && stroke.width > 0) {
    const s = clone(img);
    const sg = c2d(s);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = stroke.color;
    sg.fillRect(0, 0, s.width, s.height);
    g.save();
    g.globalAlpha = l.opacity;
    const n = Math.max(12, Math.round(stroke.width * 4));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.drawImage(s, Math.cos(a) * stroke.width, Math.sin(a) * stroke.width);
    }
    g.restore();
  }
}

export function flatten(d: Doc): HTMLCanvasElement {
  const out = mk(d.w, d.h);
  composite(d, out);
  return out;
}

// ── seçim ──
export type SelMode = "new" | "add" | "sub" | "int";

export function applySel(d: Doc, shape: (g: CanvasRenderingContext2D) => void, mode: SelMode, feather = 0): HTMLCanvasElement | null {
  const s = mk(d.w, d.h);
  const g = c2d(s);
  g.fillStyle = "#fff";
  shape(g);
  const shaped = feather > 0 ? blurCanvas(s, feather) : s;
  if (mode === "new" || !d.sel) return mode === "sub" ? null : shaped;
  const out = clone(d.sel);
  const og = c2d(out);
  og.globalCompositeOperation = mode === "add" ? "source-over" : mode === "sub" ? "destination-out" : "destination-in";
  og.drawImage(shaped, 0, 0);
  return out;
}

export function selFromMask(w: number, h: number, m: Uint8Array): HTMLCanvasElement {
  const s = mk(w, h);
  const g = c2d(s);
  const id = g.createImageData(w, h);
  for (let i = 0; i < m.length; i++) if (m[i]) { const k = i * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = 255; id.data[k + 3] = 255; }
  g.putImageData(id, 0, 0);
  return s;
}

export function combineSel(d: Doc, next: HTMLCanvasElement, mode: SelMode): HTMLCanvasElement | null {
  return applySel(d, (g) => g.drawImage(next, 0, 0), mode);
}

export function invertSel(d: Doc): HTMLCanvasElement {
  const s = mk(d.w, d.h);
  const g = c2d(s);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, d.w, d.h);
  if (d.sel) {
    g.globalCompositeOperation = "destination-out";
    g.drawImage(d.sel, 0, 0);
  }
  return s;
}

export function blurCanvas(c: HTMLCanvasElement, r: number): HTMLCanvasElement {
  const o = mk(c.width, c.height);
  const g = c2d(o);
  g.filter = `blur(${r}px)`;
  g.drawImage(c, 0, 0);
  g.filter = "none";
  return o;
}

/** Seçimi genişlet (+) / daralt (−): bulanıklaştırıp eşikle */
export function growSel(sel: HTMLCanvasElement, px: number): HTMLCanvasElement {
  const b = blurCanvas(sel, Math.abs(px));
  const g = c2d(b);
  const id = g.getImageData(0, 0, b.width, b.height);
  const th = px > 0 ? 8 : 247;
  for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > th ? 255 : 0;
  g.putImageData(id, 0, 0);
  return b;
}

export function selBounds(sel: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  return alphaBounds(sel);
}
export function alphaBounds(c: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const d = c2d(c).getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Seçimin kenar parçaları (yürüyen karıncalar için), belge koordinatında; `step` çözünürlükte */
export function selEdges(sel: HTMLCanvasElement, step: number): Float32Array {
  const w = sel.width, h = sel.height;
  const d = c2d(sel).getImageData(0, 0, w, h).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const segs: number[] = [];
  for (let y = -step; y < h; y += step) for (let x = -step; x < w; x += step) {
    const a = on(x, y);
    if (a !== on(x + step, y)) segs.push(x + step, y, x + step, y + step);
    if (a !== on(x, y + step)) segs.push(x, y + step, x + step, y + step);
  }
  return new Float32Array(segs);
}

/** Taşma dolgusu / sihirli değnek: renk toleransı içindeki pikseller */
export function floodMask(id: ImageData, sx: number, sy: number, tol: number, contiguous: boolean): Uint8Array {
  const { width: w, height: h, data } = id;
  const m = new Uint8Array(w * h);
  const k0 = (sy * w + sx) * 4;
  const r0 = data[k0], g0 = data[k0 + 1], b0 = data[k0 + 2], a0 = data[k0 + 3];
  const t = tol * 4;
  const near = (i: number) => {
    const k = i * 4;
    return Math.abs(data[k] - r0) + Math.abs(data[k + 1] - g0) + Math.abs(data[k + 2] - b0) + Math.abs(data[k + 3] - a0) <= t;
  };
  if (!contiguous) {
    for (let i = 0; i < w * h; i++) if (near(i)) m[i] = 1;
    return m;
  }
  const stack = new Int32Array(w * h);
  let sp = 0;
  stack[sp++] = sy * w + sx;
  m[sy * w + sx] = 1;
  while (sp) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const n of nb) if (n >= 0 && !m[n] && near(n)) { m[n] = 1; stack[sp++] = n; }
  }
  return m;
}

/** `edited` tuvalini, seçim varsa yalnızca seçili alanda `orig` ile karıştırır (yumuşak kenarlar dahil) */
export function throughSel(orig: HTMLCanvasElement, edited: HTMLCanvasElement, sel: HTMLCanvasElement | null): HTMLCanvasElement {
  if (!sel) return edited;
  const a = clone(orig);
  const ag = c2d(a);
  ag.globalCompositeOperation = "destination-out";
  ag.drawImage(sel, 0, 0);
  const b = clone(edited);
  const bg = c2d(b);
  bg.globalCompositeOperation = "destination-in";
  bg.drawImage(sel, 0, 0);
  ag.globalCompositeOperation = "lighter";
  ag.drawImage(b, 0, 0);
  ag.globalCompositeOperation = "source-over";
  return a;
}

// ── geçmiş ──
export interface History { items: { label: string; doc: Doc }[]; index: number }
export const MAX_HISTORY = 40;
export function pushHistory(h: History, label: string, doc: Doc): History {
  const items = h.items.slice(0, h.index + 1);
  items.push({ label, doc });
  while (items.length > MAX_HISTORY) items.shift();
  return { items, index: items.length - 1 };
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
