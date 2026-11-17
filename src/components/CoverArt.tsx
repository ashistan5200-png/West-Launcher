import { memo, useMemo } from "react";
import { tx } from "@/lib/i18n";

/**
 * Instance kapakları için prosedürel piksel manzara (SVG, tek renkli bloklar,
 * keskin kenarlar). Aynı kimlik her zaman aynı manzarayı üretir; görsel dosya gerekmez.
 */

type Palette = { sky: [string, string]; sun: string; layers: [string, string, string]; stars?: boolean; name: string };

const PALETTES: Palette[] = [
  { name: "dusk", sky: ["#2a1b3d", "#e8915a"], sun: "#ffd28a", layers: ["#7a3f52", "#4a2740", "#24162a"] },
  { name: "night", sky: ["#0b1022", "#26365e"], sun: "#e8ecf5", layers: ["#2b3a5c", "#1c2742", "#10172b"], stars: true },
  { name: "forest", sky: ["#21384a", "#8fc1b5"], sun: "#f4f1d0", layers: ["#4e7d55", "#2f5a3c", "#1a3324"] },
  { name: "nether", sky: ["#2a0b0b", "#8a2c1d"], sun: "#ffb35c", layers: ["#6b1f1f", "#441313", "#220909"] },
  { name: "ocean", sky: ["#0f2b3d", "#5fb2c9"], sun: "#fff3c4", layers: ["#2f7c8f", "#1d5566", "#0f2f3b"] },
  { name: "end", sky: ["#120b1f", "#3d2a5c"], sun: "#e9e2a8", layers: ["#4d3d6e", "#2f2547", "#181226"], stars: true },
  { name: "desert", sky: ["#3b2a4a", "#f0b27a"], sun: "#fff0c2", layers: ["#c98b5a", "#9a6240", "#5c3926"] },
];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Küçük, deterministik rastgele sayı üreteci */
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export function paletteFor(seed: string) {
  return PALETTES[hash(seed) % PALETTES.length];
}

function ridge(r: () => number, W: number, PX: number, base: number, amp: number, rough: number) {
  const cols = W / PX;
  const out: number[] = [];
  let y = base + (r() - 0.5) * amp;
  for (let i = 0; i <= cols; i++) {
    y += (r() - 0.5) * rough;
    y = Math.max(base - amp, Math.min(base + amp, y));
    out.push(Math.round(y / PX) * PX);
  }
  return out;
}

function Cover({ seed, className, sun = true, wide = false }: { seed: string; className?: string; sun?: boolean; wide?: boolean }) {
  // Geniş alanlarda (ana sayfa) pikseller iri görünmesin: daha geniş tuval, aynı piksel boyu
  const W = wide ? 720 : 320, H = wide ? 200 : 120, PX = wide ? 6 : 8;
  const art = useMemo(() => {
    const h = hash(seed);
    const p = PALETTES[h % PALETTES.length];
    const r = rng(h);
    const k = H / 120;
    const sunX = Math.round((W * 0.55 + r() * W * 0.38) / PX) * PX;
    const sunY = Math.round((22 + r() * 22) * k / PX) * PX;
    const ridges = [ridge(r, W, PX, 62 * k, 22 * k, 18 * k), ridge(r, W, PX, 82 * k, 16 * k, 14 * k), ridge(r, W, PX, 100 * k, 10 * k, 10 * k)];
    const stars = p.stars ? Array.from({ length: wide ? 60 : 22 }, () => [Math.round(r() * (W / 4)) * 4, Math.round(r() * (H * 0.45) / 4) * 4, r() > 0.7 ? 2 : 1] as const) : [];
    const clouds = !p.stars ? Array.from({ length: wide ? 5 : 3 }, () => [Math.round((r() * W) / PX) * PX, Math.round((10 + r() * 30) * k / PX) * PX, Math.round((24 + r() * 32) * k / PX) * PX] as const) : [];
    // Piksel daire güneş
    const R = Math.round(14 * k / PX) + 1;
    const sunPx: [number, number][] = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= R * R + R * 0.6) sunPx.push([sunX + dx * PX, sunY + dy * PX]);
    return { p, ridges, stars, clouds, sunPx, id: `cv${h.toString(36)}${wide ? "w" : ""}` };
  }, [seed, W, H, PX, wide]);
  const { p } = art;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={tx("xMidYMid slice")} shapeRendering="crispEdges" aria-hidden>
      <defs>
        <linearGradient id={art.id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.sky[0]} />
          <stop offset="1" stopColor={p.sky[1]} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${art.id})`} />
      {art.stars.map(([x, y, s], i) => <rect key={i} x={x} y={y} width={s * 2} height={s * 2} fill="#fff" opacity={0.75} />)}
      {sun && (
        <g fill={p.sun}>
          {art.sunPx.map(([x, y], i) => <rect key={i} x={x} y={y} width={PX} height={PX} />)}
        </g>
      )}
      {art.clouds.map(([x, y, w], i) => (
        <g key={i} fill="#fff" opacity={0.18}>
          <rect x={x} y={y} width={w} height={PX} />
          <rect x={x + PX} y={y - PX} width={Math.max(PX, w - 2 * PX)} height={PX} />
        </g>
      ))}
      {art.ridges.map((rd, li) => (
        <path
          key={li}
          fill={p.layers[li]}
          d={`M0 ${H} ` + rd.map((y, i) => tx("L{0} {1} L{2} {3}", i * PX, y, (i + 1) * PX, y)).join(" ") + tx(" L{0} {1} Z", W, H)}
        />
      ))}
    </svg>
  );
}

export const CoverArt = memo(Cover);
