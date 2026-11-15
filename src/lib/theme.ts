import type { ThemeSettings } from "./types";

type RGB = [number, number, number];

const hexToRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const mix = (a: RGB, b: RGB, t: number): RGB =>
  a.map((v, i) => Math.round(v + (b[i] - v) * t)) as RGB;

/** WCAG göreli parlaklık — vurgu üzerindeki metin rengini seçmek için. */
const luminance = ([r, g, b]: RGB) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const css = (c: RGB) => `${c[0]} ${c[1]} ${c[2]}`;

/**
 * Tema motoru: tek bir vurgu renginden tüm ton paletini türetip CSS
 * değişkenlerine yazar. Bileşenler yalnızca `rgb(var(--accent) / α)` kullanır.
 */
export function applyTheme(t: ThemeSettings) {
  const root = document.documentElement;
  const base = hexToRgb(t.accent);
  const white: RGB = [255, 255, 255];
  const black: RGB = [0, 0, 0];

  root.style.setProperty("--accent", css(base));
  root.style.setProperty("--accent-hover", css(mix(base, white, 0.12)));
  root.style.setProperty("--accent-press", css(mix(base, black, 0.15)));
  root.style.setProperty("--accent-soft", css(mix(base, [30, 31, 35], 0.84)));
  root.style.setProperty("--on-accent", luminance(base) > 0.3 ? "16 18 21" : "240 241 243");
  root.style.setProperty("--blur", `${t.blur}px`);
  root.style.setProperty("--surface-alpha", String(t.opacity));

  root.dataset.density = t.density;
  root.dataset.effect = t.windowEffect;
  root.dataset.motion = t.reduceMotion ? "reduced" : "full";
}

/**
 * Mat, düşük doygunluklu vurgu seti. Hepsi antrasit zeminde okunur kalır,
 * hiçbiri neon/parlama hissi vermez (HSL doygunluk ≈ %20–35).
 */
export const DEFAULT_ACCENT = "#e8a25c";
/** Eski varsayılan: yeni tasarıma geçerken bu değer yeni varsayılana çevrilir. */
export const LEGACY_DEFAULT_ACCENT = "#7fa7c9";

export const ACCENT_PRESETS = [
  "#e8a25c", // West gün batımı (varsayılan)
  "#7fa7c9", // buz mavisi
  "#79a88a", // adaçayı yeşili
  "#6aa6a2", // mat petrol
  "#9aa4b2", // arduvaz
  "#a08cb8", // soluk leylak
  "#c08573", // kil
  "#c2a878", // kum
  "#b8b3a8", // taş
];
