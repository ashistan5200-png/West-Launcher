// Eğik çizgi komutları: moderasyon, güvenlik, sunucu yönetimi ve bilgi.
import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits as PF, SlashCommandBuilder } from "discord.js";
import { CONFIG } from "./config.js";
import { escalation, humanDuration, parseDuration } from "./detectors.js";
import { channelByName, clean, COLORS, modLog, userLine } from "./lib.js";
import { endRaidMode, lockdown, raid, startRaidMode } from "./security.js";
import { announceRelease, getLatest, releaseMessage, updateStats } from "./updates.js";
import { rolePanelMessage } from "./community.js";

const E = MessageFlags.Ephemeral;
const user = (o) => o.setName("kullanici").setDescription("Kullanıcı").setRequired(true);
const reason = (o, req = false) => o.setName("neden").setDescription("Neden").setRequired(req).setMaxLength(400);

export const DEFINITIONS = [
  new SlashCommandBuilder().setName("uyar").setDescription("Bir üyeyi uyarır (uyarılar birikince ceza otomatik artar)")
    .setDefaultMemberPermissions(PF.ModerateMembers).addUserOption(user).addStringOption((o) => reason(o, true)),
  new SlashCommandBuilder().setName("uyarilar").setDescription("Bir üyenin uyarılarını gösterir")
    .setDefaultMemberPermissions(PF.ModerateMembers).addUserOption(user),
  new SlashCommandBuilder().setName("uyari-sil").setDescription("Bir uyarıyı ya da tüm uyarıları siler")
    .setDefaultMemberPermissions(PF.ModerateMembers).addUserOption(user)
    .addIntegerOption((o) => o.setName("sira").setDescription("Silinecek uyarının sırası (boş: hepsi)").setMinValue(1)),
  new SlashCommandBuilder().setName("sustur").setDescription("Bir üyeyi süreli susturur")
    .setDefaultMemberPermissions(PF.ModerateMembers).addUserOption(user)
    .addStringOption((o) => o.setName("sure").setDescription("Örn. 10dk, 2s (saat), 1g (gün), 1hf (hafta). En fazla 28 gün").setRequired(true))
    .addStringOption((o) => reason(o)),
  new SlashCommandBuilder().setName("susturma-kaldir").setDescription("Susturmayı kaldırır")
    .setDefaultMemberPermissions(PF.ModerateMembers).addUserOption(user),
  new SlashCommandBuilder().setName("at").setDescription("Bir üyeyi sunucudan atar")
    .setDefaultMemberPermissions(PF.KickMembers).addUserOption(user).addStringOption((o) => reason(o)),
  new SlashCommandBuilder().setName("yasakla").setDescription("Bir kullanıcıyı yasaklar")
    .setDefaultMemberPermissions(PF.BanMembers).addUserOption(user).addStringOption((o) => reason(o))
    .addIntegerOption((o) => o.setName("mesaj-sil").setDescription("Son kaç günün mesajları silinsin").addChoices(
      { name: "Hiç", value: 0 }, { name: "Son 1 gün", value: 1 }, { name: "Son 7 gün", value: 7 })),
  new SlashCommandBuilder().setName("yasak-kaldir").setDescription("Yasağı kaldırır")
    .setDefaultMemberPermissions(PF.BanMembers)
    .addStringOption((o) => o.setName("kullanici-id").setDescription("Kullanıcı kimliği").setRequired(true)),
  new SlashCommandBuilder().setName("temizle").setDescription("Kanaldaki son mesajları siler")
    .setDefaultMemberPermissions(PF.ManageMessages)
    .addIntegerOption((o) => o.setName("adet").setDescription("1–100").setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName("kullanici").setDescription("Yalnızca bu kişinin mesajları")),
  new SlashCommandBuilder().setName("yavas-mod").setDescription("Kanala yavaş mod koyar")
    .setDefaultMemberPermissions(PF.ManageChannels)
    .addIntegerOption((o) => o.setName("saniye").setDescription("0 = kapalı, en fazla 21600").setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName("kanal").setDescription("Bu kanalı kilitler ya da açar")
    .setDefaultMemberPermissions(PF.ManageChannels)
    .addSubcommand((s) => s.setName("kilitle").setDescription("Herkesin yazmasını kapatır"))
    .addSubcommand((s) => s.setName("ac").setDescription("Kilidi kaldırır")),
  new SlashCommandBuilder().setName("guvenlik").setDescription("Sunucu güvenliği")
    .setDefaultMemberPermissions(PF.ManageGuild)
    .addSubcommand((s) => s.setName("durum").setDescription("Koruma durumunu gösterir"))
    .addSubcommand((s) => s.setName("raid-baslat").setDescription("Raid modunu elle açar"))
    .addSubcommand((s) => s.setName("raid-bitir").setDescription("Raid modunu kapatır"))
    .addSubcommand((s) => s.setName("kilitle").setDescription("TÜM sunucuyu kilitler (acil durum)"))
    .addSubcommand((s) => s.setName("kilidi-ac").setDescription("Sunucu kilidini kaldırır")),
  new SlashCommandBuilder().setName("duyuru").setDescription("Bir kanala şık bir duyuru gönderir")
    .setDefaultMemberPermissions(PF.ManageGuild)
    .addStringOption((o) => o.setName("baslik").setDescription("Başlık").setRequired(true).setMaxLength(200))
    .addStringOption((o) => o.setName("metin").setDescription("Metin (\\n ile yeni satır)").setRequired(true).setMaxLength(3500))
    .addChannelOption((o) => o.setName("kanal").setDescription("Boş: duyurular").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName("herkesi-etiketle").setDescription("@everyone")),
  new SlashCommandBuilder().setName("surum-duyur").setDescription("Son West Client sürümünü #güncellemeler'e yeniden duyurur")
    .setDefaultMemberPermissions(PF.ManageGuild),
  new SlashCommandBuilder().setName("rol-paneli").setDescription("Bildirim rolü panelini bu kanala koyar")
    .setDefaultMemberPermissions(PF.ManageRoles),
  new SlashCommandBuilder().setName("surum").setDescription("West Client'ın son sürümü ve indirme bağlantıları"),
  new SlashCommandBuilder().setName("indir").setDescription("West Client indirme bağlantıları"),
  new SlashCommandBuilder().setName("bot").setDescription("Botun durumu"),
].map((c) => c.setDMPermission(false).toJSON());

// ───────── Yardımcılar ─────────

/** Hedefe işlem yapılabilir mi? Hata metni döndürür ya da null. */
function guard(i, target) {
  if (!target) return "Bu kişi sunucuda değil.";
  if (target.id === i.user.id) return "Kendine işlem yapamazsın.";
  if (target.id === i.guild.ownerId) return "Sunucu sahibine işlem yapılamaz.";
  if (target.user.bot && target.id === i.client.user.id) return "Bana işlem yapamazsın 🙂";
  if (i.member.roles.highest.comparePositionTo(target.roles.highest) <= 0 && i.user.id !== i.guild.ownerId)
    return "Bu kişinin rolü seninkine eşit ya da daha yüksek.";
  if (!target.manageable) return "Bu kişinin rolü botun rolünden yüksek. Sunucu Ayarları → Roller'de botun rolünü en üste taşı.";
  return null;
}

async function caseLog(i, store, title, color, target, extra = []) {
  const n = store.nextCase();
  await modLog(i.guild, { title: `${title} · Vaka #${n}`, color, fields: [["Kullanıcı", userLine(target.user ?? target)], ["Yetkili", userLine(i.user), true], ...extra] });
  return n;
}

const dm = (target, text) => (target.user ?? target).send(text).catch(() => {});

// ───────── İşleyici ─────────

export async function handleCommand(i, store) {
  const g = i.guild;
  const name = i.commandName;
  const opt = i.options;
  const why = opt.getString("neden") ?? "Belirtilmedi";

  switch (name) {
    case "uyar": {
      const t = opt.getMember("kullanici");
      const err = guard(i, t);
      if (err) return i.reply({ content: err, flags: E });
      const list = store.addWarn(t.id, { reason: why, by: i.user.id, at: Date.now() });
      const n = await caseLog(i, store, "⚠️ Uyarı", COLORS.warn, t, [["Neden", why], ["Toplam uyarı", String(list.length), true]]);
      await dm(t, `⚠️ **${g.name}** sunucusunda uyarı aldın: ${why}`);
      const step = escalation(list, CONFIG.warnEscalation, CONFIG.warnWindowMs);
      let auto = "";
      if (step?.action === "timeout" && t.moderatable) {
        await t.timeout(step.ms, `${step.at} uyarı`).catch(() => {});
        auto = `\n🔇 ${step.at}. uyarı: otomatik olarak ${humanDuration(step.ms)} susturuldu.`;
      } else if (step?.action === "kick" && t.kickable) {
        await dm(t, `👢 **${g.name}** sunucusundan ${step.at} uyarı nedeniyle atıldın.`);
        await t.kick(`${step.at} uyarı`).catch(() => {});
        auto = `\n👢 ${step.at}. uyarı: otomatik olarak atıldı.`;
      }
      return i.reply({ content: `⚠️ ${t} uyarıldı (Vaka #${n}, toplam ${list.length}).${auto}`, allowedMentions: { users: [] } });
    }

    case "uyarilar": {
      const u = opt.getUser("kullanici");
      const list = store.warns(u.id);
      const embed = new EmbedBuilder().setColor(COLORS.warn).setTitle(`${u.username} · ${list.length} uyarı`)
        .setDescription(list.length ? list.map((w, k) => `**${k + 1}.** <t:${Math.floor(w.at / 1000)}:R> · <@${w.by}>\n${clean(w.reason, 300)}`).join("\n\n").slice(0, 4000) : "Temiz sicil ✨");
      return i.reply({ embeds: [embed], flags: E });
    }

    case "uyari-sil": {
      const u = opt.getUser("kullanici");
      const idx = opt.getInteger("sira") ?? undefined;
      const removed = store.clearWarns(u.id, idx);
      if (removed) await modLog(g, { title: "🧽 Uyarı silindi", color: COLORS.ok, fields: [["Kullanıcı", userLine(u)], ["Yetkili", userLine(i.user), true], ["Silinen", String(removed), true]] });
      return i.reply({ content: removed ? `${removed} uyarı silindi.` : "Silinecek uyarı bulunamadı.", flags: E });
    }

    case "sustur": {
      const t = opt.getMember("kullanici");
      const err = guard(i, t);
      if (err) return i.reply({ content: err, flags: E });
      const ms = parseDuration(opt.getString("sure"));
      if (!ms) return i.reply({ content: "Süreyi anlayamadım. Örnek: `10dk`, `2s` (saat), `1g` (gün), `1hf` (hafta). En fazla 28 gün.", flags: E });
      await t.timeout(ms, why);
      const n = await caseLog(i, store, "🔇 Susturma", COLORS.warn, t, [["Süre", humanDuration(ms), true], ["Neden", why]]);
      await dm(t, `🔇 **${g.name}** sunucusunda ${humanDuration(ms)} susturuldun: ${why}`);
      return i.reply({ content: `🔇 ${t} ${humanDuration(ms)} susturuldu (Vaka #${n}).`, allowedMentions: { users: [] } });
    }

    case "susturma-kaldir": {
      const t = opt.getMember("kullanici");
      const err = guard(i, t);
      if (err) return i.reply({ content: err, flags: E });
      await t.timeout(null);
      await caseLog(i, store, "🔊 Susturma kaldırıldı", COLORS.ok, t);
      return i.reply({ content: `🔊 ${t} artık konuşabilir.`, allowedMentions: { users: [] } });
    }

    case "at": {
      const t = opt.getMember("kullanici");
      const err = guard(i, t) ?? (t.kickable ? null : "Bu kişiyi atamıyorum.");
      if (err) return i.reply({ content: err, flags: E });
      await dm(t, `👢 **${g.name}** sunucusundan atıldın: ${why}`);
      await t.kick(why);
      const n = await caseLog(i, store, "👢 Atma", COLORS.warn, t, [["Neden", why]]);
      return i.reply({ content: `👢 ${t.user.username} atıldı (Vaka #${n}).` });
    }

    case "yasakla": {
      const u = opt.getUser("kullanici");
      const t = opt.getMember("kullanici");
      if (t) {
        const err = guard(i, t) ?? (t.bannable ? null : "Bu kişiyi yasaklayamıyorum.");
        if (err) return i.reply({ content: err, flags: E });
        await dm(t, `🔨 **${g.name}** sunucusundan yasaklandın: ${why}`);
      }
      await g.members.ban(u, { reason: why, deleteMessageSeconds: (opt.getInteger("mesaj-sil") ?? 0) * 86400 });
      const n = await caseLog(i, store, "🔨 Yasaklama", COLORS.danger, u, [["Neden", why]]);
      return i.reply({ content: `🔨 ${u.username} yasaklandı (Vaka #${n}).` });
    }

    case "yasak-kaldir": {
      const id = opt.getString("kullanici-id").replace(/\D/g, "");
      const ban = await g.bans.fetch(id).catch(() => null);
      if (!ban) return i.reply({ content: "Bu kimlikte yasaklı biri yok.", flags: E });
      await g.bans.remove(id, `${i.user.username}: yasak kaldırıldı`);
      await caseLog(i, store, "🕊️ Yasak kaldırıldı", COLORS.ok, ban.user);
      return i.reply({ content: `🕊️ ${ban.user.username} kullanıcısının yasağı kaldırıldı.` });
    }

    case "temizle": {
      const n = opt.getInteger("adet");
      const only = opt.getUser("kullanici");
      await i.deferReply({ flags: E });
      const fetched = await i.channel.messages.fetch({ limit: only ? 100 : n });
      const target = only ? fetched.filter((m) => m.author.id === only.id).first(n) : fetched;
      const deleted = await i.channel.bulkDelete(target, true);
      return i.editReply(`🧹 ${deleted.size} mesaj silindi.${deleted.size < (target.size ?? target.length) ? " (14 günden eski mesajlar Discord kuralı gereği toplu silinemez.)" : ""}`);
    }

    case "yavas-mod": {
      const s = opt.getInteger("saniye");
      await i.channel.setRateLimitPerUser(s, `${i.user.username}`);
      return i.reply({ content: s ? `🐢 Yavaş mod: ${s} saniye.` : "Yavaş mod kapatıldı." });
    }

    case "kanal": {
      const on = opt.getSubcommand() === "kilitle";
      await i.channel.permissionOverwrites.edit(g.roles.everyone, { SendMessages: on ? false : null, SendMessagesInThreads: on ? false : null }, { reason: i.user.username });
      await modLog(g, { title: on ? "🔒 Kanal kilitlendi" : "🔓 Kanal açıldı", color: on ? COLORS.warn : COLORS.ok, fields: [["Kanal", `${i.channel}`, true], ["Yetkili", userLine(i.user)]] });
      return i.reply({ content: on ? "🔒 Kanal kilitlendi." : "🔓 Kanal açıldı." });
    }

    case "guvenlik": {
      const sub = opt.getSubcommand();
      if (sub === "durum") {
        const embed = new EmbedBuilder().setColor(raid.active() ? COLORS.danger : COLORS.ok).setTitle("🛡️ Güvenlik durumu").addFields(
          { name: "Raid modu", value: raid.active() ? `AÇIK · <t:${Math.floor(raid.until / 1000)}:R> kapanır` : "Kapalı", inline: true },
          { name: "Doğrulama", value: String(g.verificationLevel), inline: true },
          { name: "Koruma", value: `• Spam: ${CONFIG.spam.burst} mesaj/${CONFIG.spam.burstWindowMs / 1000} sn\n• Raid: ${CONFIG.raid.joins} giriş/${CONFIG.raid.windowMs / 1000} sn\n• Zararlı bağlantı ve davet filtresi\n• Anti-nuke: ${CONFIG.nuke.windowMs / 1000} sn içinde ${CONFIG.nuke.limits.channelDelete} kanal/rol silme` },
        );
        return i.reply({ embeds: [embed], flags: E });
      }
      await i.deferReply({ flags: E });
      if (sub === "raid-baslat") { await startRaidMode(g, `elle: ${i.user.username}`); return i.editReply("🚨 Raid modu açıldı."); }
      if (sub === "raid-bitir") { await endRaidMode(g, `elle: ${i.user.username}`); return i.editReply("✅ Raid modu kapatıldı."); }
      const count = await lockdown(g, sub === "kilitle", i.user.username);
      return i.editReply(sub === "kilitle" ? `🔒 ${count} kanal kilitlendi. Açmak için \`/guvenlik kilidi-ac\`.` : `🔓 ${count} kanalın kilidi açıldı.`);
    }

    case "duyuru": {
      const ch = opt.getChannel("kanal") ?? channelByName(g, "duyurular");
      if (!ch?.isTextBased()) return i.reply({ content: "Duyuru kanalı bulunamadı.", flags: E });
      const everyone = opt.getBoolean("herkesi-etiketle") ?? false;
      const embed = new EmbedBuilder().setColor(COLORS.brand).setTitle(opt.getString("baslik"))
        .setDescription(opt.getString("metin").replace(/\\n/g, "\n")).setFooter({ text: `${i.user.username} · West Client` }).setTimestamp(new Date());
      const msg = await ch.send({ content: everyone ? "@everyone" : undefined, embeds: [embed], allowedMentions: { parse: everyone ? ["everyone"] : [] } });
      if (ch.type === ChannelType.GuildAnnouncement) await msg.crosspost().catch(() => {});
      return i.reply({ content: `📢 Duyuru gönderildi: ${msg.url}`, flags: E });
    }

    case "surum-duyur": {
      await i.deferReply({ flags: E });
      const rel = await getLatest();
      await announceRelease(g, rel);
      store.set("lastRelease", rel.tag_name);
      return i.editReply(`📢 ${rel.tag_name} duyuruldu.`);
    }

    case "rol-paneli": {
      await i.channel.send(rolePanelMessage());
      return i.reply({ content: "Panel eklendi.", flags: E });
    }

    case "surum":
    case "indir": {
      const rel = await getLatest().catch(() => null);
      if (!rel) return i.reply({ content: `⬇️ ${CONFIG.site}`, flags: E });
      const m = releaseMessage(rel, null);
      if (name === "indir") m.embeds[0].setDescription(`En son sürüm **${rel.tag_name}**. İşletim sistemini seç 👇`);
      return i.reply({ ...m, flags: E });
    }

    case "bot": {
      const up = Math.floor(process.uptime());
      await updateStats(g).catch(() => {});
      return i.reply({ content: `🟢 Çalışıyorum · gecikme ${i.client.ws.ping} ms · açık kalma ${Math.floor(up / 3600)} sa ${Math.floor((up % 3600) / 60)} dk`, flags: E });
    }
  }
}
