// Botun bütün ayarları tek yerde. Kanallar ve roller ADIYLA bulunur; adlar
// tools/discord-sunucu/kur.mjs'in kurduğu sunucuyla aynıdır.

export const CONFIG = {
  token: process.env.DISCORD_BOT_TOKEN?.trim(),
  guildId: process.env.GUILD_ID?.trim() || null,
  dataDir: process.env.DATA_DIR || "./data",

  channels: {
    modLog: "mod-kayıt",
    updates: "güncellemeler",
    general: "genel",
    rules: "kurallar",
    help: "yardım",
    bugs: "hata-bildir",
    ideas: "öneriler",
    statsCategory: "📊 İSTATİSTİK",
  },
  roles: {
    founder: "👑 Kurucu",
    mod: "🛡️ Moderatör",
    member: "🎮 Oyuncu",
    updatePing: "🔔 Güncelleme Bildirimi",
    eventPing: "🎉 Etkinlik Bildirimi",
  },

  // ───────── Güvenlik ─────────
  spam: {
    /** Bu kadar mesaj bu süre içinde → spam */
    burst: 6, burstWindowMs: 6_000,
    /** Aynı metin bu kadar kez (kanallar arası) → spam */
    duplicates: 3, duplicateWindowMs: 30_000,
    /** Tek mesajda bu kadar kişi/rol etiketi → spam */
    mentions: 5,
    timeoutMs: 10 * 60_000,
  },
  raid: {
    /** Bu süre içinde bu kadar giriş → raid */
    joins: 8, windowMs: 30_000,
    /** Raid modunun süresi (davetler bu süre kapalı kalır) */
    durationMs: 15 * 60_000,
    /** Raid modunda bundan genç hesaplar sunucuya alınmaz */
    minAccountAgeDays: 7,
  },
  /** Bundan genç hesaplar girişte mod-kayıt'ta işaretlenir */
  newAccountDays: 3,
  nuke: {
    windowMs: 60_000,
    /** Bir yetkili bu süre içinde şu kadarını yaparsa yetkileri alınır */
    limits: { channelDelete: 3, roleDelete: 3, ban: 5, kick: 5, webhookCreate: 3 },
  },
  /** Uyarı sayısına (son 30 gün) göre otomatik ceza */
  warnEscalation: [
    { at: 7, action: "kick" },
    { at: 5, action: "timeout", ms: 24 * 3600_000 },
    { at: 3, action: "timeout", ms: 3600_000 },
  ],
  warnWindowMs: 30 * 24 * 3600_000,

  // ───────── Güncellemeler ─────────
  github: { repo: "ashistan5200-png/West-Launcher", pollMs: 5 * 60_000 },
  site: "https://westclient.app",
  supabase: {
    url: "https://sicijptcjixnwgnrsibs.supabase.co",
    // Herkese açık (publishable) anahtar; yalnızca RLS'nin izin verdiği sayımlar için
    key: "sb_publishable_hyHTh2_d7s7YfOyb_nJN3A_E_jDIwTe",
  },
  statsEveryMs: 10 * 60_000,
};
