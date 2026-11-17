import { tx } from "@/lib/i18n";
/**
 * Ashi'nin kişiliği: meraklı, sakin, biraz şakacı bir iz sürücü.
 * Pusula logosuyla uyumlu olarak "iz", "rota", "harita" diliyle konuşur.
 */

export type AshiMood =
  | "wave" | "idle" | "think" | "search" | "bonk" | "celebrate" | "sad"
  // Kurulum sihirbazı (kartın üstünde oturan maskot)
  | "sit" | "sit-wave" | "sit-cover" | "sit-peek" | "run" | "jump";

const pick = <T,>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];

export const ashiLines = {
  offer: (name: string, seed = 0) =>
    pick(
      [
        tx("{0} çöktü gibi görünüyor. İstersen suçlu modu ben bulayım?", name),
        tx("Ah, {0} yere düştü. İzini sürüp hangi modun yaptığını bulabilirim!", name),
        tx("{0} yine mi? Bana biraz zaman ver, suçluyu yakalarım.", name),
      ],
      seed,
    ),
  baseline: [
    tx("Önce çökmeyi kendi gözümle göreyim, tüm modlar açık deniyorum…"),
    tx("İlk iş: olay yerini incelemek. Her şey açıkken bir deneme yapıyorum."),
  ],
  testing: [
    tx("Modların yarısını uyuttum, bakalım oyun ayakta kalacak mı…"),
    tx("Haritayı ikiye böldüm, şimdi bu yarıyı arıyorum."),
    tx("İz tazeleniyor… şu grubu deniyorum."),
    tx("Pusula bu tarafı gösteriyor, bir tur daha!"),
    tx("Şüpheliler azaldıkça kalbim hızlanıyor. Deneme başladı."),
  ],
  verify: [
    tx("Sanırım buldum! Emin olmak için son bir kez deniyorum…"),
    tx("Şüpheliyi köşeye sıkıştırdım. Doğrulama turu!"),
  ],
  crashed: [
    tx("Bonk! Yine çöktü — demek ki suçlu bu grupta."),
    tx("Yakaladım bir çöküş! Şüpheliler bu tarafta."),
    tx("Çöktü! Güzel, bu iz doğru yolda olduğumuzu söylüyor."),
  ],
  survived: [
    tx("Oyun ayakta kaldı, bu grup masum. Diğer tarafa geçiyorum."),
    tx("Sorunsuz açıldı! Suçlu burada değil."),
    tx("Temiz. Bu modları şüpheli listesinden siliyorum."),
  ],
  culprit: (n: number) => (n === 1 ? tx("Buldum! Suçlu bu:") : tx("Buldum! Bu modlar birlikte suçlu:")),
  combination:
    tx("Tek bir suçlu yok; çökme birkaç modun bir arada olmasından çıkıyor. En güçlü şüpheliler şunlar:"),
  other: [
    tx("Bu sefer başka bir hata çıktı; bir mod ötekine gizlice bağlı. Diğer yarıyı deniyorum."),
    tx("Farklı bir çökme — bu iz yanıltıcı, sayıma katmıyorum."),
  ],
  libraryCulprit:
    tx("Sorun bir kütüphanede görünüyor. Kütüphaneyi kapatmak ona bağlı modları da bozar; önce güncellemeni öneririm."),
  dependency:
    tx("Oyun bir bağımlılık hatasıyla hiç açılmıyor; avlanmaya gerek yok. Mod yükleyicinin söylediği şu:"),
  notReproduced:
    tx("Tüm modlar açıkken denedim ama oyun çökmedi. Çökme rastgele olabilir ya da dünyaya girince oluyor olabilir."),
  cancelled: tx("Peki, avı bıraktım. Bütün modlarını eskisi gibi geri açtım."),
  error: tx("Bir şeyler ters gitti, avı durdurdum. Modların eski haline döndü:"),
  restored: tx("Endişelenme, hiçbir mod silinmedi; hepsi eski yerinde."),
};

export const randomLine = (arr: string[], seed: number) => pick(arr, seed);
