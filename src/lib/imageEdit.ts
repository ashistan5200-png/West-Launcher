import { tx } from "@/lib/i18n";
/**
 * Ekran görüntüsü düzenleyicisinin işleme hattı. Önizleme ve dışa aktarma
 * AYNI fonksiyonu kullanır (yalnızca ölçek farklı), böylece kaydedilen sonuç
 * ekranda görülenle birebir aynıdır. CSS `ctx.filter`'a güvenilmez
 * (WebKitGTK desteklemez); ayarlar piksel düzeyinde uygulanır.
 */

export interface Adjust {
  brightness: number; // -100..100
  contrast: number;
  saturation: number;
  warmth: number;
  vignette: number; // 0..100
  mode: "normal" | "sepia";
}

export const NEUTRAL: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, vignette: 0, mode: "normal" };

export const PRESETS: { id: string; label: string; adjust: Adjust }[] = [
  { id: "none", label: tx("Yok"), adjust: NEUTRAL },
  { id: "vivid", label: tx("Canlı"), adjust: { ...NEUTRAL, contrast: 10, saturation: 35 } },
  { id: "cinema", label: tx("Sinematik"), adjust: { ...NEUTRAL, contrast: 18, saturation: -15, warmth: 10, vignette: 45 } },
  { id: "bw", label: tx("Siyah-Beyaz"), adjust: { ...NEUTRAL, contrast: 12, saturation: -100 } },
  { id: "sepia", label: tx("Sepya"), adjust: { ...NEUTRAL, mode: "sepia", contrast: 5 } },
  { id: "cold", label: tx("Soğuk"), adjust: { ...NEUTRAL, warmth: -30, saturation: -5 } },
  { id: "night", label: tx("Gece"), adjust: { ...NEUTRAL, brightness: -15, contrast: 12, warmth: -25, vignette: 35 } },
];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Annotation =
  | { type: "pen"; color: string; size: number; points: [number, number][] }
  | { type: "text"; color: string; size: number; x: number; y: number; text: string };

export interface EditState {
  adjust: Adjust;
  annotations: Annotation[];
  /** Orijinal piksel koordinatlarında; null = tam görüntü */
  crop: Rect | null;
  /** Çıktı genişliği (px); null = kırpılmış boyut */
  outWidth: number | null;
}

export const isNeutral = (a: Adjust) =>
  a.brightness === 0 && a.contrast === 0 && a.saturation === 0 && a.warmth === 0 && a.vignette === 0 && a.mode === "normal";

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Piksel ayarları yerinde uygulanır. Parlaklık/kontrast için arama tablosu kullanılır. */
export function applyAdjust(data: Uint8ClampedArray, a: Adjust) {
  if (isNeutral(a)) return;
  const b = 1 + a.brightness / 100;
  const c = 1 + a.contrast / 100;
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = clamp((i * b - 128) * c + 128);
  const s = 1 + a.saturation / 100;
  const w = a.warmth * 0.35;
  const sepia = a.mode === "sepia";
  for (let i = 0; i < data.length; i += 4) {
    let r = lut[data[i]], g = lut[data[i + 1]], bl = lut[data[i + 2]];
    if (s !== 1) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      r = gray + (r - gray) * s;
      g = gray + (g - gray) * s;
      bl = gray + (bl - gray) * s;
    }
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * bl;
      const sg = 0.349 * r + 0.686 * g + 0.168 * bl;
      const sb = 0.272 * r + 0.534 * g + 0.131 * bl;
      r = sr; g = sg; bl = sb;
    }
    data[i] = clamp(r + w);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(bl - w);
  }
}

function drawAnnotations(ctx: CanvasRenderingContext2D, list: Annotation[], scale: number) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const a of list) {
    if (a.type === "pen") {
      if (a.points.length === 0) continue;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = a.size * scale;
      ctx.beginPath();
      a.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x * scale, y * scale + 0.01) : ctx.lineTo(x * scale, y * scale)));
      if (a.points.length === 1) ctx.lineTo(a.points[0][0] * scale + 0.01, a.points[0][1] * scale);
      ctx.stroke();
    } else {
      const px = a.size * scale;
      ctx.font = tx("600 {0}px \"Plus Jakarta Sans Variable\", system-ui, sans-serif", px);
      ctx.textBaseline = "top";
      // Okunabilirlik: her zeminde görünsün diye yumuşak koyu kontur
      ctx.lineWidth = Math.max(2, px * 0.14);
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(a.text, a.x * scale, a.y * scale);
      ctx.fillStyle = a.color;
      ctx.fillText(a.text, a.x * scale, a.y * scale);
    }
  }
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${(amount / 100) * 0.75})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Hattı çalıştırır: kaynak → (ölçek) → ayarlar → vinyet → çizimler → kırpma → yeniden boyut.
 * `showFull`: kırpma aracındayken kırpılmamış görüntüyü göstermek için.
 */
export function render(src: CanvasImageSource & { width: number; height: number }, st: EditState, scale: number, showFull = false): HTMLCanvasElement {
  const W = Math.round(src.width * scale);
  const H = Math.round(src.height * scale);
  const base = document.createElement("canvas");
  base.width = W;
  base.height = H;
  const ctx = base.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, W, H);
  if (!isNeutral({ ...st.adjust, vignette: 0 })) {
    const img = ctx.getImageData(0, 0, W, H);
    applyAdjust(img.data, st.adjust);
    ctx.putImageData(img, 0, 0);
  }
  drawVignette(ctx, W, H, st.adjust.vignette);
  drawAnnotations(ctx, st.annotations, scale);

  const crop = !showFull && st.crop ? st.crop : null;
  if (!crop && !(st.outWidth && !showFull)) return base;

  const cx = crop ? Math.round(crop.x * scale) : 0;
  const cy = crop ? Math.round(crop.y * scale) : 0;
  const cw = crop ? Math.max(1, Math.round(crop.w * scale)) : W;
  const ch = crop ? Math.max(1, Math.round(crop.h * scale)) : H;
  // Yeniden boyutlandırma yalnızca dışa aktarmada (scale=1) uygulanır
  const ow = scale === 1 && st.outWidth ? st.outWidth : cw;
  const oh = Math.round((ch / cw) * ow);
  const out = document.createElement("canvas");
  out.width = ow;
  out.height = oh;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(base, cx, cy, cw, ch, 0, 0, ow, oh);
  return out;
}

export const canvasToBase64 = (c: HTMLCanvasElement): Promise<string> =>
  new Promise((resolve, reject) =>
    c.toBlob(async (b) => {
      if (!b) return reject(new Error(tx("PNG üretilemedi")));
      const buf = new Uint8Array(await b.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      resolve(btoa(bin));
    }, "image/png"),
  );
