// Sunucu kaydı: silinen/düzenlenen mesajlar, giriş-çıkış, rol ve takma ad değişiklikleri, yasaklar.
import { AuditLogEvent } from "discord.js";
import { CONFIG } from "./config.js";
import { ago, botDeleted, COLORS, modLog, userLine } from "./lib.js";

const ignored = (ch) => !ch || ch.name === CONFIG.channels.modLog;

export async function onMessageDelete(msg) {
  if (!msg.guild || msg.author?.bot || ignored(msg.channel) || botDeleted.has(msg.id)) return;
  // Önbellekte olmayan eski mesajların içeriği bilinmez
  if (msg.partial && !msg.content) return;
  const files = [...(msg.attachments?.values() ?? [])].map((a) => a.name).join(", ");
  await modLog(msg.guild, {
    title: "🗑️ Mesaj silindi", color: COLORS.info,
    fields: [["Yazan", msg.author ? userLine(msg.author) : "bilinmiyor"], ["Kanal", `${msg.channel}`, true], ["İçerik", msg.content || "(metin yok)"], ...(files ? [["Ekler", files]] : [])],
  });
}

export async function onMessageBulkDelete(messages, channel) {
  if (ignored(channel)) return;
  await modLog(channel.guild, { title: "🧹 Toplu silme", color: COLORS.info, fields: [["Kanal", `${channel}`, true], ["Mesaj", String(messages.size), true]] });
}

export async function onMessageUpdate(before, after) {
  if (!after.guild || after.author?.bot || ignored(after.channel)) return;
  if (before.partial || before.content === after.content) return; // yalnızca gömülü önizleme değişti
  await modLog(after.guild, {
    title: "✏️ Mesaj düzenlendi", color: COLORS.info,
    description: `[Mesaja git](${after.url})`,
    fields: [["Yazan", userLine(after.author)], ["Kanal", `${after.channel}`, true], ["Önce", before.content || "(boş)"], ["Sonra", after.content || "(boş)"]],
  });
}

export async function onJoinLog(member) {
  await modLog(member.guild, {
    title: "📥 Katıldı", color: COLORS.ok,
    fields: [["Kullanıcı", userLine(member.user)], ["Hesap açılışı", ago(member.user.createdAt), true], ["Üye sayısı", String(member.guild.memberCount), true]],
  });
}

export async function onLeave(member) {
  const roles = member.roles?.cache.filter((r) => r.id !== member.guild.id).map((r) => r.name).join(", ");
  // Atıldı mı? Son birkaç saniyedeki denetim kaydına bak
  const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 3 }).catch(() => null);
  const kick = logs?.entries.find((e) => e.targetId === member.id && Date.now() - e.createdTimestamp < 10_000);
  await modLog(member.guild, {
    title: kick ? "👢 Atıldı" : "📤 Ayrıldı", color: kick ? COLORS.warn : COLORS.info,
    fields: [
      ["Kullanıcı", userLine(member.user)],
      ["Katılmıştı", member.joinedAt ? ago(member.joinedAt) : "bilinmiyor", true],
      ...(kick ? [["Atan", `${kick.executor ?? kick.executorId}`, true], ["Neden", kick.reason ?? "belirtilmedi"]] : []),
      ...(roles ? [["Rolleri", roles]] : []),
    ],
  });
}

export async function onMemberUpdate(before, after) {
  if (before.partial) return;
  const added = after.roles.cache.filter((r) => !before.roles.cache.has(r.id));
  const removed = before.roles.cache.filter((r) => !after.roles.cache.has(r.id));
  const fields = [["Kullanıcı", userLine(after.user)]];
  if (added.size) fields.push(["Eklenen rol", added.map((r) => r.name).join(", "), true]);
  if (removed.size) fields.push(["Alınan rol", removed.map((r) => r.name).join(", "), true]);
  if (before.nickname !== after.nickname) fields.push(["Takma ad", `${before.nickname ?? "—"} → ${after.nickname ?? "—"}`]);
  const timedOut = !before.communicationDisabledUntil && after.communicationDisabledUntil;
  if (fields.length === 1 && !timedOut) return;
  // Otomatik Oyuncu rolü her girişte kayıt kirletmesin
  if (fields.length === 2 && added.size === 1 && added.first().name === CONFIG.roles.member && !removed.size) return;
  if (timedOut) fields.push(["Susturuldu", `<t:${Math.floor(after.communicationDisabledUntilTimestamp / 1000)}:R> bitecek`]);
  await modLog(after.guild, { title: "👤 Üye güncellendi", color: COLORS.info, fields });
}

export async function onBan(ban) {
  await modLog(ban.guild, { title: "🔨 Yasaklandı", color: COLORS.danger, fields: [["Kullanıcı", userLine(ban.user)], ["Neden", ban.reason ?? "belirtilmedi"]] });
}

export async function onUnban(ban) {
  await modLog(ban.guild, { title: "🕊️ Yasak kaldırıldı", color: COLORS.ok, fields: [["Kullanıcı", userLine(ban.user)]] });
}
