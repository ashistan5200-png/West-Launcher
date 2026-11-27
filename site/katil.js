/* "Birlikte oyna" daveti: Discord'daki düğme buraya gelir (katil?k=KOD) */
(() => {
  const { supabaseUrl, supabaseKey } = window.WEST;
  const $ = (id) => document.getElementById(id);
  const show = (id) => document.querySelectorAll(".acct-state").forEach((e) => (e.hidden = e.id !== id));
  const LOADERS = { fabric: "Fabric", quilt: "Quilt", forge: "Forge", neoforge: "NeoForge", vanilla: "Vanilla" };
  const code = (new URLSearchParams(location.search).get("k") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 8) {
    $("failText").textContent = "Bu bağlantıda geçerli bir davet kodu yok.";
    return show("failed");
  }
  const tag = (text) => {
    const s = document.createElement("span");
    s.textContent = text;
    return s;
  };
  fetch(`${supabaseUrl}/rest/v1/rpc/get_play_invite`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ p_code: code }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((inv) => {
      if (!inv) return show("failed");
      const m = inv.manifest || {};
      const mods = (m.m || []).length;
      const packs = (m.r || []).length + (m.s || []).length;
      $("packName").textContent = inv.name || m.n || "Paket";
      const tags = $("packTags");
      tags.append(tag(`${LOADERS[(m.l || "").toLowerCase()] || m.l || ""} ${m.mc || ""}`.trim()));
      if (mods) tags.append(tag(`${mods} mod`));
      if (packs) tags.append(tag(`${packs} paket ve shader`));
      if (inv.server) {
        tags.append(tag(inv.server));
        $("lead").textContent = `Arkadaşın bu paketle ${inv.server} sunucusunda oynuyor. Aynı paketi kurup yanına bağlan.`;
      } else {
        $("joinHelp").hidden = true;
        $("lead").textContent = "Arkadaşın bu paketle oynuyor. Aynı paketi kurup sen de oyna.";
      }
      $("openBtn").href = `westclient://katil/${code}`;
      show("invite");
      // Launcher kuruluysa kendiliğinden açılsın
      setTimeout(() => { location.href = `westclient://katil/${code}`; }, 400);
    })
    .catch(() => {
      $("failText").textContent = "Davet şu an okunamadı. Biraz sonra tekrar dene.";
      show("failed");
    });
})();
