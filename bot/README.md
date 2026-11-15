# West Bot

West Client Discord sunucusunun güvenlik, moderasyon ve güncelleme botu. Sunucu `tools/discord-sunucu/kur.mjs` ile kurulmuş olmalı; bot kanalları ve rolleri adlarıyla bulur.

## Ne yapar?

### Güvenlik (kendiliğinden)
- **Spam:**
  - 6 saniyede 6 mesaj, aynı metni 3 kez atma ya da 5 kişi/rol etiketleme → mesajlar silinir, kişi 10 dakika susturulur.
- **Zararlı bağlantılar:**
  - "d1sc0rd-nitro", "steamcommunlty" gibi taklit siteler ve "bedava nitro" yemleri silinir, gönderen 24 saat susturulur.
  - Başka sunucuların davetleri silinir; sunucunun kendi davetleri serbesttir.
- **Raid:**
  - 30 saniyede 8 giriş olunca raid modu açılır: doğrulama en yükseğe çıkar, davetler 15 dakika durur, 7 günden yeni hesaplar alınmaz, moderatörler etiketlenir.
- **Anti-nuke:**
  - Bir yetkili 1 dakikada 3 kanal veya rol silerse, ya da 5 kişi yasaklar/atarsa tüm rolleri alınır ve susturulur.
  - Bunu yapan bir botsa sunucudan atılır. Sunucu sahibi muaftır.
- **Yeni hesaplar:** 3 günden yeni hesaplar girişte `#mod-kayıt`'ta işaretlenir.
- **Muafiyet:** Yetkililer (Mesajları Yönet izni olanlar) spam ve bağlantı filtresinden muaftır.

### Kayıt (`#mod-kayıt`)
Silinen ve düzenlenen mesajlar, toplu silmeler, giriş/çıkış/atılma, rol ve takma ad değişiklikleri, susturmalar, yasaklar. Her moderasyon işlemi bir **vaka numarası** alır.

### Komutlar
| Komut | Kim | Ne yapar |
|---|---|---|
| `/uyar` | Moderatör | Uyarır. 3. uyarıda 1 saat, 5.'de 1 gün susturma, 7.'de atma (son 30 gün) |
| `/uyarilar`, `/uyari-sil` | Moderatör | Sicili gösterir / temizler |
| `/sustur`, `/susturma-kaldir` | Moderatör | `10dk`, `2s`, `1g`, `1hf` gibi sürelerle |
| `/at`, `/yasakla`, `/yasak-kaldir` | Moderatör | Kişiye özelden neden de bildirilir |
| `/temizle` | Moderatör | Son 1–100 mesajı (isteğe bağlı tek kişinin) siler |
| `/yavas-mod`, `/kanal kilitle/ac` | Moderatör | Kanal kontrolü |
| `/guvenlik durum/raid-baslat/raid-bitir/kilitle/kilidi-ac` | Yönetici | Acil durum: tüm sunucuyu tek komutla kilitler |
| `/duyuru` | Yönetici | Şık bir duyuru gönderir ve takip eden sunuculara yayınlar |
| `/surum-duyur` | Yönetici | Son sürümü yeniden duyurur |
| `/rol-paneli` | Yönetici | 🔔 Güncelleme / 🎉 Etkinlik bildirim rolleri için düğmeli panel |
| `/surum`, `/indir`, `/bot` | Herkes | Son sürüm, indirme düğmeleri, bot durumu |

### Güncellemeler ve topluluk
- **Yeni sürüm duyurusu:** GitHub'da yeni West Client sürümü çıkınca (5 dakikada bir bakılır) `#güncellemeler`'e indirme düğmeli bir duyuru atar ve 🔔 rolünü etiketler.
- **İstatistik kanalları:** `📊 İSTATİSTİK` kategorisinde üye sayısı, son sürüm ve West hesabı sayısı gösterilir.
- **Karşılama:** Kuralları kabul eden yeni üyeye 🎮 Oyuncu rolü verilir ve `#genel`'de karşılanır.
- **Forumlar:**
  - `#yardım` ve `#hata-bildir`'deki her yeni gönderiye kontrol listesi ve "✅ Çözüldü" düğmesi eklenir. Düğmeye basılınca konu etiketlenir, kilitlenir ve arşivlenir.
  - `#öneriler`'e 👍 👎 eklenir.

## Kurulum

1. **Developer Portal → West Client → Bot**
   - **Privileged Gateway Intents:** *Server Members Intent* ve *Message Content Intent*'i aç.
   - **Reset Token** de; anahtarı yalnızca botu çalıştıracağın yerdeki `.env` dosyasına ya da barındırma servisinin "Secrets/Variables" alanına yaz.
2. **Botu davet et** (Yönetici izniyle):
   `https://discord.com/oauth2/authorize?client_id=1571515539149422734&scope=bot+applications.commands&permissions=8`
3. **Sunucu Ayarları → Roller:** "West Client" bot rolünü listenin **en üstüne** sürükle. Bot yalnızca kendi rolünden aşağıdakilere işlem yapabilir.
4. Botu çalıştır (aşağıdan biri).

### Windows bilgisayarında
[Node.js 22 LTS](https://nodejs.org) kur. `bot` klasöründe `.env.example`'ı `.env` olarak kopyala, anahtarı yaz, `baslat.bat`'a çift tıkla. Bot, pencere açık kaldığı sürece çalışır; çökerse kendini yeniden başlatır.

### Sunucuda (Docker)
```bash
docker build -t west-bot bot
docker run -d --name west-bot --restart unless-stopped -e DISCORD_BOT_TOKEN=… -v west-bot-data:/data west-bot
```

### Geliştirme
```bash
cd bot && npm install && npm test
```

Uyarılar, vaka sayacı ve son duyurulan sürüm `data/db.json`'da tutulur (Docker'da `/data`).
