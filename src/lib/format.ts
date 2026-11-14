export const formatDuration = (secs: number) => {
  if (secs < 60) return `${secs} sn`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m} dk`;
};

export const formatRelative = (iso: string | null) => {
  if (!iso) return "Hiç oynanmadı";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "Az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  const d = Math.floor(diff / 86400);
  if (d < 7) return `${d} gün önce`;
  if (d < 30) return `${Math.floor(d / 7)} hafta önce`;
  if (d < 365) return `${Math.floor(d / 30)} ay önce`;
  return `${Math.floor(d / 365)} yıl önce`;
};

export const LOADER_LABEL: Record<string, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  quilt: "Quilt",
  forge: "Forge",
  neoforge: "NeoForge",
};

export const STAGE_LABEL: Record<string, string> = {
  manifest: "Sürüm bilgisi alınıyor",
  loader: "Mod yükleyici kuruluyor",
  files: "Dosyalar indiriliyor",
  java: "Java hazırlanıyor",
  done: "Hazır",
};

export const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".0", "")} M` : n >= 1_000 ? `${(n / 1_000).toFixed(1).replace(".0", "")} B` : String(n);
