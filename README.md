# West Launcher

[![Windows için indir](https://img.shields.io/badge/Windows%20i%C3%A7in%20indir-.exe-7fa7c9?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/ashistan5200-png/West-Launcher/releases/latest/download/West-Launcher-Setup.exe)
[![macOS](https://img.shields.io/badge/macOS-.dmg-26282c?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/ashistan5200-png/West-Launcher/releases/latest/download/West-Launcher-macOS.dmg)
[![Linux](https://img.shields.io/badge/Linux-.deb-26282c?style=for-the-badge&logo=linux&logoColor=white)](https://github.com/ashistan5200-png/West-Launcher/releases/latest/download/West-Launcher-Linux.deb)

Windows "bilgisayarınızı korudu" uyarısı gösterirse **Ek bilgi → Yine de çalıştır**'a tıkla (uygulama henüz imzalı değil). macOS'ta ilk açılışta uygulamaya **sağ tıkla → Aç**.


Tauri 2 + React/TypeScript + Rust ile yazılmış, kompakt ve sade Minecraft launcher.

## Kimlik
- **Logo:** pusula. Kaynak: `src-tauri/icons/source/west-icon.svg`. Uygulama içinde `src/components/Logo.tsx`, iğnenin kuzey ucu kullanıcının vurgu rengini alır.
- İkonları yeniden üretmek için SVG'yi 1024 px PNG'ye çevirip `npx tauri icon <png>` çalıştır.
- **Palet:** mat antrasit/karbon zemin (`#131416` → `#26282c`), düşük doygunluklu vurgular. Varsayılan vurgu buz mavisi `#7fa7c9`; diğer hazır renkler adaçayı, petrol, arduvaz, leylak, kil, kum ve taş.
- **Tipografi:** Arayüzde Plus Jakarta Sans Variable, kodda JetBrains Mono Variable. İkisi de uygulamayla paketli, internet olmadan çalışır. Boyut, kalınlık, satır yüksekliği ve harf aralığı `--fs-*`, `--fw-*`, `--lh-*`, `--ls-*` token'larıyla ayarlanır.
- Neon ve glow kullanılmaz. Derinlik yalnızca `--shadow-sm/md/lg` gölgeleriyle verilir.

## Çalıştırma

```bash
npm install
npm run tauri:dev
```

Gereksinimler: Rust 1.77+, Node 20+, platformun Tauri ön koşulları (Linux'ta `webkit2gtk-4.1`).

## Mimari

```
west-launcher/
├─ package.json · vite.config.ts · tsconfig.json · index.html
├─ src/                              # React UI
│  ├─ App.tsx · main.tsx
│  ├─ lib/        ipc.ts (tipli invoke + olaylar) · theme.ts (renk motoru) · types.ts · format.ts
│  ├─ stores/     settings.ts · instances.ts (zustand, log batching)
│  ├─ components/ Logo · TitleBar · Sidebar · InstanceCard · InstanceIcon · CreateInstanceModal · Modal · ProgressDock · ErrorToast
│  ├─ pages/      Home · Library · Instance (konsol + ayarlar) · Settings (tema, Java)
│  └─ styles/globals.css            # CSS değişkenli tasarım sistemi
└─ src-tauri/
   ├─ Cargo.toml · tauri.conf.json · capabilities/default.json
   └─ src/
      ├─ lib.rs · main.rs · state.rs · settings.rs · paths.rs · util.rs · error.rs
      ├─ core/       # Tauri'den bağımsız motor
      │  ├─ http.rs      paralel + SHA1 doğrulamalı + yeniden denemeli indirici
      │  ├─ manifest.rs  Mojang meta, inheritsFrom birleştirme
      │  ├─ rules.rs     OS/feature kural motoru
      │  ├─ install.rs   client jar, kütüphaneler, asset'ler, natives
      │  ├─ launch.rs    argüman inşası (modern + legacy), spawn, log akışı
      │  └─ auth.rs      AuthSession + Java uyumlu offline UUID
      ├─ instance/   mod.rs (CRUD, klon, şablon) · loaders.rs (Fabric, Quilt, Forge, NeoForge)
      ├─ java/       mod.rs (keşif + Temurin otomatik kurulum) · jvm.rs (ZGC/G1 optimizatörü)
      └─ commands/   IPC katmanı (settings, window, versions, instance, java, launch)
```

### Ashi — Otomatik Suçlu Avcısı
Bir modlu instance çöktüğünde sağ altta maskot Ashi çıkar ve suçlu modu bulmayı teklif eder. Kabul edilirse önce süre uyarısı gösterilir, sonra av başlar.
- **Backend:**
  - `crash/modinfo.rs` mod jar'larının kimliklerini ve bağımlılıklarını okur (Fabric, Quilt, Forge, NeoForge ve jar-in-jar).
  - `crash/bisect.rs` modları bağımlılıklarını koruyarak ikiye bölen planlayıcıdır.
  - `commands/ashi.rs` her turda oyunu açar ve oyunun ana menüye ulaşıp ulaşmadığına göre sonuç verir.
- **Mod güvenliği:** Av sırasında modlar silinmez, geçici olarak `.ashi-off` uzantısı alır. Av bitince, durdurulunca ve launcher açılışında hepsi geri açılır.
- **UI:**
  - `components/Ashi3D.tsx` AshiWest skinli 3D maskottur (skinview3d) ve ayrı chunk olarak tembel yüklenir.
  - `AshiDock` sağ alttaki kartı, `AshiConfirmModal` süre uyarısını gösterir.
  - Ashi'nin konuşma satırları `lib/ashi.ts` dosyasındadır.

### Keşfet: birleşik içerik motoru
- `content/` Modrinth ile CurseForge'da aynı anda arar. Sonuçları sırayla harmanlar ve iki sitede birden bulunan projeyi bir kez gösterir.
- Mod, shader ve resource pack seçili instance'a tek tıkla kurulur.
  - Zorunlu bağımlılıklar kendiliğinden kurulur.
  - Zaten kurulu olanlar atlanır; bunun için instance'taki `content.json` kaydına ve jar'lardaki mod kimliklerine bakılır.
- Modpack'ler (`.mrpack` ve CurseForge `manifest.json`) yeni ve izole bir instance olarak kurulur.
- CurseForge araması için bir API anahtarı gerekir; anahtar Ayarlar'dan girilir.

### Ashi asistanı
Ayarlar'dan üç sağlayıcıdan biri seçilir:
- **Yerel model (Ollama, varsayılan, ücretsiz):** Model kullanıcının bilgisayarında çalışır; API ücreti ve anahtar gerekmez. Önerilen model `qwen2.5:7b`, düşük RAM'li bilgisayarlar için `qwen2.5:3b`. Model Ayarlar'dan tek tıkla indirilir. Ollama çalışmıyorsa Ashi kendiliğinden basit aramaya geçer.
- **Claude Haiku 5.5 (isteğe bağlı):** Kullanıcının kendi anahtarıyla çalışır. Token kullanımı kısıtlıdır: efor `low`, en fazla 2048 çıktı token'ı, en fazla 4 araç turu, aramada 8 sonuç ve kısaltılmış açıklamalar. Ücret yalnızca anahtar sahibinin hesabına yansır.
- **Kapalı:** Yapay zeka kullanılmaz; Ashi Türkçe anahtar kelimelerle arar.

Ashi'nin araçları her sağlayıcıda aynıdır: `search_content`, `list_instances`, `present_recommendations`. Ashi yalnızca aramada gerçekten bulduğu projeleri kurulabilir kart olarak gösterebilir. Anahtarlar `secrets.json` dosyasında tutulur ve arayüze hiç gönderilmez.

### Skin ve hesaplar
- **Hesaplar** (`accounts/`):
  - Microsoft girişi cihaz koduyla yapılır (Microsoft → Xbox Live → XSTS → Minecraft). Token'lar `accounts.json` dosyasında saklanır, süresi dolmadan önce yenilenir ve arayüze hiç gönderilmez.
  - Offline hesaplar da eklenebilir. Oyun etkin hesapla başlatılır.
  - Microsoft girişi, Mojang'ın onayladığı bir Azure uygulama kimliği ister; kimlik Ayarlar'dan girilir.
- **Skin arşivi** (`skins.rs`):
  - Bilgisayardan `.png` yüklenebilir; dosyanın 64×64 ya da 64×32 olduğu kontrol edilir ve kolun ince mi klasik mi olduğu otomatik anlaşılır.
  - Oyuncu adından skin alınabilir. Favoriler ve son kullanılanlar tutulur; aynı skin iki kez eklenmez.
- **Uygulama:** Microsoft hesaplarında skin Mojang'a yüklenir; pelerin de buradan değiştirilir. Offline hesaplarda skin yalnızca launcher'da saklanır.
- **Önizleme:** `SkinPreview3D` ile 3D ve 6 animasyon, `SkinThumb` ile 2D önden görünüm (three.js yüklemeden).

### Ekran görüntüsü stüdyosu
- **Tarama ve küçük resimler** (`screenshots.rs`): Tüm instance'ların `screenshots/` klasörleri taranır. Küçük resimler 480 px JPEG olarak önbelleğe alınır; görüntü başına ~19 ms sürer ve tek bir arka plan iş parçacığında sırayla üretilir.
- **Anında görünme:** Oyunda F2'ye basılınca log satırı yakalanır ve galeri hemen yenilenir; klasörü sürekli izleyen ayrı bir işlem yoktur.
- **Hızlı eylemler:** Panoya kopyalama, dışa aktarma, çöp kutusuna silme ve klasörde gösterme. Dosya yolları yalnızca instance'ların `screenshots` klasörleri içinde kabul edilir.
- **Düzenleyici** (`ScreenshotEditor` + `lib/imageEdit.ts`): Kırpma (oran ön ayarlarıyla), yeniden boyutlandırma, parlaklık, kontrast, doygunluk, sıcaklık, vinyet, 7 filtre, kalem ve yazı. Önizleme ile kaydedilen dosya aynı işlem hattından geçer. Sonuç her zaman `_west-edit` adlı bir kopya olarak kaydedilir; orijinal dosya değişmez.

### Açılış ve ilk kurulum
- `Splash`: Pusula iğnesi hızla dönüp yavaşlayarak durur, ardından "West Launcher" yazısı belirir. Tıklanınca atlanır.
- `AshiTour`: Yalnızca ilk açılışta çalışır. Ashi uçarak sahneye girer ve kenar çubuğundaki bölümleri sırayla gösterir. Balonda "Devam et", "Bu ne işe yarıyor?" ve "Anladım, geç" düğmeleri vardır. Tur Ayarlar'dan yeniden başlatılabilir.
- `ImportWizard` + `importer.rs`: Modrinth App, CurseForge, Prism Launcher, MultiMC ve resmi launcher'daki instance'ları bulur. Taşınabilir kurulumlar için "Klasör seç…" seçeneği vardır.
  - Meta veri yoksa Minecraft sürümü ve loader son oyun logundan tahmin edilir; tahmin edilemezse sürüm listeden seçilir.
  - Modlar, ayarlar, shader'lar, resource pack'ler ve sunucu listesi kopyalanır. Dünyalar isteğe bağlıdır. Kaynak dosyalara dokunulmaz.

### West Companion (oyun içi mod) — `companion/`
Fabric ve NeoForge için Minecraft 1.21.1 desteklenir. Ortak kod (`common/`, Mojang adlarıyla) iki Gradle projesine kaynak olarak eklenir. Derlemek için `npm run companion:build`; jar'lar `src-tauri/resources/companion/` klasörüne kopyalanır ve uygulamayla birlikte paketlenir.
- **Özel ana menü:** Solda AshiWest/oyuncu skinli animasyonlu karakter (kılıçlı, selam ve durağan pozlar; sürükleyerek döndürülür), sağda yumuşak animasyonlu düğmeler.
- **Çakışma koruması:**
  - Ana menü mixin kullanılmadan değiştirilir ve yalnızca tam olarak vanilla `TitleScreen` açıldığında devreye girer.
  - Essential, FancyMenu, CustomMainMenu gibi modlar algılanırsa uyumluluk moduna geçilir: West menüsü açılmaz, yalnızca bir "West" düğmesi eklenir.
  - Her kanca `SafeHook` ile korunur; bir hata olursa o özellik kapanır ve vanilla davranışa dönülür.
- **West Paneli** (Sağ Shift veya duraklat menüsündeki "West" düğmesi): FullBright, FPS/MS/bellek göstergesi, görüş mesafesi ön ayarları, bellek temizleme ve ana menü modu.
- **FullBright ve offline skin:** Bu ikisi için `require = 0` ile yazılmış iki küçük mixin vardır; hedef bulunamazsa oyun çökmez, yalnızca o özellik çalışmaz.
- **Launcher bağlantısı:**
  - Launcher uyumlu instance'lara modu otomatik kurar; Fabric'te eksikse Fabric API'yi de ekler.
  - Offline hesabın skinini `west/skin.png` olarak yazar.
  - `config/west-companion.json` instance ayarlarından canlı düzenlenir; mod dosyayı yaklaşık 2 saniyede bir yeniden okur.
  - Ashi'nin suçlu avı sırasında mod kaldırılır ve aramaya dahil edilmez.

### Discord Rich Presence — `discord.rs`
Launcher açıkken ve oynarken instance adı, loader, sürüm, mod sayısı ve süre Discord'da görünür. Ayrı ve çoğu zaman uyuyan bir iş parçacığında çalışır; Discord kapalıysa sessiz kalır. Discord Developer Portal'da bir uygulama oluşturup "west" adlı bir görsel yüklemek ve uygulama kimliğini Ayarlar'a girmek gerekir.

### Geliştirici testleri (`src-tauri/examples/`)
- `game_smoke`: Oyunu uçtan uca kurup başlatır: loader, dosyalar, West Companion, offline skin.
- `install_mod`: Bağımlılıklarıyla birlikte mod kurar.
- `content_smoke`, `skins_smoke`, `thumb_smoke`: Arama, skin ve küçük resim testleri.

### 2. aşama (sırada)

toplu güncelleme + yedek ·
`packaging/` (.mrpack/.zip dışa aktarma, paylaşım kodu) · `monitor/` (canlı RAM/CPU) ·
`backup/` (çıkışta dünya yedeği) · ekstralar: sunucu ping takipçisi, ekran görüntüsü galerisi, ayar senkronizasyonu.
