import { getLang, tx } from "@/lib/i18n";
export const formatDuration = (secs: number) => {
  if (secs < 60) return tx("{0} sn", secs);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? tx("{0} sa {1} dk", h, m) : tx("{0} dk", m);
};

export const formatRelative = (iso: string | null) => {
  if (!iso) return tx("Hiç oynanmadı");
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return tx("Az önce");
  // Tarayıcının kendi dil kuralları: "dün", "yesterday", "gestern"; tekil/çoğul doğru
  const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[3600, "minute"], [86400, "hour"], [86400 * 7, "day"], [86400 * 30, "week"], [86400 * 365, "month"]];
  const size: Record<string, number> = { minute: 60, hour: 3600, day: 86400, week: 86400 * 7, month: 86400 * 30, year: 86400 * 365 };
  const unit = steps.find(([lim]) => diff < lim)?.[1] ?? "year";
  return rtf.format(-Math.floor(diff / size[unit]), unit);
};

/**
 * Kullanıcıya gösterilecek hata metni. Launcher'ın kendi mesajları zaten okunur Türkçe/çeviridir ve olduğu gibi
 * geçer; JavaScript iç hataları ("TypeError: …") ve ham ağ hataları anlaşılır bir cümleye çevrilir.
 */
export const errorText = (e: unknown): string => {
  const s = (e instanceof Error ? e.message : String(e ?? "")).replace(/^Error:\s*/, "").trim();
  if (!s || /^(TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot read propert|is not a function|is not defined|\[object /.test(s))
    return tx("Beklenmeyen bir sorun oldu. Tekrar dene; sürerse launcher'ı yeniden başlat.");
  if (/Failed to fetch|NetworkError|error sending request|connection (refused|reset|closed)|timed out|dns error/i.test(s))
    return tx("Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.");
  return s;
};

export const LOADER_LABEL: Record<string, string> = {
  vanilla: tx("Vanilla"),
  fabric: tx("Fabric"),
  quilt: tx("Quilt"),
  forge: tx("Forge"),
  neoforge: tx("NeoForge"),
};

export const STAGE_LABEL: Record<string, string> = {
  manifest: tx("Sürüm bilgisi alınıyor"),
  loader: tx("Mod yükleyici kuruluyor"),
  files: tx("Dosyalar indiriliyor"),
  java: tx("Java hazırlanıyor"),
  update: tx("İçerik güncelleniyor"),
  done: tx("Hazır"),
};

export const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(".0", "")} ${tx("B")}` : String(n);
