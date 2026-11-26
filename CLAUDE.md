# West Client

## Sürüm yayınlama (her sürümde, eksiksiz)

1. Sürümü yükselt: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` ve `src-tauri/Cargo.lock` (west-launcher paketi).
2. Companion değiştiyse iki jar'ı da derleyip `src-tauri/resources/companion/` altına kopyala (`companion/build-all.sh`).
3. Geliştirme logları: `git restore companion/versions/fabric-26.2/logs` ve `git clean -fq companion/versions/fabric-26.2/logs` (yalnızca izlenmeyen yeni loglar silinir; izlenenlere dokunma).
   Sürüm commit'ine kök dizindeki `package.json` da girmeli (`git add package.json`); `release.yml` sürümü oradan okur.
4. Commit mesajı kullanıcıya yönelik sürüm notu olsun (iç jargon değil), sonra `git push -u origin main`. `release.yml` kurulum dosyalarını derleyip GitHub Releases'e yükler.
5. **Siteyi aynı sürümde güncelle (`site/`), atlanmaz:**
   - Yeni ya da değişen özellikleri `site/index.html`'e yansıt: hero'daki `#verText` satırı, ilgili bölüm metinleri, "Ve geri kalan her şey" listesi, gerekirse menü bağlantısı.
   - Görünüşü değişen ekranların görüntülerini yeniden çek ve `site/assets/shots/*.webp` dosyalarını değiştir (launcher sayfaları 1600×1000; oyun içi 960×540).
   - Kaldırılan özellikleri siteden de kaldır.
   - Siteyi tarayıcıda açıp değişen bölümleri kontrol et.

## Kurallar

- Arayüz metinleri Türkçe yazılır; yeni metinlerin İngilizce/Almanca çevirisi `src/i18n/*.json` (launcher), `src-tauri/i18n/*.json` (Rust) ve companion çevirilerine eklenir.
- Tasarım dili "Rota": düz yüzeyler, 1px çizgiler; amber yalnızca asıl eylem ve seçili durum. Launcher ve sitedeki gökyüzü arka planlarına dokunulmaz.
- Commit ve sürüm notlarında model kimliği yazılmaz.
