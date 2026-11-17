import { useEffect, useRef } from "react";
import { useSettings } from "@/stores/settings";

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string };

/** "rgb(12, 34, 56)" / "rgba(…)" → [r, g, b, a] */
function parse(c: string): [number, number, number, number] | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
  return [Number(r), Number(g), Number(b), Number(a)];
}

/** İmlecin altındaki ilk opak arka plan rengini bulur (yoksa vurgu rengi). */
function colorUnder(x: number, y: number, fallback: [number, number, number]): [number, number, number] {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  for (let i = 0; el && i < 12; i++, el = el.parentElement) {
    // Görselin üstündeysek görselin kendisi renk taşır; ortalama yerine vurgu tonu yeterli
    if (el instanceof HTMLImageElement || el instanceof HTMLCanvasElement || el instanceof SVGElement) return fallback;
    const c = parse(getComputedStyle(el).backgroundColor);
    if (c && c[3] > 0.25) return [c[0], c[1], c[2]];
  }
  return fallback;
}

/**
 * Altındaki rengi açıp parlatarak parçacık rengi üretir: koyu yüzeyde açık, renkli yüzeyde
 * aynı tonun parlak hali. Böylece parçacık her zeminde görünür ama zeminle uyumlu kalır.
 */
function glow([r, g, b]: [number, number, number], accent: [number, number, number]): string {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  // Neredeyse gri koyu zeminlerde vurgu rengine yaslan
  const base = sat < 24 ? accent.map((a, i) => a * 0.75 + [r, g, b][i] * 0.25) : [r, g, b];
  const lift = lum < 0.5 ? 0.55 : 0.2;
  const c = base.map((v) => Math.round(v + (255 - v) * lift));
  return `${c[0]},${c[1]},${c[2]}`;
}

const hsl = (h: number) => {
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.62 - 0.38 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return `${f(0)},${f(8)},${f(4)}`;
};

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Fare imlecinin geçtiği yerde, arka plan rengine göre renklenen küçük piksel parçacıklar. */
import { useWallet } from "@/stores/wallet";
import { TRAILS, type TrailStyle } from "@/lib/shop";

/** Kalp ve yıldız için küçük piksel desenleri (1 = dolu) */
const HEART = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
const STAR = ["00100", "00100", "11111", "00100", "00100"];

function stamp(ctx: CanvasRenderingContext2D, rows: string[], x: number, y: number, k: number) {
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === "1") ctx.fillRect(x + c * k, y + r * k, k, k);
}

export function CursorTrail() {
  const enabled = useSettings((s) => s.settings.theme.cursorTrail && !s.settings.theme.reduceMotion);
  const accent = useSettings((s) => s.settings.theme.accent);
  const trailId = useWallet((s) => s.view?.wallet.equipped.trail ?? null);
  const style: TrailStyle | null = trailId ? TRAILS[trailId] ?? null : null;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!enabled || !cv || !ctx) return;
    const acc = hexRgb(accent);
    const parts: P[] = [];
    let raf = 0, lastSpawn = 0, lastSample = 0, color = glow(acc, acc), lx = -1, ly = -1, alive = true;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      cv.width = Math.round(innerWidth * dpr);
      cv.height = Math.round(innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    resize();

    const move = (e: PointerEvent) => {
      const now = performance.now();
      // Renk örneklemesi pahalı (getComputedStyle); saniyede ~12 kez yeterli
      if (now - lastSample > 80) {
        lastSample = now;
        color = style === "stars" ? "255,231,163" : style === "snow" ? "238,246,255" : style === "hearts" ? "255,111,156" : style === "fire" ? "255,138,61" : glow(colorUnder(e.clientX, e.clientY, acc), acc);
      }
      const dist = lx < 0 ? 0 : Math.hypot(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
      // Hızlı harekette daha çok, dururken hiç parçacık
      if (now - lastSpawn < 16 || dist < 2) return;
      lastSpawn = now;
      const n = Math.min(3, 1 + Math.floor(dist / 18));
      for (let i = 0; i < n && parts.length < 140; i++) {
        const hue = (now / 8) % 360;
        const rc = style === "rainbow" ? hsl(hue) : style === "fire" && Math.random() > 0.6 ? "255,212,92" : color;
        parts.push({
          x: e.clientX + (Math.random() - 0.5) * 6,
          y: e.clientY + (Math.random() - 0.5) * 6,
          vx: (Math.random() - 0.5) * (style === "snow" ? 0.4 : 0.6),
          vy: style === "snow" ? 0.25 + Math.random() * 0.4 : style === "fire" ? -0.6 - Math.random() * 0.8 : -0.25 - Math.random() * 0.55,
          life: 0,
          max: 34 + Math.random() * 26,
          size: Math.random() > 0.7 ? 4 : 3,
          color: rc,
        });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const tick = () => {
      raf = 0;
      if (!alive) return;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.004;
        const t = p.life / p.max;
        if (t >= 1) { parts.splice(i, 1); continue; }
        const a = (1 - t) * 0.85;
        // Piksel görünümü: tam piksele yuvarlanmış kareler + hafif parıltı
        const px = Math.round(p.x), py = Math.round(p.y);
        if (style === "hearts" || style === "stars") {
          ctx.fillStyle = `rgba(${p.color},${a.toFixed(3)})`;
          stamp(ctx, style === "hearts" ? HEART : STAR, px, py, p.size > 3 ? 2 : 1);
          continue;
        }
        if (style === "snow") p.vy += 0.006; // kar aşağı süzülür
        ctx.fillStyle = `rgba(${p.color},${(a * 0.25).toFixed(3)})`;
        ctx.fillRect(px - 2, py - 2, p.size + 4, p.size + 4);
        ctx.fillStyle = `rgba(${p.color},${a.toFixed(3)})`;
        ctx.fillRect(px, py, p.size, p.size);
      }
      // Parçacık kalmayınca döngü durur (boşta işlemci harcamaz)
      if (parts.length) raf = requestAnimationFrame(tick);
    };

    const leave = () => { lx = -1; ly = -1; };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerleave", leave);
    window.addEventListener("resize", resize);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerleave", leave);
      window.removeEventListener("resize", resize);
      ctx.clearRect(0, 0, innerWidth, innerHeight);
    };
  }, [enabled, accent, style]);

  if (!enabled) return null;
  return <canvas ref={ref} className="cursor-trail" aria-hidden />;
}
