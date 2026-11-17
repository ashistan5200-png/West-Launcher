import { tx } from "@/lib/i18n";
/** Modrinth kategori adlarının Türkçesi (bilinmeyenler olduğu gibi gösterilir). */
export const CAT_TR: Record<string, string> = {
  adventure: tx("Macera"), cursed: tx("Tuhaf"), decoration: tx("Dekorasyon"), economy: tx("Ekonomi"), equipment: tx("Ekipman"), food: tx("Yemek"),
  "game-mechanics": tx("Oyun mekaniği"), library: tx("Kütüphane"), magic: tx("Büyü"), management: tx("Yönetim"), minigame: tx("Mini oyun"),
  mobs: tx("Yaratıklar"), optimization: tx("Optimizasyon"), social: tx("Sosyal"), storage: tx("Depolama"), technology: tx("Teknoloji"),
  transportation: tx("Ulaşım"), utility: tx("Araçlar"), worldgen: tx("Dünya üretimi"), challenging: tx("Zorlayıcı"), combat: tx("Dövüş"),
  "kitchen-sink": tx("Her şeyden biraz"), lightweight: tx("Hafif"), multiplayer: tx("Çok oyunculu"), quests: tx("Görevler"),
  atmosphere: tx("Atmosfer"), bloom: tx("Parlama"), "cartoon": tx("Çizgi film"), "colored-lighting": tx("Renkli ışık"), fantasy: tx("Fantastik"),
  foliage: tx("Bitki örtüsü"), "path-tracing": tx("Işın izleme"), pbr: "PBR", reflections: tx("Yansımalar"), "semi-realistic": tx("Yarı gerçekçi"),
  shadows: tx("Gölgeler"), realistic: tx("Gerçekçi"), vanilla: tx("Vanilla benzeri"), "vanilla-like": tx("Vanilla benzeri"), simplistic: tx("Sade"),
  themed: tx("Temalı"), tweaks: tx("İnce ayar"), audio: tx("Ses"), blocks: tx("Bloklar"), core_shaders: tx("Çekirdek shader"), entities: tx("Varlıklar"),
  environment: tx("Çevre"), fonts: tx("Yazı tipleri"), gui: tx("Arayüz"), items: tx("Eşyalar"), locale: tx("Dil"), models: tx("Modeller"),
  modded: tx("Modlu"), "high": tx("Yüksek"), "medium": tx("Orta"), "low": tx("Düşük"), potato: tx("Patates PC"), screenshot: tx("Ekran görüntüsü"),
};
export const catLabel = (c: string) => CAT_TR[c] ?? c.replace(/[-_]/g, " ").replace(/^\w/, (m) => m.toUpperCase());
