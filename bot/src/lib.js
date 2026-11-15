// Discord tarafındaki ortak yardımcılar.
import { EmbedBuilder } from "discord.js";
import { CONFIG } from "./config.js";

/** Botun güvenlik için sildiği mesajlar; kayıtta ikinci kez "silindi" diye görünmesin */
export const botDeleted = new Set();
export const forgetDeleted = (id) => setTimeout(() => botDeleted.delete(id), 60_000).unref();

export const COLORS = { info: 0x6ea8d6, ok: 0x70c48e, warn: 0xe8a25c, danger: 0xec5a82, brand: 0xe8a25c };

export const channelByName = (guild, name) => guild.channels.cache.find((c) => c.name === name) ?? null;
export const roleByName = (guild, name) => guild.roles.cache.find((r) => r.name === name) ?? null;

/** Discord metninde kullanıcı girdisini zararsız hale getirir (etiket ve biçim kaçışı). */
export const clean = (s, max = 1000) => {
  const t = String(s ?? "").replace(/@(everyone|here)/g, "@​$1").replace(/```/g, "ˋˋˋ");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const userLine = (u) => `${u} · \`${u.tag ?? u.username}\` · \`${u.id}\``;

/**
 * #mod-kayıt'a bir kayıt düşer. Kanal yoksa sessizce atlar; bot hiçbir zaman kayıt yüzünden çökmez.
 * @param {import("discord.js").Guild} guild
 * @param {{ title: string, color?: number, fields?: [string, string, boolean?][], description?: string, ping?: boolean, footer?: string }} e
 */
export async function modLog(guild, e) {
  const ch = channelByName(guild, CONFIG.channels.modLog);
  if (!ch?.isTextBased()) return;
  const embed = new EmbedBuilder().setTitle(e.title).setColor(e.color ?? COLORS.info).setTimestamp(new Date());
  if (e.description) embed.setDescription(clean(e.description, 4000));
  for (const [name, value, inline] of e.fields ?? []) embed.addFields({ name, value: clean(value, 1024) || "—", inline: inline ?? false });
  if (e.footer) embed.setFooter({ text: e.footer });
  const mod = roleByName(guild, CONFIG.roles.mod);
  await ch
    .send({ content: e.ping && mod ? `${mod}` : undefined, embeds: [embed], allowedMentions: { roles: mod && e.ping ? [mod.id] : [] } })
    .catch((err) => console.warn("mod-kayıt yazılamadı:", err.message));
}

/** Bot bu üyeye işlem yapabilir mi (rol sırası ve sunucu sahibi kontrolü). */
export const canAct = (member) => !!member && member.manageable && member.moderatable;

export const ago = (date) => {
  const d = Date.now() - new Date(date).getTime();
  const days = Math.floor(d / 864e5);
  if (days >= 365) return `${Math.floor(days / 365)} yıl önce`;
  if (days >= 1) return `${days} gün önce`;
  const h = Math.floor(d / 36e5);
  return h >= 1 ? `${h} saat önce` : `${Math.max(1, Math.floor(d / 6e4))} dakika önce`;
};
