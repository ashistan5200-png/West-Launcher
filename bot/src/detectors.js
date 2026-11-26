// Güvenlik algılayıcıları. Discord'a bağımlı değildir; saat dışarıdan verilir,
// böylece hepsi birim testleriyle doğrulanır.

/** Mesaj spam'i: kısa sürede çok mesaj, aynı metni tekrar tekrar atma, toplu etiket. */
export class SpamTracker {
  constructor(cfg) {
    this.cfg = cfg;
    this.users = new Map(); // userId → { times: number[], texts: {t, at}[] }
  }

  /** @returns {null | "burst" | "duplicate" | "mentions"} */
  check(userId, text, mentionCount, now = Date.now()) {
    const c = this.cfg;
    if (mentionCount >= c.mentions) return "mentions";
    const u = this.users.get(userId) ?? { times: [], texts: [] };
    this.users.set(userId, u);
    u.times = u.times.filter((t) => now - t < c.burstWindowMs);
    u.times.push(now);
    const norm = normalize(text);
    u.texts = u.texts.filter((x) => now - x.at < c.duplicateWindowMs);
    if (norm.length >= 4) u.texts.push({ t: norm, at: now });
    if (u.times.length >= c.burst) return "burst";
    if (norm.length >= 4 && u.texts.filter((x) => x.t === norm).length >= c.duplicates) return "duplicate";
    return null;
  }

  /** Cezalandırılan kullanıcının sayaçlarını sıfırla (aynı olay için iki kez ceza vermemek için). */
  reset(userId) {
    this.users.delete(userId);
  }

  /** Bellek temizliği: uzun süredir yazmayanları unut. */
  sweep(now = Date.now()) {
    const keep = Math.max(this.cfg.burstWindowMs, this.cfg.duplicateWindowMs);
    for (const [id, u] of this.users) if (!u.times.some((t) => now - t < keep)) this.users.delete(id);
  }
}

const normalize = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Raid: kısa sürede çok sayıda giriş. */
export class RaidDetector {
  constructor(cfg) {
    this.cfg = cfg;
    this.joins = [];
    this.until = 0;
  }

  /** Bir giriş kaydeder. Raid yeni başladıysa `true` döner. */
  join(now = Date.now()) {
    this.joins = this.joins.filter((t) => now - t < this.cfg.windowMs);
    this.joins.push(now);
    if (!this.active(now) && this.joins.length >= this.cfg.joins) {
      this.until = now + this.cfg.durationMs;
      return true;
    }
    return false;
  }

  active(now = Date.now()) {
    return now < this.until;
  }

  start(now = Date.now()) {
    this.until = now + this.cfg.durationMs;
  }

  stop() {
    this.until = 0;
    this.joins = [];
  }
}

/** Yetki kötüye kullanımı (nuke): bir kişinin kısa sürede toplu silme/yasaklama yapması. */
export class NukeGuard {
  constructor(cfg) {
    this.cfg = cfg;
    this.events = new Map(); // `${executor}:${kind}` → number[]
  }

  /** Olayı kaydeder; sınır aşıldıysa `true`. */
  record(executorId, kind, now = Date.now()) {
    const limit = this.cfg.limits[kind];
    if (!limit) return false;
    const key = `${executorId}:${kind}`;
    const list = (this.events.get(key) ?? []).filter((t) => now - t < this.cfg.windowMs);
    list.push(now);
    this.events.set(key, list);
    return list.length >= limit;
  }

  forget(executorId) {
    for (const k of this.events.keys()) if (k.startsWith(`${executorId}:`)) this.events.delete(k);
  }
}

// ───────── Bağlantılar ─────────

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.gg|dsc\.gg|discord\.me)\/([\w-]{2,})/gi;
const URL_RE = /https?:\/\/([^\s/<>"')]+)/gi;

/** Gerçek alan adları; bunların alt alan adları da güvenlidir. */
const TRUSTED = [
  "discord.com", "discord.gg", "discordapp.com", "discordapp.net", "discord.media", "discordstatus.com",
  "steampowered.com", "steamcommunity.com", "steamstatic.com",
  "minecraft.net", "mojang.com", "xbox.com", "microsoft.com", "live.com",
  "modrinth.com", "curseforge.com", "github.com", "githubusercontent.com", "westclient.app",
  "epicgames.com", "youtube.com", "youtu.be", "twitch.tv", "imgur.com", "tenor.com", "giphy.com",
];
/** Dolandırıcıların taklit ettiği markalar */
// Minecraft bilerek yok: planetminecraft.com, minecraftskins.com gibi gerçek siteler çok
const BRANDS = ["discord", "steam", "nitro", "epicgames"];
const BAIT = /(free|bedava|ücretsiz|ucretsiz|hediye|gift|giveaway|çekiliş|cekilis)\W+(nitro|steam|skin|robux)|nitro\W+(free|bedava|hediye|gift)|@everyone.*https?:\/\//i;

const trusted = (host) => TRUSTED.some((d) => host === d || host.endsWith(`.${d}`));

/** Rakamları harfe çevirerek "d1sc0rd" gibi taklitleri yakalar. */
const deLeet = (s) => s.replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/-/g, "");

/**
 * Mesajdaki bağlantıları inceler.
 * @param {string} text
 * @param {Set<string>} ownInvites Bu sunucunun kendi davet kodları (silinmez)
 * @returns {{ kind: "phishing" | "invite", detail: string } | null}
 */
export function analyzeLinks(text, ownInvites = new Set()) {
  const hosts = [...text.matchAll(URL_RE)].map((m) => m[1].toLowerCase().replace(/^www\./, "").replace(/:\d+$/, ""));
  for (const host of hosts) {
    if (trusted(host)) continue;
    const flat = deLeet(host);
    // "dlscord" gibi l ↔ i taklitleri için ikinci bir biçim
    const alt = flat.replace(/l/g, "i");
    const brand = BRANDS.find((b) => flat.includes(b) || alt.includes(b));
    if (brand) return { kind: "phishing", detail: `${host} (${brand} taklidi)` };
  }
  if (hosts.length && BAIT.test(text)) return { kind: "phishing", detail: `yem mesajı: ${hosts[0]}` };
  for (const m of text.matchAll(INVITE_RE)) {
    if (!ownInvites.has(m[1])) return { kind: "invite", detail: m[0] };
  }
  return null;
}

// ───────── Uyarı cezaları ─────────

/** Son pencere içindeki uyarı sayısına göre uygulanacak cezayı seçer. */
export function escalation(warns, steps, windowMs, now = Date.now()) {
  const recent = warns.filter((w) => now - w.at < windowMs).length;
  // Yalnızca tam eşik anında ceza ver; arada kalan uyarılar ek ceza getirmez
  return steps.find((s) => recent === s.at) ?? null;
}

/** "10dk", "2s", "1g", "1hf" → milisaniye. dk/m: dakika, s/sa/h: saat, g/d: gün, hf/w: hafta. Birimsiz sayı dakikadır. */
export function parseDuration(s) {
  const m = /^\s*(\d+)\s*(dk|m|sn|s|sa|h|g|d|hf|w)?\s*$/i.exec(s ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? "dk").toLowerCase();
  const mul = { sn: 1e3, dk: 6e4, m: 6e4, s: 36e5, sa: 36e5, h: 36e5, g: 864e5, d: 864e5, hf: 6048e5, w: 6048e5 }[unit];
  const ms = n * mul;
  return ms > 0 && ms <= 28 * 864e5 ? ms : null; // Discord zaman aşımı en fazla 28 gün
}

export function humanDuration(ms) {
  if (ms >= 864e5) return `${Math.round(ms / 864e5)} gün`;
  if (ms >= 36e5) return `${Math.round(ms / 36e5)} saat`;
  return `${Math.max(1, Math.round(ms / 6e4))} dakika`;
}
