// WestPhoto ayarlamaları ve filtreleri. Her biri bir tuvali alır, yeni bir tuval döndürür (kaynak değişmez).
import { c2d, clone, hexToRgb, mk } from "./core";

export type Param =
  | { key: string; label: string; kind?: "range"; min: number; max: number; step?: number; def: number }
  | { key: string; label: string; kind: "select"; options: { v: string; l: string }[]; def: string }
  | { key: string; label: string; kind: "bool"; def: boolean }
  | { key: string; label: string; kind: "color"; def: string };
export type Values = Record<string, number | string | boolean>;
export interface Env { fg: string; bg: string }
export interface Op { id: string; label: string; params: Param[]; run: (src: HTMLCanvasElement, p: Values, env: Env) => HTMLCanvasElement; special?: "curves" | "levels" }

const num = (p: Values, k: string) => Number(p[k]);
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Piksel düzeyinde işlem: fn yerinde değiştirir */
function px(src: HTMLCanvasElement, fn: (d: Uint8ClampedArray, w: number, h: number, orig: Uint8ClampedArray) => void): HTMLCanvasElement {
  const out = clone(src);
  const g = c2d(out);
  const id = g.getImageData(0, 0, out.width, out.height);
  const orig = new Uint8ClampedArray(id.data);
  fn(id.data, out.width, out.height, orig);
  g.putImageData(id, 0, 0);
  return out;
}
function lut3(src: HTMLCanvasElement, r: Uint8ClampedArray | number[], g: Uint8ClampedArray | number[], b: Uint8ClampedArray | number[]) {
  return px(src, (d) => { for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; } });
}
const mkLut = (f: (v: number) => number) => { const l = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) l[i] = clamp(Math.round(f(i))); return l; };

// ── renk dönüşümleri ──
function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Monoton kübik eğri (Fritsch–Carlson) → 256'lık tablo */
export function curveLut(points: [number, number][]): Uint8ClampedArray {
  const p = [...points].sort((a, b) => a[0] - b[0]);
  const n = p.length;
  if (n < 2) return mkLut((v) => v);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(p[i + 1][0] - p[i][0] || 1e-6); m.push((p[i + 1][1] - p[i][1]) / dx[i]); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return mkLut((x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (x > p[i + 1][0]) i++;
    const h = dx[i], u = (x - p[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p[i][1] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * p[i + 1][1] + (u3 - u2) * h * t[i + 1];
  });
}

export function histogram(c: HTMLCanvasElement): { l: Uint32Array; r: Uint32Array; g: Uint32Array; b: Uint32Array } {
  const d = c2d(c).getImageData(0, 0, c.width, c.height).data;
  const out = { l: new Uint32Array(256), r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256) };
  const step = Math.max(1, Math.floor(d.length / 4 / 400000)) * 4;
  for (let i = 0; i < d.length; i += step) {
    if (d[i + 3] < 8) continue;
    out.r[d[i]]++; out.g[d[i + 1]]++; out.b[d[i + 2]]++; out.l[Math.round(lum(d[i], d[i + 1], d[i + 2]))]++;
  }
  return out;
}

// ── yardımcılar ──
/** Kenarları uzatılmış (clamp) dolgu: bulanıklık kenarlarda kararmasın */
function padClamp(src: HTMLCanvasElement, pad: number): HTMLCanvasElement {
  const w = src.width, h = src.height, o = mk(w + pad * 2, h + pad * 2), g = c2d(o);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, w, 1, pad, 0, w, pad);
  g.drawImage(src, 0, h - 1, w, 1, pad, h + pad, w, pad);
  g.drawImage(src, 0, 0, 1, h, 0, pad, pad, h);
  g.drawImage(src, w - 1, 0, 1, h, w + pad, pad, pad, h);
  g.drawImage(src, 0, 0, 1, 1, 0, 0, pad, pad);
  g.drawImage(src, w - 1, 0, 1, 1, w + pad, 0, pad, pad);
  g.drawImage(src, 0, h - 1, 1, 1, 0, h + pad, pad, pad);
  g.drawImage(src, w - 1, h - 1, 1, 1, w + pad, h + pad, pad, pad);
  g.drawImage(src, pad, pad);
  return o;
}
function keepAlpha(src: HTMLCanvasElement, out: HTMLCanvasElement) {
  const g = c2d(out);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = "source-over";
  return out;
}
export function gauss(src: HTMLCanvasElement, r: number): HTMLCanvasElement {
  if (r <= 0) return clone(src);
  const pad = Math.ceil(r * 3) + 2, p = padClamp(src, pad), o = mk(src.width, src.height), g = c2d(o);
  g.filter = `blur(${r}px)`;
  g.drawImage(p, -pad, -pad);
  g.filter = "none";
  return keepAlpha(src, o);
}
function conv3(src: HTMLCanvasElement, k: number[], bias = 0, gray = false): HTMLCanvasElement {
  return px(src, (d, w, h, o) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i)), yy = Math.min(h - 1, Math.max(0, y + j)), q = (yy * w + xx) * 4, kk = k[(j + 1) * 3 + i + 1];
        r += o[q] * kk; g += o[q + 1] * kk; b += o[q + 2] * kk;
      }
      const q = (y * w + x) * 4;
      if (gray) { const v = clamp(lum(r, g, b) + bias); d[q] = d[q + 1] = d[q + 2] = v; } else { d[q] = clamp(r + bias); d[q + 1] = clamp(g + bias); d[q + 2] = clamp(b + bias); }
    }
  });
}
const randn = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// ── AYARLAMALAR ──
export const ADJUSTMENTS: Op[] = [
  {
    id: "bc", label: "Parlaklık / Kontrast",
    params: [{ key: "b", label: "Parlaklık", min: -150, max: 150, def: 0 }, { key: "c", label: "Kontrast", min: -100, max: 100, def: 0 }],
    run: (s, p) => { const c = num(p, "c") * 1.275, f = (259 * (c + 255)) / (255 * (259 - c)); const l = mkLut((v) => (v - 128) * f + 128 + num(p, "b")); return lut3(s, l, l, l); },
  },
  {
    id: "levels", label: "Seviyeler", special: "levels",
    params: [
      { key: "ch", label: "Kanal", kind: "select", options: [{ v: "rgb", l: "RGB" }, { v: "r", l: "Kırmızı" }, { v: "g", l: "Yeşil" }, { v: "b", l: "Mavi" }], def: "rgb" },
      { key: "ib", label: "Giriş siyah", min: 0, max: 253, def: 0 },
      { key: "gm", label: "Gama", min: 0.1, max: 5, step: 0.01, def: 1 },
      { key: "iw", label: "Giriş beyaz", min: 2, max: 255, def: 255 },
      { key: "ob", label: "Çıkış siyah", min: 0, max: 255, def: 0 },
      { key: "ow", label: "Çıkış beyaz", min: 0, max: 255, def: 255 },
    ],
    run: (s, p) => {
      const ib = num(p, "ib"), iw = Math.max(ib + 1, num(p, "iw")), gm = num(p, "gm"), ob = num(p, "ob"), ow = num(p, "ow");
      const l = mkLut((v) => ob + Math.pow(Math.min(1, Math.max(0, (v - ib) / (iw - ib))), 1 / gm) * (ow - ob));
      const id = mkLut((v) => v), ch = p.ch;
      return lut3(s, ch === "rgb" || ch === "r" ? l : id, ch === "rgb" || ch === "g" ? l : id, ch === "rgb" || ch === "b" ? l : id);
    },
  },
  {
    id: "curves", label: "Eğriler", special: "curves",
    params: [{ key: "ch", label: "Kanal", kind: "select", options: [{ v: "rgb", l: "RGB" }, { v: "r", l: "Kırmızı" }, { v: "g", l: "Yeşil" }, { v: "b", l: "Mavi" }], def: "rgb" }],
    run: (s, p) => {
      const pts = JSON.parse(String(p.curves ?? "{}")) as Record<string, [number, number][]>;
      const m = curveLut(pts.rgb ?? [[0, 0], [255, 255]]);
      const r = curveLut(pts.r ?? [[0, 0], [255, 255]]), g = curveLut(pts.g ?? [[0, 0], [255, 255]]), b = curveLut(pts.b ?? [[0, 0], [255, 255]]);
      return lut3(s, mkLut((v) => r[m[v]]), mkLut((v) => g[m[v]]), mkLut((v) => b[m[v]]));
    },
  },
  {
    id: "exposure", label: "Pozlama",
    params: [{ key: "ev", label: "Pozlama (EV)", min: -5, max: 5, step: 0.05, def: 0 }, { key: "off", label: "Ofset", min: -0.5, max: 0.5, step: 0.005, def: 0 }, { key: "gm", label: "Gama düzeltme", min: 0.1, max: 3, step: 0.01, def: 1 }],
    run: (s, p) => { const k = Math.pow(2, num(p, "ev")); const l = mkLut((v) => Math.pow(Math.max(0, (v / 255) * k + num(p, "off")), 1 / num(p, "gm")) * 255); return lut3(s, l, l, l); },
  },
  {
    id: "vibrance", label: "Canlılık",
    params: [{ key: "v", label: "Canlılık", min: -100, max: 100, def: 0 }, { key: "s", label: "Doygunluk", min: -100, max: 100, def: 0 }],
    run: (s, p) => px(s, (d) => {
      const vb = num(p, "v") / 100, sat = num(p, "s") / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), avg = (r + g + b) / 3;
        const amt = sat + vb * (1 - (mx - Math.min(r, g, b)) / 255) * 1.5;
        d[i] = clamp(r + (r - avg) * amt); d[i + 1] = clamp(g + (g - avg) * amt); d[i + 2] = clamp(b + (b - avg) * amt);
      }
    }),
  },
  {
    id: "hsl", label: "Ton / Doygunluk",
    params: [
      { key: "h", label: "Ton", min: -180, max: 180, def: 0 }, { key: "s", label: "Doygunluk", min: -100, max: 100, def: 0 },
      { key: "l", label: "Açıklık", min: -100, max: 100, def: 0 }, { key: "col", label: "Renklendir", kind: "bool", def: false },
    ],
    run: (s, p) => px(s, (d) => {
      const dh = num(p, "h") / 360, ds = num(p, "s") / 100, dl = num(p, "l") / 100, col = !!p.col;
      for (let i = 0; i < d.length; i += 4) {
        let [h, sa, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
        if (col) { h = ((num(p, "h") + 180) / 360); sa = Math.max(0, 0.25 + ds * 0.75); } else { h = (h + dh + 1) % 1; sa = ds > 0 ? sa + (1 - sa) * ds : sa * (1 + ds); }
        l = dl > 0 ? l + (1 - l) * dl : l * (1 + dl);
        const [r, g, b] = hsl2rgb(h, Math.min(1, Math.max(0, sa)), l);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }),
  },
  {
    id: "balance", label: "Renk dengesi",
    params: [
      { key: "tone", label: "Ton aralığı", kind: "select", options: [{ v: "mid", l: "Orta tonlar" }, { v: "sh", l: "Gölgeler" }, { v: "hi", l: "Vurgular" }], def: "mid" },
      { key: "cr", label: "Camgöbeği ↔ Kırmızı", min: -100, max: 100, def: 0 },
      { key: "mg", label: "Eflatun ↔ Yeşil", min: -100, max: 100, def: 0 },
      { key: "yb", label: "Sarı ↔ Mavi", min: -100, max: 100, def: 0 },
      { key: "pl", label: "Parlaklığı koru", kind: "bool", def: true },
    ],
    run: (s, p) => px(s, (d) => {
      const cr = num(p, "cr"), mg = num(p, "mg"), yb = num(p, "yb"), tone = p.tone, pl = !!p.pl;
      for (let i = 0; i < d.length; i += 4) {
        const L = lum(d[i], d[i + 1], d[i + 2]) / 255;
        const w = tone === "sh" ? Math.max(0, 1 - L * 2.2) : tone === "hi" ? Math.max(0, L * 2.2 - 1.2) : 1 - Math.abs(L - 0.5) * 2;
        let r = d[i] + cr * w * 0.6, g = d[i + 1] + mg * w * 0.6, b = d[i + 2] + yb * w * 0.6;
        if (pl) { const k = lum(d[i], d[i + 1], d[i + 2]) - lum(r, g, b); r += k; g += k; b += k; }
        d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
      }
    }),
  },
  {
    id: "bw", label: "Siyah-Beyaz",
    params: [
      { key: "r", label: "Kırmızılar", min: -200, max: 300, def: 40 }, { key: "g", label: "Yeşiller", min: -200, max: 300, def: 40 }, { key: "b", label: "Maviler", min: -200, max: 300, def: 20 },
      { key: "tint", label: "Renk tonu", kind: "bool", def: false }, { key: "tc", label: "Ton rengi", kind: "color", def: "#c9a36b" },
    ],
    run: (s, p) => px(s, (d) => {
      const wr = num(p, "r") / 100, wg = num(p, "g") / 100, wb = num(p, "b") / 100, t = !!p.tint, [tr, tg, tb] = hexToRgb(String(p.tc));
      for (let i = 0; i < d.length; i += 4) {
        const v = clamp(d[i] * wr + d[i + 1] * wg + d[i + 2] * wb);
        if (t) { d[i] = clamp((v * tr) / 200 + v / 2); d[i + 1] = clamp((v * tg) / 200 + v / 2); d[i + 2] = clamp((v * tb) / 200 + v / 2); } else d[i] = d[i + 1] = d[i + 2] = v;
      }
    }),
  },
  {
    id: "photo", label: "Fotoğraf filtresi",
    params: [{ key: "c", label: "Renk", kind: "color", def: "#ec8a2d" }, { key: "dn", label: "Yoğunluk", min: 0, max: 100, def: 25 }, { key: "pl", label: "Parlaklığı koru", kind: "bool", def: true }],
    run: (s, p) => px(s, (d) => {
      const [fr, fg, fb] = hexToRgb(String(p.c)), k = num(p, "dn") / 100, pl = !!p.pl;
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i] * (1 - k) + ((d[i] * fr) / 255) * k, g = d[i + 1] * (1 - k) + ((d[i + 1] * fg) / 255) * k, b = d[i + 2] * (1 - k) + ((d[i + 2] * fb) / 255) * k;
        if (pl) { const L0 = lum(d[i], d[i + 1], d[i + 2]), L1 = lum(r, g, b) || 1; r *= L0 / L1; g *= L0 / L1; b *= L0 / L1; }
        d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
      }
    }),
  },
  {
    id: "sh", label: "Gölge / Vurgu",
    params: [{ key: "s", label: "Gölgeleri aç", min: 0, max: 100, def: 35 }, { key: "h", label: "Vurguları bastır", min: 0, max: 100, def: 0 }],
    run: (s, p) => {
      const base = gauss(s, Math.max(4, Math.min(s.width, s.height) / 80));
      const bd = c2d(base).getImageData(0, 0, s.width, s.height).data, sa = num(p, "s") / 100, ha = num(p, "h") / 100;
      return px(s, (d) => {
        for (let i = 0; i < d.length; i += 4) {
          const L = lum(bd[i], bd[i + 1], bd[i + 2]) / 255;
          const k = 1 + sa * Math.pow(1 - L, 2) * 1.6 - ha * Math.pow(L, 2) * 0.6;
          d[i] = clamp(d[i] * k); d[i + 1] = clamp(d[i + 1] * k); d[i + 2] = clamp(d[i + 2] * k);
        }
      });
    },
  },
  { id: "invert", label: "Tersine çevir", params: [], run: (s) => { const l = mkLut((v) => 255 - v); return lut3(s, l, l, l); } },
  { id: "desat", label: "Rengi kaldır", params: [], run: (s) => px(s, (d) => { for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(d[i], d[i + 1], d[i + 2]); }) },
  {
    id: "posterize", label: "Posterleştir", params: [{ key: "n", label: "Seviye", min: 2, max: 32, def: 6 }],
    run: (s, p) => { const n = num(p, "n") - 1; const l = mkLut((v) => Math.round((v / 255) * n) * (255 / n)); return lut3(s, l, l, l); },
  },
  {
    id: "threshold", label: "Eşik", params: [{ key: "t", label: "Eşik seviyesi", min: 1, max: 255, def: 128 }],
    run: (s, p) => px(s, (d) => { const t = num(p, "t"); for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = lum(d[i], d[i + 1], d[i + 2]) >= t ? 255 : 0; }),
  },
  {
    id: "gmap", label: "Degrade haritası", params: [{ key: "rev", label: "Ters", kind: "bool", def: false }],
    run: (s, p, env) => px(s, (d) => {
      const a = hexToRgb(p.rev ? env.bg : env.fg), b = hexToRgb(p.rev ? env.fg : env.bg);
      for (let i = 0; i < d.length; i += 4) { const t = lum(d[i], d[i + 1], d[i + 2]) / 255; d[i] = a[0] + (b[0] - a[0]) * t; d[i + 1] = a[1] + (b[1] - a[1]) * t; d[i + 2] = a[2] + (b[2] - a[2]) * t; }
    }),
  },
];

// ── FİLTRELER ──
export const FILTERS: (Op & { group: string })[] = [
  { group: "Bulanıklaştır", id: "gauss", label: "Gauss bulanıklığı", params: [{ key: "r", label: "Yarıçap (px)", min: 0.2, max: 80, step: 0.1, def: 4 }], run: (s, p) => gauss(s, num(p, "r")) },
  {
    group: "Bulanıklaştır", id: "motion", label: "Hareket bulanıklığı",
    params: [{ key: "a", label: "Açı (°)", min: -180, max: 180, def: 0 }, { key: "d", label: "Uzaklık (px)", min: 1, max: 300, def: 30 }],
    run: (s, p) => {
      const dist = num(p, "d"), a = (num(p, "a") * Math.PI) / 180, pad = Math.ceil(dist) + 2, src = padClamp(s, pad), o = mk(s.width, s.height), g = c2d(o);
      const n = Math.min(64, Math.max(4, Math.round(dist)));
      for (let i = 0; i < n; i++) { const t = i / (n - 1) - 0.5; g.globalAlpha = 1 / (i + 1); g.drawImage(src, -pad + Math.cos(a) * dist * t, -pad + Math.sin(a) * dist * t); }
      return keepAlpha(s, o);
    },
  },
  {
    group: "Bulanıklaştır", id: "zoom", label: "Yakınlaştırma bulanıklığı",
    params: [{ key: "k", label: "Miktar", min: 1, max: 100, def: 20 }, { key: "cx", label: "Merkez X (%)", min: 0, max: 100, def: 50 }, { key: "cy", label: "Merkez Y (%)", min: 0, max: 100, def: 50 }],
    run: (s, p) => {
      const o = mk(s.width, s.height), g = c2d(o), n = 24, k = num(p, "k") / 400, cx = (s.width * num(p, "cx")) / 100, cy = (s.height * num(p, "cy")) / 100;
      for (let i = 0; i < n; i++) { const sc = 1 + (k * i) / n; g.globalAlpha = 1 / (i + 1); g.setTransform(sc, 0, 0, sc, cx - cx * sc, cy - cy * sc); g.drawImage(s, 0, 0); }
      g.setTransform(1, 0, 0, 1, 0, 0);
      return o;
    },
  },
  {
    group: "Bulanıklaştır", id: "tilt", label: "Tilt-shift (minyatür)",
    params: [{ key: "y", label: "Odak konumu (%)", min: 0, max: 100, def: 55 }, { key: "w", label: "Odak genişliği (%)", min: 2, max: 80, def: 18 }, { key: "r", label: "Bulanıklık", min: 1, max: 40, def: 10 }, { key: "sat", label: "Doygunluk artışı", min: 0, max: 60, def: 20 }],
    run: (s, p) => {
      const b = gauss(s, num(p, "r")), m = mk(s.width, s.height), mg = c2d(m), cy = (s.height * num(p, "y")) / 100, bw = (s.height * num(p, "w")) / 200;
      const gr = mg.createLinearGradient(0, 0, 0, s.height);
      const st = (v: number) => Math.min(1, Math.max(0, v / s.height));
      gr.addColorStop(0, "#fff"); gr.addColorStop(st(cy - bw * 2.5), "#fff"); gr.addColorStop(st(cy - bw), "rgba(255,255,255,0)"); gr.addColorStop(st(cy + bw), "rgba(255,255,255,0)"); gr.addColorStop(st(cy + bw * 2.5), "#fff"); gr.addColorStop(1, "#fff");
      mg.fillStyle = gr; mg.fillRect(0, 0, s.width, s.height);
      const bg = c2d(b); bg.globalCompositeOperation = "destination-in"; bg.drawImage(m, 0, 0);
      const o = clone(s); c2d(o).drawImage(b, 0, 0);
      return ADJUSTMENTS.find((a) => a.id === "vibrance")!.run(o, { v: num(p, "sat"), s: 0 }, { fg: "#000", bg: "#fff" });
    },
  },
  {
    group: "Keskinleştir", id: "unsharp", label: "Keskinlik maskesi",
    params: [{ key: "a", label: "Miktar (%)", min: 1, max: 500, def: 120 }, { key: "r", label: "Yarıçap", min: 0.2, max: 30, step: 0.1, def: 1.4 }, { key: "t", label: "Eşik", min: 0, max: 100, def: 2 }],
    run: (s, p) => {
      const bd = c2d(gauss(s, num(p, "r"))).getImageData(0, 0, s.width, s.height).data, a = num(p, "a") / 100, t = num(p, "t");
      return px(s, (d) => { for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) { const diff = d[i + c] - bd[i + c]; if (Math.abs(diff) >= t) d[i + c] = clamp(d[i + c] + diff * a); } });
    },
  },
  { group: "Keskinleştir", id: "sharpen", label: "Keskinleştir", params: [], run: (s) => conv3(s, [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0]) },
  {
    group: "Gürültü", id: "noise", label: "Gürültü ekle",
    params: [{ key: "a", label: "Miktar", min: 1, max: 100, def: 12 }, { key: "m", label: "Tek renkli", kind: "bool", def: true }],
    run: (s, p) => px(s, (d) => { const a = num(p, "a") * 1.2, m = !!p.m; for (let i = 0; i < d.length; i += 4) { const n = randn() * a; d[i] = clamp(d[i] + n); d[i + 1] = clamp(d[i + 1] + (m ? n : randn() * a)); d[i + 2] = clamp(d[i + 2] + (m ? n : randn() * a)); } }),
  },
  {
    group: "Gürültü", id: "denoise", label: "Gürültü azalt",
    params: [{ key: "s", label: "Güç", min: 1, max: 100, def: 30 }],
    run: (s, p) => {
      const bd = c2d(gauss(s, 1.6)).getImageData(0, 0, s.width, s.height).data, t = num(p, "s") * 0.9;
      return px(s, (d) => { for (let i = 0; i < d.length; i += 4) { const diff = Math.abs(d[i] - bd[i]) + Math.abs(d[i + 1] - bd[i + 1]) + Math.abs(d[i + 2] - bd[i + 2]); const k = Math.max(0, 1 - diff / (t * 3)); for (let c = 0; c < 3; c++) d[i + c] = d[i + c] * (1 - k) + bd[i + c] * k; } });
    },
  },
  {
    group: "Pikselleştir", id: "mosaic", label: "Mozaik", params: [{ key: "c", label: "Hücre boyutu", min: 2, max: 200, def: 12 }],
    run: (s, p) => { const c = num(p, "c"), sm = mk(Math.ceil(s.width / c), Math.ceil(s.height / c)); c2d(sm).drawImage(s, 0, 0, sm.width, sm.height); const o = mk(s.width, s.height), g = c2d(o); g.imageSmoothingEnabled = false; g.drawImage(sm, 0, 0, sm.width * c, sm.height * c); return o; },
  },
  {
    group: "Pikselleştir", id: "halftone", label: "Renkli yarım ton", params: [{ key: "c", label: "Nokta boyutu", min: 3, max: 40, def: 8 }],
    run: (s, p) => {
      const c = num(p, "c"), d = c2d(s).getImageData(0, 0, s.width, s.height).data, o = mk(s.width, s.height), g = c2d(o);
      g.fillStyle = "#fff"; g.fillRect(0, 0, o.width, o.height);
      for (let y = 0; y < s.height; y += c) for (let x = 0; x < s.width; x += c) {
        const q = (Math.min(s.height - 1, Math.floor(y + c / 2)) * s.width + Math.min(s.width - 1, Math.floor(x + c / 2))) * 4;
        const L = lum(d[q], d[q + 1], d[q + 2]) / 255;
        g.fillStyle = `rgb(${d[q]},${d[q + 1]},${d[q + 2]})`;
        g.beginPath(); g.arc(x + c / 2, y + c / 2, (c / 2) * Math.sqrt(1 - L) * 1.35 + 0.4, 0, Math.PI * 2); g.fill();
      }
      return o;
    },
  },
  { group: "Stilize", id: "emboss", label: "Kabartma", params: [{ key: "col", label: "Rengi koru", kind: "bool", def: false }], run: (s, p) => (p.col ? conv3(s, [-2, -1, 0, -1, 1, 1, 0, 1, 2]) : conv3(s, [-2, -1, 0, -1, 0, 1, 0, 1, 2], 128, true)) },
  {
    group: "Stilize", id: "edges", label: "Kenarları bul", params: [],
    run: (s) => px(s, (d, w, h, o) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const at = (i: number, j: number) => { const q = (Math.min(h - 1, Math.max(0, y + j)) * w + Math.min(w - 1, Math.max(0, x + i))) * 4; return lum(o[q], o[q + 1], o[q + 2]); };
        const gx = -at(-1, -1) - 2 * at(-1, 0) - at(-1, 1) + at(1, -1) + 2 * at(1, 0) + at(1, 1);
        const gy = -at(-1, -1) - 2 * at(0, -1) - at(1, -1) + at(-1, 1) + 2 * at(0, 1) + at(1, 1);
        const q = (y * w + x) * 4; d[q] = d[q + 1] = d[q + 2] = clamp(255 - Math.hypot(gx, gy));
      }
    }),
  },
  {
    group: "Stilize", id: "oil", label: "Yağlı boya", params: [{ key: "r", label: "Fırça yarıçapı", min: 1, max: 6, def: 3 }],
    run: (s, p) => px(s, (d, w, h, o) => {
      const r = num(p, "r");
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let best = Infinity, br = 0, bg = 0, bb = 0;
        for (const [qx, qy] of [[-r, -r], [0, -r], [-r, 0], [0, 0]]) {
          let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, n = 0;
          for (let j = 0; j <= r; j++) for (let i = 0; i <= r; i++) {
            const xx = Math.min(w - 1, Math.max(0, x + qx + i)), yy = Math.min(h - 1, Math.max(0, y + qy + j)), q = (yy * w + xx) * 4, L = o[q] + o[q + 1] + o[q + 2];
            sr += o[q]; sg += o[q + 1]; sb += o[q + 2]; sl += L; sl2 += L * L; n++;
          }
          const v = sl2 / n - (sl / n) ** 2;
          if (v < best) { best = v; br = sr / n; bg = sg / n; bb = sb / n; }
        }
        const q = (y * w + x) * 4; d[q] = br; d[q + 1] = bg; d[q + 2] = bb;
      }
    }),
  },
  {
    group: "Stilize", id: "glow", label: "Parıltı (bloom)",
    params: [{ key: "t", label: "Eşik", min: 0, max: 255, def: 170 }, { key: "r", label: "Yayılma", min: 2, max: 80, def: 18 }, { key: "k", label: "Yoğunluk (%)", min: 5, max: 200, def: 70 }],
    run: (s, p) => {
      const t = num(p, "t"), bright = px(s, (d) => { for (let i = 0; i < d.length; i += 4) { const L = lum(d[i], d[i + 1], d[i + 2]); if (L < t) d[i] = d[i + 1] = d[i + 2] = 0; } });
      const b = gauss(bright, num(p, "r")), o = clone(s), g = c2d(o);
      g.globalCompositeOperation = "screen"; g.globalAlpha = Math.min(1, num(p, "k") / 100);
      g.drawImage(b, 0, 0); if (num(p, "k") > 100) { g.globalAlpha = num(p, "k") / 100 - 1; g.drawImage(b, 0, 0); }
      return keepAlpha(s, o);
    },
  },
  {
    group: "Stilize", id: "chroma", label: "Renk sapması", params: [{ key: "a", label: "Miktar (px)", min: 1, max: 30, def: 4 }],
    run: (s, p) => px(s, (d, w, h, o) => { const a = Math.round(num(p, "a")); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = (y * w + x) * 4; d[q] = o[(y * w + Math.min(w - 1, x + a)) * 4]; d[q + 2] = o[(y * w + Math.max(0, x - a)) * 4 + 2]; } }),
  },
  {
    group: "Stilize", id: "vignette", label: "Vinyet",
    params: [{ key: "a", label: "Miktar", min: -100, max: 100, def: 45 }, { key: "s", label: "Boyut", min: 0, max: 100, def: 50 }, { key: "f", label: "Yumuşaklık", min: 1, max: 100, def: 60 }],
    run: (s, p) => {
      const o = clone(s), g = c2d(o), w = s.width, h = s.height, a = num(p, "a") / 100, R = Math.hypot(w, h) / 2;
      const inner = R * (0.2 + (num(p, "s") / 100) * 0.7), outer = Math.min(R * 1.3, inner + R * (num(p, "f") / 100) * 0.9 + 1);
      const gr = g.createRadialGradient(w / 2, h / 2, inner, w / 2, h / 2, outer);
      const c = a > 0 ? "0,0,0" : "255,255,255";
      gr.addColorStop(0, `rgba(${c},0)`); gr.addColorStop(1, `rgba(${c},${Math.abs(a)})`);
      g.globalCompositeOperation = "source-atop"; g.fillStyle = gr; g.fillRect(0, 0, w, h);
      return o;
    },
  },
  {
    group: "Bozulma", id: "twirl", label: "Girdap", params: [{ key: "a", label: "Açı (°)", min: -720, max: 720, def: 180 }, { key: "r", label: "Yarıçap (%)", min: 5, max: 100, def: 50 }],
    run: (s, p) => px(s, (d, w, h, o) => {
      const cx = w / 2, cy = h / 2, R = (Math.min(w, h) / 2) * (num(p, "r") / 100), A = (num(p, "a") * Math.PI) / 180;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy);
        if (dist >= R) continue;
        const t = 1 - dist / R, ang = Math.atan2(dy, dx) + A * t * t;
        const sx = Math.min(w - 1, Math.max(0, Math.round(cx + Math.cos(ang) * dist))), sy = Math.min(h - 1, Math.max(0, Math.round(cy + Math.sin(ang) * dist)));
        const q = (y * w + x) * 4, k = (sy * w + sx) * 4; d[q] = o[k]; d[q + 1] = o[k + 1]; d[q + 2] = o[k + 2]; d[q + 3] = o[k + 3];
      }
    }),
  },
  {
    group: "Bozulma", id: "wave", label: "Dalga", params: [{ key: "a", label: "Genlik (px)", min: 1, max: 100, def: 10 }, { key: "l", label: "Dalga boyu (px)", min: 4, max: 600, def: 120 }, { key: "dir", label: "Yön", kind: "select", options: [{ v: "h", l: "Yatay" }, { v: "v", l: "Dikey" }], def: "h" }],
    run: (s, p) => px(s, (d, w, h, o) => {
      const a = num(p, "a"), l = num(p, "l"), hz = p.dir === "h";
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const sx = hz ? Math.round(x + Math.sin((y / l) * Math.PI * 2) * a) : x, sy = hz ? y : Math.round(y + Math.sin((x / l) * Math.PI * 2) * a);
        const q = (y * w + x) * 4, k = (Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))) * 4;
        d[q] = o[k]; d[q + 1] = o[k + 1]; d[q + 2] = o[k + 2]; d[q + 3] = o[k + 3];
      }
    }),
  },
  {
    group: "Oluştur", id: "clouds", label: "Bulutlar (ön/arka renk)", params: [{ key: "sc", label: "Ölçek", min: 10, max: 400, def: 120 }],
    run: (s, p, env) => {
      const sc = num(p, "sc"), a = hexToRgb(env.fg), b = hexToRgb(env.bg), o = mk(s.width, s.height), g = c2d(o);
      let acc: HTMLCanvasElement | null = null;
      for (let oct = 0; oct < 5; oct++) {
        const cell = Math.max(1, sc / 2 ** oct), n = mk(Math.ceil(s.width / cell) + 2, Math.ceil(s.height / cell) + 2), ng = c2d(n), id = ng.createImageData(n.width, n.height);
        for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
        ng.putImageData(id, 0, 0);
        if (!acc) { acc = mk(s.width, s.height); }
        const ag = c2d(acc); ag.imageSmoothingEnabled = true; ag.imageSmoothingQuality = "high"; ag.globalAlpha = oct === 0 ? 1 : 0.5 ** oct;
        ag.drawImage(n, 0, 0, n.width * cell, n.height * cell);
      }
      const ad = c2d(acc!).getImageData(0, 0, s.width, s.height);
      for (let i = 0; i < ad.data.length; i += 4) { const t = ad.data[i] / 255; ad.data[i] = a[0] + (b[0] - a[0]) * t; ad.data[i + 1] = a[1] + (b[1] - a[1]) * t; ad.data[i + 2] = a[2] + (b[2] - a[2]) * t; ad.data[i + 3] = 255; }
      g.putImageData(ad, 0, 0);
      return o;
    },
  },
];

export const defaults = (op: Op): Values => Object.fromEntries(op.params.map((p) => [p.key, p.def]));
