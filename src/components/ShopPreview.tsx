import { Backpack, Cat, Crown, Feather, Flame, GraduationCap, Heart, Music, Sparkles, Star } from "lucide-react";
import { PlusMark } from "@/components/PlusBadge";
import { meta, SKIES, THEME_PACKS, type ShopItem } from "@/lib/shop";

const rgb = (s: string) => `rgb(${s})`;

/** Mağaza kartının önizlemesi: öğe türüne göre küçük bir çizim */
export function ShopPreview({ item }: { item: ShopItem }) {
  const m = meta(item.id);
  const [c0, c1] = m.colors;
  const bg = { background: `linear-gradient(150deg, ${c0} 0%, ${c0} 40%, ${c1}33 100%)` };

  if (item.kind === "plus") {
    return (
      <div className="sp sp-plus" style={bg}>
        <PlusMark size={58} />
        <span className="sp-days">{item.days >= 365 ? "1 YIL" : `${item.days} GÜN`}</span>
      </div>
    );
  }

  if (item.kind === "theme") {
    const p = THEME_PACKS[item.id];
    return (
      <div className={`sp sp-theme${p?.aurora ? " aurora" : ""}`} style={{ background: rgb(p.bg) }}>
        <div className="sp-win" style={{ background: rgb(p.surface) }}>
          <div className="sp-side" style={{ background: rgb(p.surface2) }}>
            <i style={{ background: p.accent }} /><i /><i /><i />
          </div>
          <div className="sp-main">
            <div className="sp-hero" style={{ background: `linear-gradient(120deg, ${rgb(p.surface3)}, ${p.accent}55)` }}>
              <b style={{ background: p.accent }} />
            </div>
            <div className="sp-cards"><span style={{ background: rgb(p.surface2) }} /><span style={{ background: rgb(p.surface2) }} /><span style={{ background: rgb(p.surface2) }} /></div>
          </div>
        </div>
      </div>
    );
  }

  if (item.kind === "sky") {
    const s = SKIES[item.id];
    return (
      <div className={`sp sp-sky fx-${s.fx ?? "none"}`}>
        <svg viewBox="0 0 160 90" preserveAspectRatio="none" width="100%" height="100%">
          <defs>
            <linearGradient id={`sk${item.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.sky[0]} />
              <stop offset="0.85" stopColor={s.sky[1]} />
            </linearGradient>
          </defs>
          <rect width="160" height="90" fill={`url(#sk${item.id})`} />
          {s.stars && [12, 30, 55, 78, 96, 120, 140, 22, 66, 108].map((x, i) => <rect key={i} x={x} y={6 + ((i * 13) % 30)} width="1.6" height="1.6" fill="#fff" opacity={0.5 + (i % 3) * 0.2} />)}
          {s.fx === "aurora" && <path d="M0 30 Q 40 10 80 28 T 160 22 L160 40 Q 120 46 80 38 T 0 44 Z" fill="#3fe0b0" opacity="0.35" />}
          <circle cx="118" cy="22" r="8" fill={s.sun} />
          <path d="M0 56 L18 48 L34 54 L52 42 L70 50 L90 40 L110 50 L130 44 L160 52 L160 90 L0 90 Z" fill={s.layers[0]} />
          <path d="M0 66 L24 58 L44 64 L66 56 L86 62 L108 54 L132 62 L160 58 L160 90 L0 90 Z" fill={s.layers[1]} />
          <path d="M0 76 L30 70 L58 76 L84 68 L112 74 L138 70 L160 74 L160 90 L0 90 Z" fill={s.layers[2]} />
          {s.fx === "snow" && [10, 34, 58, 82, 106, 130, 150, 22, 70, 118].map((x, i) => <circle key={i} cx={x} cy={10 + ((i * 17) % 60)} r="1.3" fill="#fff" opacity="0.85" />)}
          {s.fx === "petals" && [14, 40, 64, 90, 116, 142, 28, 102].map((x, i) => <ellipse key={i} cx={x} cy={12 + ((i * 19) % 55)} rx="2" ry="1.2" fill="#ffc2da" opacity="0.9" />)}
          {s.fx === "embers" && [18, 44, 70, 96, 122, 148, 32, 84].map((x, i) => <rect key={i} x={x} y={30 + ((i * 11) % 45)} width="1.6" height="1.6" fill="#ffb35c" />)}
          {s.fx === "void" && [16, 42, 68, 94, 120, 146, 30, 80].map((x, i) => <rect key={i} x={x} y={20 + ((i * 13) % 50)} width="1.8" height="1.8" fill="#c79bff" opacity="0.8" />)}
          {s.fx === "meteors" && <path d="M40 8 l22 10" stroke="#fff" strokeWidth="1" opacity="0.8" />}
        </svg>
      </div>
    );
  }

  if (item.kind === "trail") {
    const dots = Array.from({ length: 9 }, (_, i) => i);
    return (
      <div className="sp sp-trail" style={bg}>
        <svg viewBox="0 0 160 90" width="100%" height="100%">
          {dots.map((i) => {
            const x = 20 + i * 14, y = 66 - Math.sin(i / 2.2) * 26, a = 0.25 + i / 12, s = 2 + i * 0.5;
            if (item.id === "trail_hearts") return <path key={i} transform={`translate(${x} ${y}) scale(${s / 4})`} d="M0 2 C0 -1 -4 -1 -4 2 C-4 4 0 6 0 7 C0 6 4 4 4 2 C4 -1 0 -1 0 2Z" fill="#ff6f9c" opacity={a} />;
            const fill = item.id === "trail_rainbow" ? `hsl(${i * 40} 90% 65%)` : item.id === "trail_fire" ? (i > 5 ? "#ffd45c" : "#ff7a3d") : item.id === "trail_snow" ? "#eef6ff" : "#ffe7a3";
            if (item.id === "trail_stars") return <path key={i} transform={`translate(${x} ${y}) scale(${s / 3})`} d="M0 -3 L0.9 -0.9 L3 0 L0.9 0.9 L0 3 L-0.9 0.9 L-3 0 L-0.9 -0.9Z" fill={fill} opacity={a} />;
            return <rect key={i} x={x} y={y} width={s} height={s} fill={fill} opacity={a} />;
          })}
          <path d="M140 18 l0 14 l4 -4 l3 6 l2 -1 l-3 -6 l5 0z" fill="#fff" />
        </svg>
      </div>
    );
  }

  if (item.kind === "menuTheme") {
    return (
      <div className="sp sp-menu" style={{ background: `linear-gradient(180deg, #5d8a4e 0%, #6b9b5a 55%, #7a5a3a 56%)` }}>
        <div className="sp-mpanel" style={{ background: `${c0}ee`, borderColor: `${c1}66` }}>
          <b style={{ background: c1 }} />
          <i style={{ background: `${c1}33` }} /><i style={{ background: `${c1}22` }} /><i style={{ background: `${c1}22` }} />
        </div>
      </div>
    );
  }

  if (item.kind === "cape") {
    return (
      <div className="sp sp-cape" style={{ background: "linear-gradient(160deg, #1a1c22, #262932)" }}>
        <svg viewBox="0 0 80 90" height="86%">
          <defs>
            <linearGradient id={`cp${item.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c0} />
              <stop offset="1" stopColor={c1} />
            </linearGradient>
          </defs>
          <path d="M18 6 H62 L66 84 Q40 90 14 84 Z" fill={`url(#cp${item.id})`} stroke="#00000055" strokeWidth="1.5" />
          <path d="M18 6 H62 L63 14 H17 Z" fill="#00000040" />
          {item.id === "cape_plus" ? <g transform="translate(40 46) scale(1.1)"><rect x="-9" y="-9" width="18" height="18" rx="4" transform="rotate(45)" fill="#f2b654" /><path d="M0 -5v10M-5 0h10" stroke="#2a1a08" strokeWidth="2.4" strokeLinecap="round" /></g>
            : item.id === "cape_west" ? <g transform="translate(40 46)"><circle r="10" fill="none" stroke="#e8a25c" strokeWidth="2" /><path d="M0 -7 L3 0 H-3Z" fill="#e8a25c" transform="rotate(-35)" /></g>
            : <path d="M24 30 L32 44 L40 32 L48 46 L56 34" fill="none" stroke="#ffffff55" strokeWidth="2" />}
        </svg>
      </div>
    );
  }

  const Icon = {
    hat_cap: GraduationCap, hat_catears: Cat, hat_tophat: GraduationCap, hat_wizard: Sparkles, hat_crown: Crown, hat_halo: Sparkles,
    back_bag: Backpack, back_wings: Feather, back_dragon: Feather, back_plus_wings: Feather,
    aura_hearts: Heart, aura_notes: Music, aura_flame: Flame, aura_stars: Star,
  }[item.id] ?? Sparkles;
  return (
    <div className="sp sp-icon" style={bg}>
      <div className="sp-glow" style={{ background: `radial-gradient(closest-side, ${c1}55, transparent)` }} />
      <Icon size={46} color={c1} strokeWidth={1.6} />
    </div>
  );
}
