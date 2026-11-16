// Minecraft tuş atamalarının okunur Türkçe adları ve gruplanması (options.txt).

export const BIND_LABEL: Record<string, string> = {
  "key.forward": "İleri", "key.back": "Geri", "key.left": "Sol", "key.right": "Sağ",
  "key.jump": "Zıpla", "key.sneak": "Eğil", "key.sprint": "Koş",
  "key.attack": "Saldır / Kır", "key.use": "Kullan / Koy", "key.pickItem": "Bloğu seç",
  "key.drop": "Eşyayı at", "key.inventory": "Envanter", "key.swapOffhand": "Sol ele al",
  "key.chat": "Sohbet", "key.command": "Komut", "key.playerlist": "Oyuncu listesi",
  "key.screenshot": "Ekran görüntüsü", "key.togglePerspective": "Bakış açısı",
  "key.smoothCamera": "Sinematik kamera", "key.fullscreen": "Tam ekran",
  "key.spectatorOutlines": "Oyuncuları vurgula", "key.advancements": "Başarımlar",
  "key.socialInteractions": "Sosyal etkileşimler", "key.saveToolbarActivator": "Araç çubuğunu kaydet",
  "key.loadToolbarActivator": "Araç çubuğunu yükle",
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`key.hotbar.${i + 1}`, `Hızlı erişim ${i + 1}`])),
};

export const GROUPS: { id: string; label: string; test: (k: string) => boolean }[] = [
  { id: "move", label: "Hareket", test: (k) => /^key\.(forward|back|left|right|jump|sneak|sprint)$/.test(k) },
  { id: "game", label: "Oynanış", test: (k) => /^key\.(attack|use|pickItem|drop|swapOffhand|inventory)$/.test(k) || k.startsWith("key.hotbar.") },
  { id: "misc", label: "Arayüz ve diğer", test: (k) => k.startsWith("key.") },
  { id: "mods", label: "Modlar", test: () => true },
];

const MOUSE: Record<string, string> = { "key.mouse.left": "Sol tık", "key.mouse.right": "Sağ tık", "key.mouse.middle": "Orta tık" };
const NAMED: Record<string, string> = {
  space: "Boşluk", "left.shift": "Sol Shift", "right.shift": "Sağ Shift", "left.control": "Sol Ctrl", "right.control": "Sağ Ctrl",
  "left.alt": "Sol Alt", "right.alt": "Sağ Alt", tab: "Tab", enter: "Enter", escape: "Esc", backspace: "Geri sil",
  up: "↑", down: "↓", left: "←", right: "→", "caps.lock": "Caps Lock", grave: "`", slash: "/", period: ".", comma: ",",
};

/** "key.keyboard.left.shift" → "Sol Shift" */
export function prettyKey(v: string): string {
  if (!v || v === "key.keyboard.unknown") return "—";
  if (MOUSE[v]) return MOUSE[v];
  if (v.startsWith("key.mouse.")) return `Fare ${v.slice(10)}`;
  const k = v.replace(/^key\.keyboard\./, "");
  if (NAMED[k]) return NAMED[k];
  if (/^f\d+$/.test(k)) return k.toUpperCase();
  if (k.startsWith("keypad.")) return `Num ${k.slice(7)}`;
  return k.length === 1 ? k.toUpperCase() : k;
}

/** options.txt içinden tuş atamalarını çıkarır: [{ id: "key.jump", value: "key.keyboard.space" }] */
export function parseBinds(text: string) {
  const out: { id: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("key_")) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    out.push({ id: line.slice(4, i), value: line.slice(i + 1) });
  }
  return out;
}

/** Mod tuşlarının adını okunur yapar: "key.sodium.toggle" → "sodium · toggle" */
export function bindName(id: string): string {
  if (BIND_LABEL[id]) return BIND_LABEL[id];
  const parts = id.replace(/^key\./, "").split(".");
  return parts.length > 1 ? `${parts[0]} · ${parts.slice(1).join(" ")}` : parts[0];
}
