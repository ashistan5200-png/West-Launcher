import { tx } from "@/lib/i18n";
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
  if (diff < 3600) return tx("{0} dk önce", Math.floor(diff / 60));
  if (diff < 86400) return tx("{0} sa önce", Math.floor(diff / 3600));
  const d = Math.floor(diff / 86400);
  if (d < 7) return tx("{0} gün önce", d);
  if (d < 30) return tx("{0} hafta önce", Math.floor(d / 7));
  if (d < 365) return tx("{0} ay önce", Math.floor(d / 30));
  return tx("{0} yıl önce", Math.floor(d / 365));
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
  depot: tx("Depo'dan indiriliyor"),
  done: tx("Hazır"),
};

export const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(".0", "")} ${tx("B")}` : String(n);
