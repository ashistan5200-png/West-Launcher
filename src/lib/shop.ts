/**
 * Mağaza öğelerinin görünen bilgileri ve görünüm tanımları. Fiyatlar ve kurallar Rust tarafında
 * (src-tauri/src/wallet.rs); burada yalnızca ad, açıklama, önizleme ve uygulanacak görünüm var.
 */
import { tx } from "@/lib/i18n";

export type ShopKind = "plus" | "theme" | "sky" | "trail" | "menuTheme" | "cape" | "hat" | "back" | "aura";

export interface ShopItem {
  id: string;
  kind: ShopKind;
  price: number;
  plusOnly: boolean;
  days: number;
}

export interface ItemMeta {
  name: string;
  desc: string;
  /** Önizleme renkleri (kart arka planı) */
  colors: [string, string];
  /** Oyunda mı görünür (launcher'da değil) */
  inGame?: boolean;
}

/** Kuşanma yuvası: aynı yuvaya bir öğe takılır */
export const SLOT: Record<ShopKind, string> = {
  plus: "plus", theme: "theme", sky: "sky", trail: "trail", menuTheme: "menuTheme", cape: "cape", hat: "hat", back: "back", aura: "aura",
};

export const CATEGORIES: { id: ShopKind | "featured"; label: string }[] = [
  { id: "featured", label: tx("Öne çıkanlar") },
  { id: "plus", label: "West Plus" },
  { id: "cape", label: tx("Pelerinler") },
  { id: "hat", label: tx("Şapkalar") },
  { id: "back", label: tx("Sırt") },
  { id: "aura", label: tx("Auralar") },
  { id: "theme", label: tx("Launcher temaları") },
  { id: "sky", label: tx("Arka planlar") },
  { id: "trail", label: tx("İmleç izleri") },
  { id: "menuTheme", label: tx("Oyun içi menü") },
];

export const FEATURED = ["plus_30", "back_wings", "hat_crown", "cape_sakura", "theme_end", "sky_sakura", "trail_fire", "aura_flame"];

export const META: Record<string, ItemMeta> = {
  plus_30: { name: tx("West Plus · 30 gün"), desc: tx("Plus logosu, Plus'a özel her şey ve saatte 150 coin."), colors: ["#3a2a12", "#f2b654"] },
  plus_90: { name: tx("West Plus · 90 gün"), desc: tx("3 ay West Plus. 30 günlükten %13 daha avantajlı."), colors: ["#3a2a12", "#f2b654"] },
  plus_365: { name: tx("West Plus · 1 yıl"), desc: tx("Bir yıl boyunca West Plus. En avantajlısı."), colors: ["#3a2a12", "#ffe7a3"] },

  theme_ocean: { name: tx("Okyanus"), desc: tx("Derin mavi yüzeyler, deniz köpüğü vurgu."), colors: ["#0c1622", "#5fb2c9"] },
  theme_forest: { name: tx("Orman"), desc: tx("Koyu yosun tonları, taze yaprak yeşili."), colors: ["#0d1410", "#79c08a"] },
  theme_rose: { name: tx("Gül kurusu"), desc: tx("Yumuşak mürdüm zemin, pembe vurgu."), colors: ["#170e13", "#e58aa8"] },
  theme_mono: { name: tx("Tek renk"), desc: tx("Saf siyah-beyaz, dikkat dağıtmayan."), colors: ["#0a0a0a", "#d9d9d9"] },
  theme_nether: { name: tx("Nether"), desc: tx("Kor kırmızısı zemin, lav turuncusu."), colors: ["#160909", "#ff7a45"] },
  theme_end: { name: tx("End"), desc: tx("Boşluk moru, End taşı ışıltısı."), colors: ["#0f0b1a", "#b28cff"] },
  theme_gold: { name: tx("Altın çağ"), desc: tx("West Plus'a özel: siyah ve altın."), colors: ["#100d07", "#f2b654"] },
  theme_aurora: { name: tx("Kutup ışıkları"), desc: tx("West Plus'a özel: arka planda dalgalanan aurora."), colors: ["#06121a", "#5fe3b0"] },

  sky_dawn: { name: tx("Şafak"), desc: tx("Pembe-turuncu sabah göğü."), colors: ["#3a2a52", "#f2a07b"] },
  sky_night: { name: tx("Yıldızlı gece"), desc: tx("Kayan yıldızlarla derin gece."), colors: ["#070b1a", "#2a3d6e"] },
  sky_snow: { name: tx("Kar yağışı"), desc: tx("Sessizce düşen kar taneleri."), colors: ["#1b2636", "#a9c4dd"] },
  sky_sakura: { name: tx("Kiraz bahçesi"), desc: tx("Rüzgârda uçuşan kiraz yaprakları."), colors: ["#2b1830", "#f2a6c4"] },
  sky_nether: { name: tx("Nether ufku"), desc: tx("Yükselen közler ve lav ışığı."), colors: ["#1f0707", "#c2401f"] },
  sky_end: { name: tx("End boşluğu"), desc: tx("Süzülen mor End parçacıkları."), colors: ["#0b0716", "#6a4aa8"] },
  sky_aurora: { name: tx("Aurora gecesi"), desc: tx("West Plus'a özel: gökte dans eden ışıklar."), colors: ["#04101a", "#3fe0b0"] },

  trail_stars: { name: tx("Yıldız tozu"), desc: tx("Parıldayan küçük yıldızlar."), colors: ["#141a2e", "#ffe7a3"] },
  trail_snow: { name: tx("Kar taneleri"), desc: tx("Aşağı süzülen kar."), colors: ["#18222e", "#e8f4ff"] },
  trail_fire: { name: tx("Alev"), desc: tx("Yükselen kıvılcımlar."), colors: ["#1e0c06", "#ff8a3d"] },
  trail_hearts: { name: tx("Kalpler"), desc: tx("Piksel kalpler."), colors: ["#22101a", "#ff6f9c"] },
  trail_rainbow: { name: tx("Gökkuşağı"), desc: tx("West Plus'a özel: renk değiştiren iz."), colors: ["#141414", "#8ad6ff"] },

  menu_ocean: { name: tx("Okyanus menüsü"), desc: tx("Oyun içi West menüleri mavi tonlarda."), colors: ["#0c1622", "#5fb2c9"], inGame: true },
  menu_forest: { name: tx("Orman menüsü"), desc: tx("Oyun içi West menüleri yeşil tonlarda."), colors: ["#0d1410", "#79c08a"], inGame: true },
  menu_nether: { name: tx("Nether menüsü"), desc: tx("Oyun içi West menüleri kor kırmızısı."), colors: ["#160909", "#ff7a45"], inGame: true },
  menu_end: { name: tx("End menüsü"), desc: tx("Oyun içi West menüleri boşluk moru."), colors: ["#0f0b1a", "#b28cff"], inGame: true },
  menu_gold: { name: tx("Altın menü"), desc: tx("West Plus'a özel: altın oyun içi menüler."), colors: ["#100d07", "#f2b654"], inGame: true },

  cape_west: { name: tx("West pelerini"), desc: tx("Herkese hediye: West pusulalı pelerin."), colors: ["#1b1d24", "#e8a25c"], inGame: true },
  cape_sunset: { name: tx("Gün batımı pelerini"), desc: tx("Turuncudan mora geçen gökyüzü."), colors: ["#3a1c3d", "#ff9a5a"], inGame: true },
  cape_ocean: { name: tx("Okyanus pelerini"), desc: tx("Dalgalı mavi desen."), colors: ["#0c2a3d", "#5fb2c9"], inGame: true },
  cape_forest: { name: tx("Orman pelerini"), desc: tx("Yaprak deseni."), colors: ["#13281a", "#79c08a"], inGame: true },
  cape_sakura: { name: tx("Kiraz pelerini"), desc: tx("Pembe kiraz çiçekleri."), colors: ["#3a1c2c", "#f2a6c4"], inGame: true },
  cape_nether: { name: tx("Nether pelerini"), desc: tx("Lav çatlakları."), colors: ["#2a0b0b", "#ff7a45"], inGame: true },
  cape_end: { name: tx("End pelerini"), desc: tx("End taşı ve yıldızlar."), colors: ["#140d24", "#b28cff"], inGame: true },
  cape_plus: { name: tx("Plus pelerini"), desc: tx("West Plus'a özel: altın Plus işaretli."), colors: ["#100d07", "#f2b654"], inGame: true },

  hat_cap: { name: tx("Kasket"), desc: tx("West logolu spor şapka."), colors: ["#1b1d24", "#e8a25c"], inGame: true },
  hat_catears: { name: tx("Kedi kulakları"), desc: tx("Sevimli kedi kulakları."), colors: ["#22161c", "#f2b8c6"], inGame: true },
  hat_tophat: { name: tx("Silindir şapka"), desc: tx("Kırmızı bantlı klasik silindir."), colors: ["#111111", "#c43c3c"], inGame: true },
  hat_wizard: { name: tx("Büyücü şapkası"), desc: tx("Yıldızlı sivri şapka."), colors: ["#1a1233", "#7b5cff"], inGame: true },
  hat_crown: { name: tx("Taç"), desc: tx("Mücevherli altın taç."), colors: ["#2a1e08", "#ffd25a"], inGame: true },
  hat_halo: { name: tx("Hale"), desc: tx("West Plus'a özel: başının üstünde süzülen ışık halkası."), colors: ["#1a1608", "#fff3b0"], inGame: true },

  back_bag: { name: tx("Sırt çantası"), desc: tx("Maceracı çantası."), colors: ["#2a1d10", "#b07a45"], inGame: true },
  back_wings: { name: tx("Melek kanatları"), desc: tx("Beyaz tüylü, çırpan kanatlar."), colors: ["#1c2230", "#f4f7ff"], inGame: true },
  back_dragon: { name: tx("Ejderha kanatları"), desc: tx("Zarlı, koyu mor ejderha kanatları."), colors: ["#160b20", "#8a4ad6"], inGame: true },
  back_plus_wings: { name: tx("Altın kanatlar"), desc: tx("West Plus'a özel: parıldayan altın kanatlar."), colors: ["#1a1406", "#f2b654"], inGame: true },

  aura_hearts: { name: tx("Kalp aurası"), desc: tx("Etrafında süzülen kalpler."), colors: ["#22101a", "#ff6f9c"], inGame: true },
  aura_notes: { name: tx("Nota aurası"), desc: tx("Etrafında uçuşan notalar."), colors: ["#101a22", "#6ad0ff"], inGame: true },
  aura_flame: { name: tx("Alev aurası"), desc: tx("Ayaklarının dibinde küçük alevler."), colors: ["#1e0c06", "#ff8a3d"], inGame: true },
  aura_stars: { name: tx("Yıldız aurası"), desc: tx("West Plus'a özel: etrafında dönen altın yıldızlar."), colors: ["#14110a", "#ffe7a3"], inGame: true },
};

export const meta = (id: string): ItemMeta => META[id] ?? { name: id, desc: "", colors: ["#1b1d24", "#555"] };

// ───────── Launcher temaları ─────────

type RGBs = string; // "r g b"
export interface ThemePack { bg: RGBs; surface: RGBs; surface2: RGBs; surface3: RGBs; accent: string; accent2?: string; aurora?: boolean }

export const THEME_PACKS: Record<string, ThemePack> = {
  theme_ocean: { bg: "8 14 22", surface: "12 20 30", surface2: "17 27 40", surface3: "24 37 52", accent: "#5fb2c9", accent2: "#3f7fd6" },
  theme_forest: { bg: "9 14 11", surface: "13 20 16", surface2: "18 28 22", surface3: "26 38 30", accent: "#79c08a", accent2: "#c2d36a" },
  theme_rose: { bg: "17 10 14", surface: "23 14 19", surface2: "31 19 26", surface3: "42 26 35", accent: "#e58aa8", accent2: "#c27ae0" },
  theme_mono: { bg: "8 8 8", surface: "14 14 14", surface2: "20 20 20", surface3: "30 30 30", accent: "#d9d9d9", accent2: "#9a9a9a" },
  theme_nether: { bg: "18 7 7", surface: "26 10 10", surface2: "36 14 13", surface3: "50 20 18", accent: "#ff7a45", accent2: "#ffc14d" },
  theme_end: { bg: "12 9 20", surface: "17 13 28", surface2: "24 18 38", surface3: "34 26 52", accent: "#b28cff", accent2: "#e9e2a8" },
  theme_gold: { bg: "12 10 6", surface: "19 16 10", surface2: "27 22 13", surface3: "38 31 18", accent: "#f2b654", accent2: "#ffe7a3" },
  theme_aurora: { bg: "6 12 16", surface: "10 18 24", surface2: "15 25 33", surface3: "22 35 45", accent: "#5fe3b0", accent2: "#7aa8ff", aurora: true },
};

// ───────── Arka plan sahneleri ─────────

export type SkyFx = "meteors" | "snow" | "petals" | "embers" | "void" | "aurora" | null;
export interface SkyScene { sky: [string, string]; sun: string; layers: [string, string, string]; stars: boolean; fx: SkyFx }

export const SKIES: Record<string, SkyScene> = {
  sky_dawn: { sky: ["#3a2a52", "#f2a07b"], sun: "#ffe2b0", layers: ["#a0566a", "#6a3552", "#33203a"], stars: false, fx: null },
  sky_night: { sky: ["#05081a", "#1d2b55"], sun: "#e8ecf5", layers: ["#22305a", "#151f3d", "#0b1226"], stars: true, fx: "meteors" },
  sky_snow: { sky: ["#1b2636", "#8aa7c2"], sun: "#f4f8ff", layers: ["#d8e4ef", "#a9bccd", "#6f8399"], stars: false, fx: "snow" },
  sky_sakura: { sky: ["#2b1830", "#f2a6c4"], sun: "#fff0f5", layers: ["#c7769a", "#8a4a6e", "#4a2640"], stars: false, fx: "petals" },
  sky_nether: { sky: ["#1f0707", "#8a2c1d"], sun: "#ffb35c", layers: ["#6b1f1f", "#441313", "#220909"], stars: false, fx: "embers" },
  sky_end: { sky: ["#0b0716", "#3d2a5c"], sun: "#e9e2a8", layers: ["#4d3d6e", "#2f2547", "#181226"], stars: true, fx: "void" },
  sky_aurora: { sky: ["#030a14", "#0d2a3a"], sun: "#e8fff6", layers: ["#123a44", "#0b2630", "#06151c"], stars: true, fx: "aurora" },
};

// ───────── İmleç izleri ─────────

export type TrailStyle = "stars" | "snow" | "fire" | "hearts" | "rainbow";
export const TRAILS: Record<string, TrailStyle> = {
  trail_stars: "stars", trail_snow: "snow", trail_fire: "fire", trail_hearts: "hearts", trail_rainbow: "rainbow",
};
