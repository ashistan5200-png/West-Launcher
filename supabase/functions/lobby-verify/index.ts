// West Client — lobi için Minecraft hesabı doğrulaması (Supabase Edge Function)
//
// Akış:
//  1. Oyun, West hesabıyla lobby_verify_start() çağırır ve tek kullanımlık bir kod alır.
//  2. Oyun bu kodla Mojang oturum sunucusuna "katıldım" der (joinServer; Minecraft'ın her sunucuya
//     girerken yaptığının aynısı). Erişim anahtarı oyundan hiç çıkmaz.
//  3. Bu fonksiyon, çağıranın oturumuyla lobby_verify_claim() çağırarak kodu (ve kim olduğunu) alır,
//     Mojang'a hasJoined ile sorar; Mojang onaylarsa Minecraft hesabı bu West hesabına bağlanır.
//
// Kurulum: Supabase → Edge Functions → adı "lobby-verify" olan fonksiyon → bu kod → Deploy.
// SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir; servis anahtarı
// yalnızca burada (sunucuda) kullanılır, istemciye gönderilmez.

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

  let name = "";
  try {
    name = String((await req.json())?.name ?? "");
  } catch {
    return json(400, { error: "Geçersiz istek" });
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return json(400, { error: "Geçersiz Minecraft adı" });

  // Kim olduğunu ve doğrulama kodunu, çağıranın kendi oturumuyla veritabanından al (tek kullanımlık)
  const asUser = createClient(url, apikey, { global: { headers: { authorization: auth } }, auth: { persistSession: false } });
  const { data: claim, error: claimErr } = await asUser.rpc("lobby_verify_claim");
  if (claimErr || !claim?.user_id) return json(400, { error: claimErr?.message ?? "West hesabına giriş yapılmamış" });
  const userId: string = claim.user_id;

  const r = await fetch(
    `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${encodeURIComponent(claim.nonce)}`,
  );
  if (r.status !== 200) return json(403, { error: "Mojang bu Minecraft hesabını doğrulamadı" });
  const profile = await r.json() as { id?: string; name?: string };
  if (!profile?.id || !profile?.name) return json(403, { error: "Mojang bu Minecraft hesabını doğrulamadı" });
  const id = profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

  // Bu Minecraft hesabı başka bir West hesabına bağlıysa o bağ kaldırılır (hesabın gerçek sahibi şimdi doğruladı)
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  await admin.from("mc_links").delete().eq("mc_uuid", id).neq("user_id", userId);
  const { error } = await admin.from("mc_links").upsert({ user_id: userId, mc_uuid: id, mc_name: profile.name, verified_at: new Date().toISOString() });
  if (error) return json(500, { error: "Kaydedilemedi: " + error.message });
  return json(200, { mc_uuid: id, mc_name: profile.name });
});
