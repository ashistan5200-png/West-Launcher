// Güncellemeler: GitHub'da yeni West Client sürümü çıkınca duyurur; istatistik kanallarını günceller.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { CONFIG } from "./config.js";
import { channelByName, COLORS, modLog, roleByName } from "./lib.js";

const DL = (file) => `https://github.com/${CONFIG.github.repo}/releases/latest/download/${file}`;

/** Commit dipnotlarını ve boş satırları ayıklayıp sürüm notunu Discord'a uygun hale getirir. */
export function releaseNotes(body, max = 3500) {
  const lines = String(body ?? "")
    .split("\n")
    .filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l.trim()))
    .map((l) => l.replace(/^\s*[-*]\s+/, "• ").trimEnd());
  // Arka arkaya boş satırları teke indir
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "Ayrıntılar için sürüm notlarına bak.";
}

/** Sürüm etiketini başlığa ve gövdeye ayırır ("0.2.8: tek tıkla..." → başlık "tek tıkla..."). */
export function releaseTitle(rel) {
  const name = (rel.name || rel.tag_name || "").replace(/^v?\d+\.\d+\.\d+\s*[:\-–]\s*/, "");
  return name && !/^v?\d+\.\d+\.\d+$/.test(name) ? name : "Yeni sürüm";
}

export function releaseMessage(rel, pingRole) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setAuthor({ name: "West Client" })
    .setTitle(`${rel.tag_name} yayında · ${releaseTitle(rel)}`)
    .setURL(rel.html_url)
    .setDescription(releaseNotes(rel.body))
    .setFooter({ text: "Açık olan West Client güncellemeyi kendisi bulur." })
    .setTimestamp(new Date(rel.published_at ?? Date.now()));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Windows").setEmoji("🪟").setURL(DL("West-Client-Setup.exe")),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("macOS").setEmoji("🍎").setURL(DL("West-Client-macOS.dmg")),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Linux").setEmoji("🐧").setURL(DL("West-Client-Linux.AppImage")),
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Site").setEmoji("🌐").setURL(CONFIG.site),
  );
  return {
    content: pingRole ? `${pingRole} yeni bir güncelleme var! 🎉` : undefined,
    embeds: [embed],
    components: [row],
    allowedMentions: { roles: pingRole ? [pingRole.id] : [] },
  };
}

async function latestRelease() {
  const res = await fetch(`https://api.github.com/repos/${CONFIG.github.repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "west-bot" },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/** Son sürümü getirir (komutlar için kısa önbellekli). */
let cache = { at: 0, rel: null };
export async function getLatest() {
  if (Date.now() - cache.at < 60_000 && cache.rel) return cache.rel;
  cache = { at: Date.now(), rel: await latestRelease() };
  return cache.rel;
}

/** Yeni sürüm var mı diye bakar; varsa #güncellemeler'e duyurur ve yayınlar (takip eden sunuculara da gider). */
export async function checkRelease(guild, store) {
  let rel;
  try {
    rel = await getLatest();
  } catch (e) {
    return console.warn("Sürüm kontrolü başarısız:", e.message);
  }
  const last = store.get("lastRelease");
  if (!last) {
    // İlk çalıştırma: mevcut sürümü duyurmadan işaretle (eski sürümü yeniden duyurmamak için)
    store.set("lastRelease", rel.tag_name);
    return;
  }
  if (last === rel.tag_name || rel.draft || rel.prerelease) return;
  await announceRelease(guild, rel);
  store.set("lastRelease", rel.tag_name);
}

export async function announceRelease(guild, rel) {
  const ch = channelByName(guild, CONFIG.channels.updates);
  if (!ch?.isTextBased()) return console.warn("#güncellemeler bulunamadı");
  const msg = await ch.send(releaseMessage(rel, roleByName(guild, CONFIG.roles.updatePing)));
  if (ch.type === ChannelType.GuildAnnouncement) await msg.crosspost().catch(() => {});
  await modLog(guild, { title: "📢 Sürüm duyuruldu", color: COLORS.ok, fields: [["Sürüm", rel.tag_name, true], ["Mesaj", msg.url, true]] });
}

// ───────── İstatistik kanalları ─────────

async function westAccounts() {
  const { url, key } = CONFIG.supabase;
  const res = await fetch(`${url}/rest/v1/profiles?select=id`, { headers: { apikey: key, Prefer: "count=exact", Range: "0-0" } });
  const total = res.headers.get("content-range")?.split("/")[1];
  return total && total !== "*" ? Number(total) : null;
}

/** Kilitli ses kanallarını ad olarak sayaç gibi kullanır. Discord kanal adını 10 dakikada en fazla 2 kez değiştirmeye izin verir. */
export async function updateStats(guild) {
  let cat = channelByName(guild, CONFIG.channels.statsCategory);
  if (!cat) {
    cat = await guild.channels.create({
      name: CONFIG.channels.statsCategory, type: ChannelType.GuildCategory, position: 0,
      permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }],
    }).catch(() => null);
    if (!cat) return;
  }
  const rel = await getLatest().catch(() => null);
  const accounts = await westAccounts().catch(() => null);
  const wanted = [
    ["members", `👥 Üye: ${guild.memberCount}`],
    ["release", rel ? `⬇️ Sürüm: ${rel.tag_name}` : null],
    ["accounts", accounts !== null ? `🌐 West hesabı: ${accounts}` : null],
  ];
  const existing = guild.channels.cache.filter((c) => c.parentId === cat.id).sort((a, b) => a.rawPosition - b.rawPosition);
  for (const [i, [key, name]] of wanted.entries()) {
    if (!name) continue;
    const prefix = name.split(":")[0];
    const ch = existing.find((c) => c.name.startsWith(prefix));
    if (!ch) {
      await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: cat.id, position: i, permissionOverwrites: cat.permissionOverwrites.cache }).catch((e) => console.warn(`İstatistik kanalı (${key}):`, e.message));
    } else if (ch.name !== name) {
      await ch.setName(name).catch(() => {});
    }
  }
}
