import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/ipc";
import { useInstances } from "@/stores/instances";
import { useSettings } from "@/stores/settings";
import type { Instance } from "@/lib/types";
import { paletteFor } from "./CoverArt";
import { coverSeedOf } from "./InstanceBanner";
type SkyFx = "meteors" | "snow" | "petals" | "embers" | "void" | "aurora" | null;
interface SkyScene { sky: [string, string]; sun: string; layers: [string, string, string]; stars: boolean; fx: SkyFx }

/** Öne çıkan instance: önce oynanan, yoksa en son oynanan, yoksa ilki. */
export function useFeaturedInstance(): Instance | null {
  const instances = useInstances((s) => s.instances);
  const running = useInstances((s) => s.running);
  return useMemo(() => {
    const list = instances.filter((i) => !i.isTemplate);
    const live = list.find((i) => running[i.id] !== undefined);
    if (live) return live;
    const played = list.filter((i) => i.lastPlayed).sort((a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? ""));
    return played[0] ?? list[0] ?? null;
  }, [instances, running]);
}

type Pal = { sky: [string, string]; sun: string; layers: [string, string, string]; stars: boolean };

const PX = 6;
const rand = (s: number) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

/** Döngüsel dağ profili: -1…1 */
function ridge(n: number, rough: number, seed: number) {
  const r = rand(seed);
  const out: number[] = [];
  let y = 0;
  for (let i = 0; i < n; i++) { y += (r() - 0.5) * rough; y *= 0.96; out.push(y); }
  const max = Math.max(...out.map(Math.abs)) || 1;
  return out.map((v) => v / max);
}

/** Özel banner görselinin renklerinden palet çıkarır (gökyüzü üstte, katmanlar altta koyulaşarak). */
async function paletteFromImage(src: string): Promise<Pal | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = src;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement("canvas");
  c.width = 8; c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, 8, 8);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, 8, 8).data; } catch { return null; }
  const row = (y0: number, y1: number, dark = 1) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < 8; x++) { const i = (y * 8 + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    const f = (v: number) => Math.round((v / n) * dark).toString(16).padStart(2, "0");
    return `#${f(r)}${f(g)}${f(b)}`;
  };
  const top = row(0, 2);
  const lum = parseInt(top.slice(1, 3), 16) + parseInt(top.slice(3, 5), 16) + parseInt(top.slice(5, 7), 16);
  return { sky: [row(0, 2, 0.75), row(3, 5)], sun: "#fff1c9", layers: [row(5, 6, 0.7), row(6, 7, 0.5), row(7, 8, 0.32)], stars: lum < 240 };
}

/**
 * Tüm sayfaların arkasında, öne çıkan instance'ın banner'ından üretilen animasyonlu
 * piksel gökyüzü: göz kırpan yıldızlar, süzülen bulutlar, nefes alan güneş ve kayan
 * dağ katmanları. Özel banner varsa görsel bulanıklaştırılıp arkaya konur ve gökyüzü
 * onun renk paletiyle çizilir.
 */
/** quiet: içerik sayfalarında (ana sayfa dışında) sahne geri planda soluk kalır, formlarla yarışmaz */
export function AmbientSky({ quiet = false }: { quiet?: boolean }) {
  const inst = useFeaturedInstance();
  // Oyun açıkken sahne durağan çizilir (tek kare), döngü çalışmaz
  const gameRunning = useInstances((s) => Object.keys(s.running).length > 0);
  const reduce = useSettings((s) => s.settings.theme.reduceMotion) || gameRunning;
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const banner = inst?.banner ? (isTauri() ? convertFileSrc(inst.banner) : inst.banner) : null;
  const seed = inst ? coverSeedOf(inst) : "west-client";
  const [imgPal, setImgPal] = useState<Pal | null>(null);
  const scene = null as SkyScene | null;
  const fx: SkyFx = scene?.fx ?? null;
  const useBanner = !!banner && !scene;

  useEffect(() => {
    setImgPal(null);
    if (banner) void paletteFromImage(banner).then(setImgPal);
  }, [banner]);

  const pal: Pal = useMemo(() => {
    if (scene) return { sky: scene.sky, sun: scene.sun, layers: scene.layers, stars: scene.stars };
    if (imgPal) return imgPal;
    const p = paletteFor(seed);
    return { sky: p.sky, sun: p.sun, layers: p.layers, stars: !!p.stars };
  }, [seed, imgPal, scene]);

  // Kaydırılan içerik alanının görünen yüksekliğini izle (arka plan sabit kalsın)
  useEffect(() => {
    const parent = holder.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => setHeight(parent.clientHeight));
    ro.observe(parent);
    setHeight(parent.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const h0 = hash(seed);
    const r = rand(h0);
    const stars = Array.from({ length: 110 }, () => ({ x: r(), y: r() * 0.5, s: r() > 0.82 ? 2 : 1, p: r() * 6.28 }));
    const clouds = Array.from({ length: 6 }, () => ({ x: r(), y: 0.06 + r() * 0.22, w: 10 + Math.floor(r() * 16), v: 0.003 + r() * 0.005 }));
    const layers = [
      { base: 0.6, amp: 0.12, speed: 0.003, data: ridge(420, 2.2, h0 ^ 7) },
      { base: 0.72, amp: 0.09, speed: 0.007, data: ridge(420, 2.6, h0 ^ 11) },
      { base: 0.84, amp: 0.06, speed: 0.012, data: ridge(420, 3, h0 ^ 17) },
    ];
    const sunX = 0.72 + r() * 0.16;
    // Sahne efektleri: düşen/yükselen parçacıklar
    const fxParts = Array.from({ length: fx === "aurora" || fx === "meteors" ? 0 : 70 }, () => ({ x: r(), y: r(), v: 0.4 + r() * 0.8, p: r() * 6.28, s: r() > 0.7 ? 2 : 1 }));
    let meteor = { x: 0, y: 0, life: 0 };
    let raf = 0, last = 0, alive = true;
    const t0 = performance.now();

    const draw = (now: number) => {
      if (!alive) return;
      // ~30 kare/sn yeterli; pencere görünmezken tarayıcı zaten durdurur
      if (now - last < 33 && !reduce) { raf = requestAnimationFrame(draw); return; }
      last = now;
      const w = Math.ceil(cv.clientWidth / PX), h = Math.ceil(cv.clientHeight / PX);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; ctx.imageSmoothingEnabled = false; }
      const t = reduce ? 0 : (now - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      if (!useBanner) {
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, pal.sky[0]);
        g.addColorStop(0.8, pal.sky[1]);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      if (fx === "aurora" && !useBanner) {
        // Aurora: gökte dalgalanan yeşil-mavi şeritler
        for (let band = 0; band < 3; band++) {
          const col = ["rgba(63,224,176,", "rgba(122,168,255,", "rgba(186,120,255,"][band];
          for (let x = 0; x < w; x++) {
            const k = x / w;
            const y0 = h * (0.12 + band * 0.07 + Math.sin(k * 6 + t * 0.35 + band) * 0.05 + Math.sin(k * 15 - t * 0.6) * 0.015);
            const len = Math.floor(h * (0.12 + 0.06 * Math.sin(k * 9 + t * 0.5 + band * 2)));
            const a = (0.10 + 0.08 * Math.sin(k * 11 + t * 0.8 + band)) * (band === 0 ? 1.4 : 1);
            for (let j = 0; j < len; j += 1) {
              ctx.fillStyle = col + (a * (1 - j / len)).toFixed(3) + ")";
              ctx.fillRect(x, Math.floor(y0) + j, 1, 1);
            }
          }
        }
      }
      if (pal.stars) for (const s of stars) {
        const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 1.3 + s.p));
        ctx.fillStyle = `rgba(255,255,255,${(a * (1 - s.y * 1.4)).toFixed(3)})`;
        ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * h), s.s, s.s);
      }
      // Güneş + hâlesi
      const R = Math.max(4, Math.floor(Math.min(w, h) * 0.07));
      const sx = Math.floor(w * sunX), sy = Math.floor(h * (0.2 + Math.sin(t * 0.15) * 0.015));
      ctx.fillStyle = pal.sun + "2e";
      for (let dy = -R * 2; dy <= R * 2; dy++) for (let dx = -R * 2; dx <= R * 2; dx++) {
        const d = dx * dx + dy * dy;
        if (d <= 4 * R * R && d > R * R * 1.4 && (dx + dy) % 3 === 0) ctx.fillRect(sx + dx, sy + dy, 1, 1);
      }
      ctx.fillStyle = pal.sun;
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R) ctx.fillRect(sx + dx, sy + dy, 1, 1);
      // Bulutlar
      ctx.fillStyle = "rgba(255,255,255,.14)";
      for (const c of clouds) {
        const x = Math.floor((((c.x + t * c.v) % 1.3) - 0.15) * w), y = Math.floor(c.y * h);
        ctx.fillRect(x, y, c.w, 2);
        ctx.fillRect(x + 2, y - 2, c.w - 4, 2);
      }
      // Kayan dağ katmanları (parallax)
      layers.forEach((L, li) => {
        ctx.fillStyle = pal.layers[li];
        const off = t * L.speed * L.data.length;
        for (let x = 0; x < w; x++) {
          const y = Math.floor(h * (L.base - L.data[Math.floor(x + off) % L.data.length] * L.amp));
          ctx.fillRect(x, y, 1, h - y);
        }
      });
      // Ön plan efektleri
      if (fx === "meteors") {
        if (meteor.life <= 0 && Math.random() < 0.006) meteor = { x: 0.2 + Math.random() * 0.6, y: 0.05 + Math.random() * 0.15, life: 1 };
        if (meteor.life > 0) {
          meteor.life -= 0.03;
          const mx = Math.floor(w * (meteor.x + (1 - meteor.life) * 0.18)), my = Math.floor(h * (meteor.y + (1 - meteor.life) * 0.1));
          for (let i = 0; i < 10; i++) { ctx.fillStyle = `rgba(255,255,255,${((1 - i / 10) * meteor.life).toFixed(3)})`; ctx.fillRect(mx - i * 2, my - i, 2, 1); }
        }
      } else if (fx) {
        for (const q of fxParts) {
          let x: number, y: number, col: string;
          if (fx === "snow") { y = (q.y + t * 0.025 * q.v) % 1; x = (q.x + Math.sin(t * 0.6 + q.p) * 0.01) % 1; col = "rgba(255,255,255,0.85)"; }
          else if (fx === "petals") { y = (q.y + t * 0.02 * q.v) % 1; x = ((q.x + t * 0.012 * q.v + Math.sin(t + q.p) * 0.01) % 1 + 1) % 1; col = q.s > 1 ? "rgba(255,194,218,0.95)" : "rgba(242,166,196,0.85)"; }
          else if (fx === "embers") { y = 1 - ((q.y + t * 0.03 * q.v) % 1); x = (q.x + Math.sin(t * 0.8 + q.p) * 0.012) % 1; col = `rgba(255,${150 + Math.floor(q.v * 60)},70,${(0.5 + 0.5 * Math.sin(t * 4 + q.p)).toFixed(2)})`; }
          else { y = (q.y + Math.sin(t * 0.3 + q.p) * 0.03 + 1) % 1; x = (q.x + t * 0.004 * q.v) % 1; col = `rgba(199,155,255,${(0.35 + 0.4 * Math.sin(t * 2 + q.p)).toFixed(2)})`; }
          ctx.fillStyle = col;
          const px = Math.floor(x * w), py = Math.floor(y * h);
          ctx.fillRect(px, py, q.s + (fx === "petals" ? 1 : 0), q.s);
        }
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [seed, pal, banner, reduce, height, fx, useBanner]);

  const motes = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ left: (i * 37 + 11) % 100, delay: -((i * 3.3) % 20), dur: 14 + ((i * 7) % 12), size: 3 + (i % 3) * 2, top: 35 + ((i * 53) % 60) })), []);

  return (
    <div className={quiet ? "ambient-holder quiet" : "ambient-holder"} ref={holder} aria-hidden>
      <div className="ambient" style={{ height: height || "100vh" }}>
        {useBanner && <img className="ambient-img" src={banner!} alt="" draggable={false} />}
        <canvas ref={canvas} className={useBanner ? "ambient-sky over-image" : "ambient-sky"} />
        <div className="ambient-fade" />
        {!reduce && motes.map((m, i) => (
          <span key={i} className="mote" style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size, animationDelay: `${m.delay}s`, animationDuration: `${m.dur}s` }} />
        ))}
      </div>
    </div>
  );
}
