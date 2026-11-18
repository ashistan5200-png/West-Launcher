// West Client — lobi için Minecraft hesabı doğrulaması (Supabase Edge Function)
//
// Akış:
//  1. Oyun, West hesabıyla lobby_verify_start() çağırır ve tek kullanımlık bir kod alır.
//  2. Oyun bu kodla Mojang oturum sunucusuna "katıldım" der (joinServer; Minecraft'ın her sunucuya
//     girerken yaptığının aynısı). Erişim anahtarı oyundan hiç çıkmaz.
//  3. Bu fonksiyon Mojang'a hasJoined ile sorar. Mojang "evet, bu oyuncu bu kodla katıldı" derse
//     Minecraft hesabı (UUID + ad) bu West hesabına bağlanır.
//
// Kurulum (bir kez):  supabase functions deploy lobby-verify
// SUPABASE_URL, SUPABASE_ANON_KEY ve SUPABASE_SERVICE_ROLE_KEY Supabase tarafından otomatik verilir;
// servis anahtarı yalnızca burada (sunucuda) kullanılır, istemciye gönderilmez.

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "Yalnızca POST" });
  const auth = req.headers.get("authorization") ?? "";
  const url = Deno.env.get("SUPABASE_URL")!;
  // Çağıranın kim olduğunu kendi oturum anahtarından öğren
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { authorization: auth } } });
  const { data: who, error: whoErr } = await asUser.auth.getUser();
  if (whoErr || !who?.user) return json(401, { error: "West hesabına giriş yapılmamış" });
  const userId = who.user.id;

  let name = "";
  try {
    name = String((await req.json())?.name ?? "");
  } catch {
    return json(400, { error: "Geçersiz istek" });
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) return json(400, { error: "Geçersiz Minecraft adı" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: v } = await admin.from("lobby_verifications").select("nonce, created_at").eq("user_id", userId).maybeSingle();
  if (!v || Date.now() - new Date(v.created_at).getTime() > 2 * 60 * 1000) {
    return json(400, { error: "Doğrulama kodunun süresi doldu, tekrar dene" });
  }
  // Kod tek kullanımlık
  await admin.from("lobby_verifications").delete().eq("user_id", userId);

  const r = await fetch(
    `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${encodeURIComponent(name)}&serverId=${encodeURIComponent(v.nonce)}`,
  );
  if (r.status !== 200) return json(403, { error: "Mojang bu Minecraft hesabını doğrulamadı" });
  const profile = await r.json() as { id?: string; name?: string };
  if (!profile?.id || !profile?.name) return json(403, { error: "Mojang bu Minecraft hesabını doğrulamadı" });
  const id = profile.id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");

  // Bu Minecraft hesabı başka bir West hesabına bağlıysa o bağ kaldırılır (hesabın gerçek sahibi şimdi doğruladı)
  await admin.from("mc_links").delete().eq("mc_uuid", id).neq("user_id", userId);
  const { error } = await admin.from("mc_links").upsert({ user_id: userId, mc_uuid: id, mc_name: profile.name, verified_at: new Date().toISOString() });
  if (error) return json(500, { error: "Kaydedilemedi" });
  return json(200, { mc_uuid: id, mc_name: profile.name });
});
