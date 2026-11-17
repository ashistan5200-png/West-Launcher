/**
 * West Client çevirileri.
 *
 * Kaynak metin Türkçedir ve anahtar olarak kullanılır: tx("Ayarlar") → "Settings" / "Einstellungen".
 * Değişkenli metinler: tx("{0} mod kuruldu", n). Çevirisi olmayan metin Türkçe kalır.
 *
 * Dil modül yüklenirken localStorage'dan okunur; böylece modül düzeyindeki sabitler de doğru dilde
 * kurulur. Dil değişince sayfa yeniden yüklenir.
 */
import en from "@/i18n/en.json";
import de from "@/i18n/de.json";

export type Lang = "tr" | "en" | "de";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "tr", label: "Türkçe" },
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

const DICTS: Record<Lang, Record<string, string> | null> = { tr: null, en, de };
const KEY = "west.lang";

function stored(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "tr" || v === "en" || v === "de") return v;
  } catch { /* depolama yok */ }
  return detectLang();
}

let current: Lang = stored();
document.documentElement.lang = current;

export function detectLang(): Lang {
  const l = (navigator.language || "tr").toLowerCase();
  if (l.startsWith("tr")) return "tr";
  if (l.startsWith("de")) return "de";
  return "en";
}

export function getLang(): Lang {
  return current;
}

export function setLang(l: Lang) {
  current = l;
  try { localStorage.setItem(KEY, l); } catch { /* yok say */ }
  document.documentElement.lang = l;
}

/** Tarih/sayı biçimleri için yerel ayar */
export function locale(): string {
  return current === "tr" ? "tr-TR" : current === "de" ? "de-DE" : "en-US";
}

export function tx(s: string, ...args: unknown[]): string {
  const d = DICTS[current];
  let out = (d && d[s]) || s;
  if (args.length) out = out.replace(/\{(\d+)\}/g, (m, i) => (Number(i) < args.length ? String(args[Number(i)]) : m));
  return out;
}
