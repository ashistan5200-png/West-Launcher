// Topluluk: karşılama + otomatik rol, bildirim rolü paneli ve forumların kendi kendine işlemesi.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";
import { CONFIG } from "./config.js";
import { channelByName, COLORS, modLog, roleByName, userLine } from "./lib.js";

// ───────── Karşılama ─────────

/** Üye kuralları kabul ettiğinde (ya da kural ekranı yoksa girişte) Oyuncu rolünü verip karşılar. */
export async function welcome(member) {
  const role = roleByName(member.guild, CONFIG.roles.member);
  if (role && !member.roles.cache.has(role.id)) await member.roles.add(role, "Kuralları kabul etti").catch(() => {});
  const general = channelByName(member.guild, CONFIG.channels.general);
  const help = channelByName(member.guild, CONFIG.channels.help);
  if (!general?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setColor(COLORS.brand)
    .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL() })
    .setDescription(`Hoş geldin ${member}! 👋 West Client topluluğunun **${member.guild.memberCount}.** üyesisin.\n\n⬇️ İndirmek için: ${CONFIG.site}${help ? `\n🛠️ Takıldığın bir şey olursa: ${help}` : ""}`);
  await general.send({ embeds: [embed], allowedMentions: { users: [] } }).catch(() => {});
}

/** Kural ekranı açıkken üye "pending" başlar; kabul edince güncellenir. */
export async function onMemberUpdate(before, after) {
  if (before.pending && !after.pending) await welcome(after);
}

// ───────── Bildirim rolleri paneli ─────────

const OPT_IN = [
  { key: "updatePing", emoji: "🔔", label: "Güncelleme bildirimi", color: 0xe8a25c },
  { key: "eventPing", emoji: "🎉", label: "Etkinlik bildirimi", color: 0x70c48e },
];

export async function ensureOptInRoles(guild) {
  for (const o of OPT_IN) {
    const name = CONFIG.roles[o.key];
    if (!roleByName(guild, name)) await guild.roles.create({ name, color: o.color, mentionable: false, reason: "Bildirim rolü" }).catch(() => {});
  }
}

export function rolePanelMessage() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLORS.brand)
        .setTitle("🔔 Bildirim rolleri")
        .setDescription("Hangi duyurularda etiketlenmek istediğini seç. Tekrar basınca rol kaldırılır.\n\n🔔 **Güncelleme:** yeni West Client sürümü çıkınca\n🎉 **Etkinlik:** turnuva, çekiliş ve topluluk etkinliklerinde"),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        ...OPT_IN.map((o) => new ButtonBuilder().setCustomId(`role:${o.key}`).setStyle(ButtonStyle.Secondary).setEmoji(o.emoji).setLabel(o.label)),
      ),
    ],
  };
}

export async function onRoleButton(i) {
  const key = i.customId.split(":")[1];
  const role = roleByName(i.guild, CONFIG.roles[key]);
  if (!role) return i.reply({ content: "Bu rol bulunamadı; bir yetkiliye haber ver.", flags: MessageFlags.Ephemeral });
  const has = i.member.roles.cache.has(role.id);
  await (has ? i.member.roles.remove(role) : i.member.roles.add(role)).catch(() => {});
  await i.reply({ content: has ? `${role.name} rolü kaldırıldı.` : `${role.name} rolü verildi ✅`, flags: MessageFlags.Ephemeral });
}

// ───────── Forumlar ─────────

const SOLVED_TAGS = ["Çözüldü", "Düzeltildi", "Yapıldı"];

export async function onThreadCreate(thread, newlyCreated) {
  if (!newlyCreated || thread.parent?.type !== ChannelType.GuildForum) return;
  const forum = thread.parent.name;
  // Başlangıç mesajı bazen konudan hemen sonra gelir
  await new Promise((r) => setTimeout(r, 1500));

  if (forum === CONFIG.channels.ideas) {
    const starter = await thread.fetchStarterMessage().catch(() => null);
    await starter?.react("👍").catch(() => {});
    await starter?.react("👎").catch(() => {});
    return;
  }
  if (forum !== CONFIG.channels.help && forum !== CONFIG.channels.bugs) return;

  const isHelp = forum === CONFIG.channels.help;
  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(isHelp ? "Yardım isteğin alındı 🛠️" : "Hata bildirimin için teşekkürler 🐞")
    .setDescription(
      (isHelp
        ? "Daha hızlı yardım alman için şunları eklediğinden emin ol:\n• West Client sürümü (Ayarlar → Genel)\n• Minecraft sürümü ve loader\n• Ne yaptın, ne oldu?\n• Çökme varsa: Instance → **Kayıtlar** sekmesinden log\n\n💡 Çöken bir paket mi? Instance sayfasındaki **Suçlu Avcısı** ile Ashi suçlu modu senin için bulabilir."
        : "Lütfen şunları ekle:\n• Beklenen ve gerçekleşen davranış\n• Adım adım nasıl tekrar edilir\n• West Client sürümü ve işletim sistemi\n• Ekran görüntüsü / log") +
        "\n\nSorun çözülünce aşağıdaki düğmeye bas.",
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("solved").setStyle(ButtonStyle.Success).setEmoji("✅").setLabel(isHelp ? "Çözüldü" : "Düzeltildi"),
  );
  await thread.send({ embeds: [embed], components: [row] }).catch(() => {});
}

/** Konuyu açan kişi ya da yetkili "Çözüldü"ye basarsa etiketlenir, kilitlenir ve arşivlenir. */
export async function markSolved(i) {
  const thread = i.channel;
  if (!thread?.isThread()) return i.reply({ content: "Bu yalnızca forum gönderilerinde çalışır.", flags: MessageFlags.Ephemeral });
  const staff = i.member.permissions.has(PermissionFlagsBits.ManageThreads);
  if (thread.ownerId !== i.user.id && !staff) return i.reply({ content: "Bunu yalnızca konuyu açan kişi ya da yetkililer yapabilir.", flags: MessageFlags.Ephemeral });
  const tag = thread.parent?.availableTags?.find((t) => SOLVED_TAGS.includes(t.name));
  await i.reply({ content: `✅ ${i.user} konuyu çözüldü olarak işaretledi. Konu kapatıldı; yeni bir sorun için yeni gönderi aç.`, allowedMentions: { users: [] } });
  if (tag && !thread.appliedTags.includes(tag.id)) await thread.setAppliedTags([...thread.appliedTags, tag.id].slice(0, 5)).catch(() => {});
  await thread.setLocked(true).catch(() => {});
  await thread.setArchived(true).catch(() => {});
  await modLog(i.guild, { title: "✅ Konu çözüldü", color: COLORS.ok, fields: [["Konu", `${thread.name}`, true], ["Kapatan", userLine(i.user)]] });
}
