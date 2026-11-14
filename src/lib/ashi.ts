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
        `${name} çöktü gibi görünüyor. İstersen suçlu modu ben bulayım?`,
        `Ah, ${name} yere düştü. İzini sürüp hangi modun yaptığını bulabilirim!`,
        `${name} yine mi? Bana biraz zaman ver, suçluyu yakalarım.`,
      ],
      seed,
    ),
  baseline: [
    "Önce çökmeyi kendi gözümle göreyim, tüm modlar açık deniyorum…",
    "İlk iş: olay yerini incelemek. Her şey açıkken bir deneme yapıyorum.",
  ],
  testing: [
    "Modların yarısını uyuttum, bakalım oyun ayakta kalacak mı…",
    "Haritayı ikiye böldüm, şimdi bu yarıyı arıyorum.",
    "İz tazeleniyor… şu grubu deniyorum.",
    "Pusula bu tarafı gösteriyor, bir tur daha!",
    "Şüpheliler azaldıkça kalbim hızlanıyor. Deneme başladı.",
  ],
  verify: [
    "Sanırım buldum! Emin olmak için son bir kez deniyorum…",
    "Şüpheliyi köşeye sıkıştırdım. Doğrulama turu!",
  ],
  crashed: [
    "Bonk! Yine çöktü — demek ki suçlu bu grupta.",
    "Yakaladım bir çöküş! Şüpheliler bu tarafta.",
    "Çöktü! Güzel, bu iz doğru yolda olduğumuzu söylüyor.",
  ],
  survived: [
    "Oyun ayakta kaldı, bu grup masum. Diğer tarafa geçiyorum.",
    "Sorunsuz açıldı! Suçlu burada değil.",
    "Temiz. Bu modları şüpheli listesinden siliyorum.",
  ],
  culprit: (n: number) => (n === 1 ? "Buldum! Suçlu bu:" : "Buldum! Bu modlar birlikte suçlu:"),
  combination:
    "Tek bir suçlu yok; çökme birkaç modun bir arada olmasından çıkıyor. En güçlü şüpheliler şunlar:",
  notReproduced:
    "Tüm modlar açıkken denedim ama oyun çökmedi. Çökme rastgele olabilir ya da dünyaya girince oluyor olabilir.",
  cancelled: "Peki, avı bıraktım. Bütün modlarını eskisi gibi geri açtım.",
  error: "Bir şeyler ters gitti, avı durdurdum. Modların eski haline döndü:",
  restored: "Endişelenme, hiçbir mod silinmedi; hepsi eski yerinde.",
};

export const randomLine = (arr: string[], seed: number) => pick(arr, seed);
