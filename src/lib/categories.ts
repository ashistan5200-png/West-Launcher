/** Modrinth kategori adlarının Türkçesi (bilinmeyenler olduğu gibi gösterilir). */
export const CAT_TR: Record<string, string> = {
  adventure: "Macera", cursed: "Tuhaf", decoration: "Dekorasyon", economy: "Ekonomi", equipment: "Ekipman", food: "Yemek",
  "game-mechanics": "Oyun mekaniği", library: "Kütüphane", magic: "Büyü", management: "Yönetim", minigame: "Mini oyun",
  mobs: "Yaratıklar", optimization: "Optimizasyon", social: "Sosyal", storage: "Depolama", technology: "Teknoloji",
  transportation: "Ulaşım", utility: "Araçlar", worldgen: "Dünya üretimi", challenging: "Zorlayıcı", combat: "Dövüş",
  "kitchen-sink": "Her şeyden biraz", lightweight: "Hafif", multiplayer: "Çok oyunculu", quests: "Görevler",
  atmosphere: "Atmosfer", bloom: "Parlama", "cartoon": "Çizgi film", "colored-lighting": "Renkli ışık", fantasy: "Fantastik",
  foliage: "Bitki örtüsü", "path-tracing": "Işın izleme", pbr: "PBR", reflections: "Yansımalar", "semi-realistic": "Yarı gerçekçi",
  shadows: "Gölgeler", realistic: "Gerçekçi", vanilla: "Vanilla benzeri", "vanilla-like": "Vanilla benzeri", simplistic: "Sade",
  themed: "Temalı", tweaks: "İnce ayar", audio: "Ses", blocks: "Bloklar", core_shaders: "Çekirdek shader", entities: "Varlıklar",
  environment: "Çevre", fonts: "Yazı tipleri", gui: "Arayüz", items: "Eşyalar", locale: "Dil", models: "Modeller",
  modded: "Modlu", "high": "Yüksek", "medium": "Orta", "low": "Düşük", potato: "Patates PC", screenshot: "Ekran görüntüsü",
};
export const catLabel = (c: string) => CAT_TR[c] ?? c.replace(/[-_]/g, " ").replace(/^\w/, (m) => m.toUpperCase());
