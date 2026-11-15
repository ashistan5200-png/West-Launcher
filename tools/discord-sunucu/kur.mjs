// West Client Discord sunucusunu sıfırdan kurar ve bir sunucu şablonu (discord.new/...) oluşturur.
//
// Gerekenler (ortam değişkenleri):
//   DISCORD_BOT_TOKEN  Botun anahtarı. ASLA koda, sohbete ya da bir dosyaya yazma; yalnızca GitHub Secret olarak gir.
//   GUILD_ID           (isteğe bağlı) Bot birden çok sunucudaysa hangisinin kurulacağı
//   TEMIZLE=1          (isteğe bağlı) Sunucudaki mevcut kanalları önce siler. Yalnızca yeni, boş sunucuda kullan.
//
// Bot, sunucuya "Yönetici" izniyle davet edilmiş olmalı. Kurulum bitince botu sunucudan atabilirsin.
// Node 18+ gerekir (dış paket yok).

const API = process.env.DISCORD_API ?? "https://discord.com/api/v10";
const TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
if (!TOKEN) {
  console.error("DISCORD_BOT_TOKEN tanımlı değil.");
  process.exit(1);
}

const SITE = "https://westlauncher.netlify.app";
const REPO = "https://github.com/ashistan5200-png/West-Launcher";

// ───────── Discord REST ─────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bot ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": `DiscordBot (${REPO}, 1.0)`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429) {
      const j = await res.json().catch(() => ({}));
      await sleep(Math.ceil((j.retry_after ?? 1) * 1000) + 100);
      continue;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(`${method} ${path} → ${res.status}: ${data?.message ?? text}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
  throw new Error(`${method} ${path}: hız sınırı aşılamadı`);
}

// ───────── İzinler ─────────
const P = {
  KICK: 1n << 1n, ADMIN: 1n << 3n, ADD_REACTIONS: 1n << 6n, AUDIT_LOG: 1n << 7n, VIEW: 1n << 10n, SEND: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n, MUTE: 1n << 22n, MOVE: 1n << 24n, MANAGE_THREADS: 1n << 34n, CREATE_PUBLIC_THREADS: 1n << 35n,
  SEND_IN_THREADS: 1n << 38n, MODERATE: 1n << 40n,
};
const bits = (...xs) => xs.reduce((a, b) => a | b, 0n).toString();

// ───────── Plan ─────────
// Roller aşağıdan yukarıya oluşturulur; yeni rol en alta eklendiği için son oluşturulan en üstte kalır.
const ROLES = [
  { key: "oyuncu", name: "🎮 Oyuncu", color: 0x70c48e, hoist: false, permissions: "0" },
  { key: "destekci", name: "💎 Destekçi", color: 0xec5a82, hoist: true, permissions: "0" },
  { key: "test", name: "🧪 Test Ekibi", color: 0xa08cb8, hoist: true, permissions: "0" },
  { key: "mod", name: "🛡️ Moderatör", color: 0x6ea8d6, hoist: true, permissions: bits(P.KICK, P.AUDIT_LOG, P.MANAGE_MESSAGES, P.MUTE, P.MOVE, P.MANAGE_THREADS, P.MODERATE) },
  { key: "kurucu", name: "👑 Kurucu", color: 0xe8a25c, hoist: true, permissions: bits(P.ADMIN) },
];

const T = { TEXT: 0, VOICE: 2, CATEGORY: 4, ANNOUNCEMENT: 5, FORUM: 15 };

const TEXTS = {
  kurallar: `🧭 **West Client Topluluğuna Hoş Geldin!**

**1.** Saygılı ol. Hakaret, ırkçılık, taciz yok.
**2.** Spam, reklam ve izinsiz sunucu daveti yok.
**3.** Hile (hack client) paylaşmak ve istemek yasak.
**4.** Yardım isterken <#yardim> forumunu kullan; çökme varsa log ekle.
**5.** Kimseden şifre, hesap ya da ödeme bilgisi isteme, verme. **West ekibi senden ASLA şifre istemez.**
**6.** Türkçe ana dil; herkes kendi dilinde rahatça yazabilir.
**7.** Moderatörlerin kararlarına uy; itirazın varsa özelden yaz.

İyi oyunlar! ⛏️`,
  duyuru: `🎉 **West Client'ın resmi Discord sunucusu açıldı!**

West Client; modlarını, paketlerini, dünyalarını ve arkadaşlarını tek bir yerde toplayan ücretsiz bir Minecraft launcher'ı.

🔍 Ashi, çöken paketlerin suçlusunu senin yerine bulur
🧩 Modrinth'ten tek tıkla mod, shader ve modpack
🧠 Ashi'yi tek tıkla akıllandır: ücretsiz, bilgisayarında çalışır
👥 West sosyal: profil, gönderi, hikâye ve mesajlar

⬇️ İndir: ${SITE}
🛠️ Sorun mu var? <#yardim> forumuna yaz.`,
  indir: `⬇️ **West Client'ı indir**
🌐 ${SITE}
🪟 Windows · 🍎 macOS · 🐧 Linux

Windows "bilinmeyen yayıncı" uyarısı verirse **Ek bilgi → Yine de çalıştır** de.
Kodun tamamı GitHub'da açık: <${REPO}>`,
  yardimKilavuz: `Sorununu anlatırken şunları ekle:
• West Client sürümü (Ayarlar → Genel)
• Instance: Minecraft sürümü + loader (Fabric/NeoForge…)
• Ne yaptın, ne oldu?
• Çökme varsa: Instance → Kayıtlar sekmesinden log`,
  hataKilavuz: `Hata bildirirken:
• Ne olmasını bekliyordun, ne oldu?
• Adım adım nasıl tekrar edilir?
• West Client sürümü ve işletim sistemi
• Varsa ekran görüntüsü ve log`,
  oneriKilavuz: `Bir fikrin mi var? Başlığa kısaca yaz, içinde neden işe yarayacağını anlat. Beğendiğin önerilere 👍 ver.`,
};

// Kanallar: başlıkta `after: "community"` olanlar Topluluk özelliği açıldıktan sonra oluşturulur
// (duyuru ve forum kanalları Topluluk ister).
function plan(r, everyone) {
  const readOnly = [{ id: everyone, type: 0, deny: bits(P.SEND, P.CREATE_PUBLIC_THREADS, P.SEND_IN_THREADS, P.ADD_REACTIONS) }];
  const staffOnly = [
    { id: everyone, type: 0, deny: bits(P.VIEW) },
    { id: r.mod, type: 0, allow: bits(P.VIEW) },
  ];
  return [
    { name: "📌 BAŞLANGIÇ", channels: [
      { key: "kurallar", name: "kurallar", type: T.TEXT, topic: "Sunucu kuralları", overwrites: readOnly },
      { key: "duyurular", name: "duyurular", type: T.ANNOUNCEMENT, after: "community", topic: "West Client duyuruları", overwrites: readOnly },
      { key: "guncellemeler", name: "güncellemeler", type: T.ANNOUNCEMENT, after: "community", topic: "Yeni sürümler buraya kendiliğinden düşer", overwrites: readOnly },
      { key: "indir", name: "indir", type: T.TEXT, topic: `İndir: ${SITE}`, overwrites: readOnly },
    ] },
    { name: "💬 SOHBET", channels: [
      { key: "genel", name: "genel", type: T.TEXT, topic: "Minecraft ve West Client sohbeti" },
      { key: "ss", name: "ekran-görüntüleri", type: T.TEXT, topic: "Oyundan en güzel karelerin" },
      { key: "modpack", name: "modpack-paylaşımı", type: T.TEXT, topic: "Modpack'ini paylaş (.mrpack, Ayarlar → Paylaş)" },
      { key: "oyuncu", name: "oyuncu-arıyorum", type: T.TEXT, topic: "Birlikte oynayacak arkadaş bul" },
    ] },
    { name: "🛠️ DESTEK", channels: [
      { key: "yardim", name: "yardım", type: T.FORUM, after: "community", topic: TEXTS.yardimKilavuz,
        tags: [["Çökme", "💥"], ["Giriş", "🔑"], ["Mod", "🧩"], ["Kurulum", "📦"], ["Çözüldü", "✅"]] },
      { key: "hata", name: "hata-bildir", type: T.FORUM, after: "community", topic: TEXTS.hataKilavuz,
        tags: [["Windows", "🪟"], ["macOS", "🍎"], ["Linux", "🐧"], ["Düzeltildi", "✅"]] },
      { key: "oneri", name: "öneriler", type: T.FORUM, after: "community", topic: TEXTS.oneriKilavuz,
        tags: [["Yeni", "🆕"], ["Planlandı", "🗓️"], ["Yapıldı", "✅"]], reaction: "👍" },
    ] },
    { name: "🔊 SES", channels: [
      { key: "ses1", name: "🎮 Oyun 1", type: T.VOICE },
      { key: "ses2", name: "🎮 Oyun 2", type: T.VOICE },
      { key: "ses3", name: "☕ Takılma", type: T.VOICE },
    ] },
    { name: "🔒 EKİP", overwrites: staffOnly, channels: [
      { key: "modsohbet", name: "mod-sohbet", type: T.TEXT },
      { key: "modkayit", name: "mod-kayıt", type: T.TEXT, topic: "AutoMod ve Discord bildirimleri" },
      { key: "test", name: "test-sürümleri", type: T.TEXT, overwrites: [...staffOnly, { id: r.test, type: 0, allow: bits(P.VIEW) }] },
    ] },
  ];
}

// ───────── Kurulum ─────────
async function main() {
  const me = await call("GET", "/users/@me");
  let guildId = process.env.GUILD_ID?.trim();
  if (!guildId) {
    const guilds = await call("GET", "/users/@me/guilds");
    if (guilds.length !== 1) {
      console.error(`Bot ${guilds.length} sunucuda. Hangisi olduğunu GUILD_ID ile belirt:\n${guilds.map((g) => `  ${g.id}  ${g.name}`).join("\n")}`);
      process.exit(1);
    }
    guildId = guilds[0].id;
  }
  const guild = await call("GET", `/guilds/${guildId}?with_counts=true`);
  console.log(`Bot: ${me.username} · Sunucu: ${guild.name}`);

  // 1) İsteğe bağlı temizlik
  const existing = await call("GET", `/guilds/${guildId}/channels`);
  if (process.env.TEMIZLE === "1") {
    if ((guild.approximate_member_count ?? 0) > 25) {
      console.error(`Bu sunucuda ${guild.approximate_member_count} üye var; güvenlik için dolu bir sunucu temizlenmez.`);
      process.exit(1);
    }
    if (guild.features?.includes("COMMUNITY")) {
      // Topluluk açıkken kurallar/güncelleme kanalı silinemez → önce kapat
      await call("PATCH", `/guilds/${guildId}`, { features: guild.features.filter((f) => f !== "COMMUNITY"), rules_channel_id: null, public_updates_channel_id: null });
    }
    for (const c of existing) await call("DELETE", `/channels/${c.id}`);
    console.log(`Temizlendi: ${existing.length} kanal silindi`);
  } else if (existing.some((c) => ["kurallar", "yardım", "duyurular"].includes(c.name))) {
    console.error("Sunucu zaten kurulmuş görünüyor. Baştan kurmak için TEMIZLE=1 ile çalıştır.");
    process.exit(1);
  }

  // 2) Roller (aynı adda varsa yeniden kullanılır)
  const roles = await call("GET", `/guilds/${guildId}/roles`);
  const r = {};
  for (const role of ROLES) {
    const found = roles.find((x) => x.name === role.name);
    r[role.key] = found ? found.id : (await call("POST", `/guilds/${guildId}/roles`, { name: role.name, color: role.color, hoist: role.hoist, permissions: role.permissions, mentionable: false })).id;
  }
  console.log("Roller hazır");

  // 3) Kanallar
  const everyone = guildId; // @everyone rolünün kimliği sunucu kimliğiyle aynıdır
  const layout = plan(r, everyone);
  const ch = {};
  const make = async (c, parent, position, inherited) => {
    const body = {
      name: c.name, type: c.type, position, parent_id: parent,
      permission_overwrites: c.overwrites ?? inherited ?? [],
    };
    if (c.topic && c.type !== T.VOICE) body.topic = c.topic;
    if (c.tags) body.available_tags = c.tags.map(([name, emoji_name]) => ({ name, emoji_name }));
    if (c.reaction) body.default_reaction_emoji = { emoji_name: c.reaction };
    ch[c.key] = (await call("POST", `/guilds/${guildId}/channels`, body)).id;
  };
  const cats = [];
  for (const [i, cat] of layout.entries()) {
    const id = (await call("POST", `/guilds/${guildId}/channels`, { name: cat.name, type: T.CATEGORY, position: i, permission_overwrites: cat.overwrites ?? [] })).id;
    cats.push(id);
    for (const [j, c] of cat.channels.entries()) if (!c.after) await make(c, id, j, cat.overwrites);
  }

  // 4) Topluluk özelliği (duyuru/forum kanalları, karşılama ekranı ve kurallar ekranı için)
  await call("PATCH", `/guilds/${guildId}`, {
    features: [...new Set([...(guild.features ?? []), "COMMUNITY"])],
    verification_level: 2, // Orta: hesap en az 5 dakikalık olmalı
    explicit_content_filter: 2, // tüm üyelerin medyası taranır
    default_message_notifications: 1, // yalnızca bahsetmeler
    rules_channel_id: ch.kurallar,
    public_updates_channel_id: ch.modkayit,
    preferred_locale: "tr",
    description: "West Client: ücretsiz Minecraft launcher'ı. Destek, güncellemeler ve topluluk.",
  });
  console.log("Topluluk özelliği açıldı");

  for (const [i, cat] of layout.entries()) {
    for (const [j, c] of cat.channels.entries()) if (c.after) await make(c, cats[i], j, cat.overwrites);
  }
  console.log(`Kanallar hazır: ${Object.keys(ch).length}`);

  // 5) Mesajlar (kanal etiketleri gerçek kanal bağlantılarına çevrilir)
  const link = (s) => s.replaceAll("<#yardim>", `<#${ch.yardim}>`);
  await call("POST", `/channels/${ch.kurallar}/messages`, { content: link(TEXTS.kurallar) });
  await call("POST", `/channels/${ch.indir}/messages`, { content: link(TEXTS.indir) });
  await call("POST", `/channels/${ch.duyurular}/messages`, { content: link(TEXTS.duyuru) });

  // 6) Karşılama ekranı
  await call("PATCH", `/guilds/${guildId}/welcome-screen`, {
    enabled: true,
    description: "West Client topluluğuna hoş geldin! Önce kurallara göz at, sonra sohbete katıl.",
    welcome_channels: [
      { channel_id: ch.kurallar, description: "Kuralları oku", emoji_name: "📜" },
      { channel_id: ch.indir, description: "West Client'ı indir", emoji_name: "⬇️" },
      { channel_id: ch.yardim, description: "Sorun mu var? Buradan sor", emoji_name: "🛠️" },
      { channel_id: ch.genel, description: "Sohbete katıl", emoji_name: "💬" },
    ],
  }).catch((e) => console.warn("Karşılama ekranı ayarlanamadı:", e.message));

  // 7) AutoMod
  const alert = { type: 2, metadata: { channel_id: ch.modkayit } };
  const automod = [
    { name: "Küfür ve hakaret", trigger_type: 4, trigger_metadata: { presets: [1, 2, 3] }, actions: [{ type: 1 }, alert] },
    { name: "Spam", trigger_type: 3, actions: [{ type: 1 }, alert] },
    { name: "Toplu bahsetme", trigger_type: 5, trigger_metadata: { mention_total_limit: 5 }, actions: [{ type: 1 }, alert] },
  ];
  for (const rule of automod) {
    await call("POST", `/guilds/${guildId}/auto-moderation/rules`, { ...rule, event_type: 1, enabled: true })
      .catch((e) => console.warn(`AutoMod "${rule.name}" eklenemedi:`, e.message));
  }
  console.log("AutoMod hazır");

  // 8) Sunucu sahibine Kurucu rolü
  await call("PUT", `/guilds/${guildId}/members/${guild.owner_id}/roles/${r.kurucu}`)
    .catch((e) => console.warn("Kurucu rolü verilemedi (bot rolünü en üste taşıyıp tekrar dene):", e.message));

  // 9) Sunucu şablonu
  const tpl = { name: "West Client", description: "Minecraft launcher topluluğu: duyurular, destek forumları, sohbet ve ses kanalları." };
  const templates = await call("GET", `/guilds/${guildId}/templates`);
  const t = templates.length
    ? await call("PUT", `/guilds/${guildId}/templates/${templates[0].code}`)
    : await call("POST", `/guilds/${guildId}/templates`, tpl);

  console.log("\n✅ Sunucu kuruldu.");
  console.log(`📋 Sunucu şablonu: https://discord.new/${t.code}`);
  console.log("Artık botu sunucudan atabilirsin (Sunucu Ayarları → Üyeler → bot → At).");
}

main().catch((e) => {
  console.error("❌", e.message);
  if (e.data?.errors) console.error(JSON.stringify(e.data.errors, null, 2));
  process.exit(1);
});
