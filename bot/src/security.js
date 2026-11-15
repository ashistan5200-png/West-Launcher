// Güvenlik: spam, zararlı bağlantı, raid, yetki kötüye kullanımı (nuke) ve sunucu kilidi.
import { AuditLogEvent, ChannelType, GuildVerificationLevel, PermissionFlagsBits } from "discord.js";
import { CONFIG } from "./config.js";
import { analyzeLinks, humanDuration, NukeGuard, RaidDetector, SpamTracker } from "./detectors.js";
import { ago, botDeleted, canAct, COLORS, forgetDeleted, modLog, userLine } from "./lib.js";

const spam = new SpamTracker(CONFIG.spam);
export const raid = new RaidDetector(CONFIG.raid);
const nuke = new NukeGuard(CONFIG.nuke);
/** Sunucunun kendi davet kodları (bunlar silinmez) */
const ownInvites = new Set();
setInterval(() => spam.sweep(), 60_000).unref();

const isStaff = (member) =>
  !!member && (member.permissions.has(PermissionFlagsBits.ManageMessages) || member.permissions.has(PermissionFlagsBits.Administrator));

export async function refreshInvites(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (invites) {
    ownInvites.clear();
    for (const code of invites.keys()) ownInvites.add(code);
  }
  if (guild.vanityURLCode) ownInvites.add(guild.vanityURLCode);
}

// ───────── Mesajlar ─────────

/** Her mesajda çalışır. Mesaj silindiyse `true` döner (diğer modüller atlasın). */
export async function onMessage(msg) {
  if (!msg.guild || msg.author.bot || !msg.member || isStaff(msg.member)) return false;

  const link = analyzeLinks(msg.content, ownInvites);
  if (link) {
    botDeleted.add(msg.id);
    forgetDeleted(msg.id);
    await msg.delete().catch(() => {});
    if (link.kind === "phishing") {
      // Dolandırıcı bağlantı çoğunlukla ele geçirilmiş hesaptan gelir → uzun susturma
      if (canAct(msg.member)) await msg.member.timeout(24 * 3600_000, `Zararlı bağlantı: ${link.detail}`).catch(() => {});
      await msg.channel.send({ content: `🛡️ ${msg.author}, gönderdiğin bağlantı zararlı göründüğü için silindi. Hesabın ele geçirilmiş olabilir; şifreni değiştir.`, allowedMentions: { users: [msg.author.id] } }).then(autoDelete).catch(() => {});
      await modLog(msg.guild, {
        title: "🎣 Zararlı bağlantı silindi", color: COLORS.danger, ping: true,
        fields: [["Kullanıcı", userLine(msg.author)], ["Kanal", `${msg.channel}`, true], ["Neden", link.detail, true], ["Mesaj", msg.content]],
        footer: "Kullanıcı 24 saat susturuldu",
      });
    } else {
      await msg.channel.send({ content: `${msg.author}, başka sunucu davetleri burada paylaşılamaz.`, allowedMentions: { users: [msg.author.id] } }).then(autoDelete).catch(() => {});
      await modLog(msg.guild, { title: "✉️ Davet bağlantısı silindi", color: COLORS.warn, fields: [["Kullanıcı", userLine(msg.author)], ["Kanal", `${msg.channel}`, true], ["Davet", link.detail, true]] });
    }
    return true;
  }

  const mentions = msg.mentions.users.size + msg.mentions.roles.size + (msg.mentions.everyone ? 5 : 0);
  const reason = spam.check(msg.author.id, msg.content, mentions);
  if (reason) {
    spam.reset(msg.author.id);
    const label = { burst: "Çok hızlı mesaj", duplicate: "Aynı mesajı tekrar tekrar atma", mentions: "Toplu etiketleme" }[reason];
    // Son 1 dakikadaki spam mesajlarını kanaldan topla
    const recent = await msg.channel.messages.fetch({ limit: 30 }).catch(() => null);
    const mine = recent?.filter((m) => m.author.id === msg.author.id && Date.now() - m.createdTimestamp < 60_000);
    if (mine?.size) await msg.channel.bulkDelete(mine, true).catch(() => {});
    if (canAct(msg.member)) await msg.member.timeout(CONFIG.spam.timeoutMs, `Spam: ${label}`).catch(() => {});
    await msg.channel.send({ content: `🛡️ ${msg.author} ${humanDuration(CONFIG.spam.timeoutMs)} susturuldu: ${label.toLowerCase()}.`, allowedMentions: { users: [] } }).then(autoDelete).catch(() => {});
    await modLog(msg.guild, {
      title: "🚫 Spam engellendi", color: COLORS.warn,
      fields: [["Kullanıcı", userLine(msg.author)], ["Kanal", `${msg.channel}`, true], ["Neden", label, true], ["Örnek mesaj", msg.content || "(boş)"]],
    });
    return true;
  }
  return false;
}

const autoDelete = (m) => setTimeout(() => m.delete().catch(() => {}), 12_000);

// ───────── Girişler ─────────

export async function onJoin(member) {
  const guild = member.guild;
  const ageDays = (Date.now() - member.user.createdTimestamp) / 864e5;

  if (raid.join()) await startRaidMode(guild, "otomatik: kısa sürede çok fazla giriş");

  if (raid.active() && ageDays < CONFIG.raid.minAccountAgeDays && member.kickable) {
    await member.send(`**${guild.name}** şu an saldırıya karşı korumada. Biraz sonra tekrar katılabilirsin.`).catch(() => {});
    await member.kick("Raid modu: yeni hesap").catch(() => {});
    await modLog(guild, { title: "🧱 Raid modu: giriş engellendi", color: COLORS.danger, fields: [["Kullanıcı", userLine(member.user)], ["Hesap", ago(member.user.createdAt), true]] });
    return false;
  }

  if (ageDays < CONFIG.newAccountDays) {
    await modLog(guild, {
      title: "🆕 Yeni hesap katıldı", color: COLORS.warn,
      fields: [["Kullanıcı", userLine(member.user)], ["Hesap açılışı", ago(member.user.createdAt), true]],
      footer: "Çok yeni hesaplar çoğu zaman spam ya da yan hesaptır; göz kulak ol.",
    });
  }
  return true;
}

// ───────── Raid modu ─────────

let raidSeq = 0;

export async function startRaidMode(guild, why) {
  raid.start();
  const seq = ++raidSeq;
  const until = new Date(Date.now() + CONFIG.raid.durationMs);
  await guild.setVerificationLevel(GuildVerificationLevel.VeryHigh, "Raid modu").catch(() => {});
  // Davetleri geçici olarak durdur (Discord'un güvenlik işlemleri)
  await guild.client.rest
    .put(`/guilds/${guild.id}/incident-actions`, { body: { invites_disabled_until: until.toISOString() } })
    .catch((e) => console.warn("Davetler durdurulamadı:", e.message));
  await modLog(guild, {
    title: "🚨 RAID MODU AÇILDI", color: COLORS.danger, ping: true,
    description: `Neden: ${why}\n\n• Doğrulama seviyesi en yükseğe çıkarıldı\n• Davetler ${humanDuration(CONFIG.raid.durationMs)} kapalı\n• ${CONFIG.raid.minAccountAgeDays} günden yeni hesaplar alınmıyor\n\nBitirmek için: \`/guvenlik raid-bitir\``,
  });
  // Bu raid hâlâ sürüyorsa (elle bitirilmedi, yeniden başlatılmadı) süre dolunca kapat
  setTimeout(() => { if (seq === raidSeq && raid.until && !raid.active()) void endRaidMode(guild, "süre doldu"); }, CONFIG.raid.durationMs + 1000).unref();
}

export async function endRaidMode(guild, why) {
  raidSeq++;
  raid.stop();
  await guild.setVerificationLevel(GuildVerificationLevel.Medium, "Raid modu bitti").catch(() => {});
  await guild.client.rest.put(`/guilds/${guild.id}/incident-actions`, { body: { invites_disabled_until: null } }).catch(() => {});
  await modLog(guild, { title: "✅ Raid modu kapandı", color: COLORS.ok, description: `Neden: ${why}` });
}

// ───────── Sunucu kilidi ─────────

/** Kilitlenen kanallar: önceki durumu bozmamak için yalnızca bizim kapattıklarımız açılır. */
const locked = new Set();

export async function lockdown(guild, on, by) {
  const everyone = guild.roles.everyone;
  let count = 0;
  for (const ch of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildForum, ChannelType.GuildAnnouncement].includes(ch.type)) continue;
    const ow = ch.permissionOverwrites.cache.get(everyone.id);
    const alreadyDenied = ow?.deny.has(PermissionFlagsBits.SendMessages);
    const hidden = ow?.deny.has(PermissionFlagsBits.ViewChannel);
    if (on && !alreadyDenied && !hidden) {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: false, SendMessagesInThreads: false, CreatePublicThreads: false }, { reason: `Kilit: ${by}` }).catch(() => {});
      locked.add(ch.id);
      count++;
    } else if (!on && locked.has(ch.id)) {
      await ch.permissionOverwrites.edit(everyone, { SendMessages: null, SendMessagesInThreads: null, CreatePublicThreads: null }, { reason: `Kilit kaldırıldı: ${by}` }).catch(() => {});
      locked.delete(ch.id);
      count++;
    }
  }
  await modLog(guild, { title: on ? "🔒 Sunucu kilitlendi" : "🔓 Sunucu kilidi açıldı", color: on ? COLORS.danger : COLORS.ok, ping: on, fields: [["Yapan", by, true], ["Kanal", String(count), true]] });
  return count;
}

// ───────── Yetki kötüye kullanımı (anti-nuke) ─────────

const KIND = {
  [AuditLogEvent.ChannelDelete]: "channelDelete",
  [AuditLogEvent.RoleDelete]: "roleDelete",
  [AuditLogEvent.MemberBanAdd]: "ban",
  [AuditLogEvent.MemberKick]: "kick",
  [AuditLogEvent.WebhookCreate]: "webhookCreate",
};

export async function onAuditLog(entry, guild) {
  const kind = KIND[entry.action];
  const executorId = entry.executorId;
  // Sunucu sahibi ve botun kendisi muaf
  if (!kind || !executorId || executorId === guild.ownerId || executorId === guild.client.user.id) return;
  if (!nuke.record(executorId, kind)) return;
  nuke.forget(executorId);

  const member = await guild.members.fetch(executorId).catch(() => null);
  let action = "Bot bu kişiye işlem yapamadı (rolü botunkinden yüksek). Elle müdahale et!";
  if (member?.manageable) {
    const removable = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed);
    await member.roles.remove(removable, "Anti-nuke: toplu yıkıcı işlem").catch(() => {});
    if (member.moderatable) await member.timeout(24 * 3600_000, "Anti-nuke").catch(() => {});
    action = `Tüm rolleri alındı (${removable.size}) ve 24 saat susturuldu.`;
  } else if (member?.user.bot && member.kickable) {
    await member.kick("Anti-nuke: bot toplu yıkıcı işlem yaptı").catch(() => {});
    action = "Bot sunucudan atıldı.";
  }
  await modLog(guild, {
    title: "☢️ YETKİ KÖTÜYE KULLANIMI ENGELLENDİ", color: COLORS.danger, ping: true,
    fields: [["Yapan", member ? userLine(member.user) : `\`${executorId}\``], ["İşlem", `${kind} · ${CONFIG.nuke.windowMs / 1000} sn içinde sınır aşıldı`], ["Önlem", action]],
  });
}

