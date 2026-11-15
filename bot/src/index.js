// West Bot: West Client Discord sunucusunun güvenliği, moderasyonu ve güncellemeleri.
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import { CONFIG } from "./config.js";
import { Store } from "./store.js";
import * as security from "./security.js";
import * as logs from "./logs.js";
import * as community from "./community.js";
import { checkRelease, updateStats } from "./updates.js";
import { DEFINITIONS, handleCommand } from "./commands.js";

if (!CONFIG.token) {
  console.error("DISCORD_BOT_TOKEN tanımlı değil. .env.example dosyasına bak.");
  process.exit(1);
}

const store = new Store(CONFIG.dataDir);
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // ayrıcalıklı: Developer Portal → Bot → Server Members Intent
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ayrıcalıklı: Message Content Intent
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  allowedMentions: { parse: [] }, // varsayılan: kimse etiketlenmez; gereken yerde açıkça izin verilir
});

/** Bot yalnızca belirtilen sunucuda (ya da tek sunucusunda) çalışır. */
const ours = (guild) => !!guild && (!CONFIG.guildId || guild.id === CONFIG.guildId);
/** Bir olay işleyicisindeki hata botu asla durdurmasın. */
const safe = (name, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (e) {
    console.error(`[${name}]`, e);
  }
};

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ ${c.user.tag} olarak bağlandı · ${c.guilds.cache.size} sunucu`);
  for (const guild of c.guilds.cache.values()) {
    if (!ours(guild)) continue;
    await guild.commands.set(DEFINITIONS).catch((e) => console.error("Komutlar kaydedilemedi:", e.message));
    await community.ensureOptInRoles(guild);
    await security.refreshInvites(guild);
    await guild.members.fetch().catch(() => {}); // rol ve üye olayları için önbellek
    const tick = async () => {
      await checkRelease(guild, store).catch((e) => console.warn("Sürüm:", e.message));
    };
    await tick();
    setInterval(tick, CONFIG.github.pollMs);
    await updateStats(guild).catch((e) => console.warn("İstatistik:", e.message));
    setInterval(() => updateStats(guild).catch(() => {}), CONFIG.statsEveryMs);
    console.log(`🛡️ ${guild.name} korunuyor`);
  }
});

client.on(Events.MessageCreate, safe("mesaj", async (msg) => {
  if (!ours(msg.guild)) return;
  await security.onMessage(msg);
}));

client.on(Events.GuildMemberAdd, safe("giriş", async (member) => {
  if (!ours(member.guild)) return;
  const allowed = await security.onJoin(member);
  if (!allowed) return;
  await logs.onJoinLog(member);
  // Kural ekranı yoksa hemen karşıla; varsa kabul edince (GuildMemberUpdate)
  if (!member.pending) await community.welcome(member);
}));

client.on(Events.GuildMemberUpdate, safe("üye", async (before, after) => {
  if (!ours(after.guild)) return;
  await community.onMemberUpdate(before, after);
  await logs.onMemberUpdate(before, after);
}));

client.on(Events.GuildMemberRemove, safe("çıkış", async (m) => ours(m.guild) && logs.onLeave(m)));
client.on(Events.MessageDelete, safe("silme", async (m) => ours(m.guild) && logs.onMessageDelete(m)));
client.on(Events.MessageBulkDelete, safe("toplu silme", async (ms, ch) => ours(ch.guild) && logs.onMessageBulkDelete(ms, ch)));
client.on(Events.MessageUpdate, safe("düzenleme", async (a, b) => ours(b.guild) && logs.onMessageUpdate(a, b)));
client.on(Events.GuildBanAdd, safe("yasak", async (ban) => ours(ban.guild) && logs.onBan(ban)));
client.on(Events.GuildBanRemove, safe("yasak kaldırma", async (ban) => ours(ban.guild) && logs.onUnban(ban)));
client.on(Events.GuildAuditLogEntryCreate, safe("denetim", async (entry, guild) => ours(guild) && security.onAuditLog(entry, guild)));
client.on(Events.InviteCreate, safe("davet", async (inv) => ours(inv.guild) && security.refreshInvites(inv.guild)));
client.on(Events.ThreadCreate, safe("forum", async (t, isNew) => ours(t.guild) && community.onThreadCreate(t, isNew)));

client.on(Events.InteractionCreate, async (i) => {
  if (!ours(i.guild)) return;
  try {
    if (i.isChatInputCommand()) await handleCommand(i, store);
    else if (i.isButton() && i.customId.startsWith("role:")) await community.onRoleButton(i);
    else if (i.isButton() && i.customId === "solved") await community.markSolved(i);
  } catch (e) {
    console.error(`[komut ${i.isChatInputCommand() ? i.commandName : i.customId}]`, e);
    const content = `Bir şeyler ters gitti: ${String(e.message ?? e).slice(0, 300)}`;
    if (i.deferred || i.replied) await i.editReply(content).catch(() => {});
    else await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

process.on("unhandledRejection", (e) => console.error("[yakalanmamış]", e));
const stop = () => {
  console.log("Kapanıyor…");
  void client.destroy().finally(() => process.exit(0));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await client.login(CONFIG.token);
