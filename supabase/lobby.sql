-- ═══════════════════════════════════════════════════════════════════════════
--  West Client — Ana menü lobisi (arkadaşlar, çevrimiçi durum, lobi, davetler)
--  Supabase → SQL Editor → bu dosyanın TAMAMINI yapıştır → Run.
--  Önce setup.sql ve social.sql çalıştırılmış olmalı. Birden fazla kez çalıştırmak güvenlidir.
--
--  Kurallar:
--  • İstemciler tablolara doğrudan yazamaz; her değişiklik aşağıdaki fonksiyonlardan geçer.
--  • Lobi için West hesabı yeterlidir. Microsoft hesabıyla oynayanların Minecraft hesabı Mojang üzerinden
--    doğrulanır (adı ve skini lobide görünür); doğrulamayı yalnızca "lobby-verify" Edge Function'ı yazar.
--  • Arkadaş = karşılıklı takipleşen ve birbirini engellememiş iki kişi.
--  • Gerçek zamanlı: kişiyi ilgilendiren her değişiklikte lobby_events'e bir satır düşer; istemci
--    Supabase Realtime (WebSocket) ile yalnızca kendi satırlarını dinler ve durumu yeniden okur.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────── Tablolar ─────────

-- Mojang ile doğrulanmış Minecraft hesabı (bir Minecraft hesabı yalnızca bir West hesabına bağlanır)
create table if not exists public.mc_links (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  mc_uuid     uuid not null unique,
  mc_name     text not null check (mc_name ~ '^[A-Za-z0-9_]{1,16}$'),
  verified_at timestamptz not null default now()
);

-- Doğrulama için tek kullanımlık kod (2 dakika geçerli)
create table if not exists public.lobby_verifications (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  nonce      text not null,
  created_at timestamptz not null default now()
);

-- Kişinin gizlilik seçimleri
create table if not exists public.lobby_settings (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  show_online boolean not null default true,   -- arkadaşlarım çevrimiçi olduğumu görsün
  show_server boolean not null default true,   -- hangi sunucuda olduğumu görsünler
  allow_join  boolean not null default true,   -- sunucuma "Katıl" ile gelebilsinler
  updated_at  timestamptz not null default now()
);

-- Oyunun bildirdiği anlık durum (oyun açıkken ~30 sn'de bir tazelenir)
create table if not exists public.lobby_presence (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  in_game      boolean not null default false,
  singleplayer boolean not null default false,
  server       text check (server is null or char_length(server) <= 255),
  server_name  text check (server_name is null or char_length(server_name) <= 64),
  updated_at   timestamptz not null default now()
);

create table if not exists public.lobbies (
  id         uuid primary key default gen_random_uuid(),
  leader_id  uuid not null unique references public.profiles(id) on delete cascade,
  privacy    text not null default 'friends' check (privacy in ('open', 'friends', 'private')),
  biome      text not null default 'snowy' check (biome in ('snowy', 'badlands', 'desert', 'cherry', 'end', 'nether')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Herkes aynı anda tek bir lobidedir
create table if not exists public.lobby_members (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  lobby_id  uuid not null references public.lobbies(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists lobby_members_lobby on public.lobby_members (lobby_id, joined_at);

create table if not exists public.lobby_invites (
  id         uuid primary key default gen_random_uuid(),
  lobby_id   uuid not null references public.lobbies(id) on delete cascade,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lobby_id, to_id)
);
create index if not exists lobby_invites_to on public.lobby_invites (to_id, created_at);

-- Katılma istekleri: davetsiz katılamayan biri lobinin liderine istek gönderir
create table if not exists public.lobby_requests (
  id         uuid primary key default gen_random_uuid(),
  lobby_id   uuid not null references public.lobbies(id) on delete cascade,
  from_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lobby_id, from_id)
);
create index if not exists lobby_requests_lobby on public.lobby_requests (lobby_id, created_at);

-- Hız sınırı kayıtları (davet, doğrulama…)
create table if not exists public.lobby_actions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action  text not null,
  at      timestamptz not null default now()
);
create index if not exists lobby_actions_user on public.lobby_actions (user_id, action, at);

-- Gerçek zamanlı bildirim: istemci yalnızca kendi satırlarını dinler
create table if not exists public.lobby_events (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  created_at timestamptz not null default now()
);
create index if not exists lobby_events_user on public.lobby_events (user_id, id);

alter table public.mc_links enable row level security;
alter table public.lobby_verifications enable row level security;
alter table public.lobby_settings enable row level security;
alter table public.lobby_presence enable row level security;
alter table public.lobbies enable row level security;
alter table public.lobby_members enable row level security;
alter table public.lobby_invites enable row level security;
alter table public.lobby_requests enable row level security;
alter table public.lobby_actions enable row level security;
alter table public.lobby_events enable row level security;

-- Doğrudan okuma yalnızca kişinin kendi satırları; yazma hiç yok (fonksiyonlar security definer)
drop policy if exists mc_links_self on public.mc_links;
create policy mc_links_self on public.mc_links for select using (user_id = auth.uid());
drop policy if exists lobby_settings_self on public.lobby_settings;
create policy lobby_settings_self on public.lobby_settings for select using (user_id = auth.uid());
drop policy if exists lobby_events_self on public.lobby_events;
create policy lobby_events_self on public.lobby_events for select using (user_id = auth.uid());

-- Realtime yayınına ekle (Supabase'de bu yayın vardır)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lobby_events') then
    execute 'alter publication supabase_realtime add table public.lobby_events';
  end if;
end $$;

-- ───────── Yardımcılar ─────────

-- İki kişi arkadaş mı (karşılıklı kabul edilmiş takip, engel yok)
create or replace function public.lobby_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select a <> b
     and exists (select 1 from follows where follower_id = a and following_id = b and status = 'accepted')
     and exists (select 1 from follows where follower_id = b and following_id = a and status = 'accepted')
     and not is_blocked(a, b);
$$;

create or replace function public.lobby_online(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select in_game and updated_at > now() - interval '90 seconds' from lobby_presence where user_id = uid), false);
$$;

create or replace function public.lobby_name(uid uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), username) from profiles where id = uid;
$$;

-- Bir kişiye "durumun değişti, yeniden oku" bildirimi
create or replace function public.lobby_touch(uid uuid, k text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into lobby_events (user_id, kind) values (uid, k);
  -- Eski bildirimleri ara sıra temizle
  if random() < 0.02 then delete from lobby_events where created_at < now() - interval '1 day'; end if;
end $$;

create or replace function public.lobby_touch_lobby(lid uuid, k text) returns void
language plpgsql security definer set search_path = public as $$
declare m uuid;
begin
  for m in select user_id from lobby_members where lobby_id = lid loop
    perform lobby_touch(m, k);
  end loop;
end $$;

-- Hız sınırı: son `secs` saniyede `action` en fazla `max_count` kez
create or replace function public.lobby_rate(uid uuid, act text, max_count int, secs int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from lobby_actions where user_id = uid and action = act and at > now() - make_interval(secs => secs)) >= max_count then
    raise exception 'Çok hızlı: biraz bekleyip tekrar dene';
  end if;
  insert into lobby_actions (user_id, action) values (uid, act);
  if random() < 0.05 then delete from lobby_actions where at < now() - interval '1 hour'; end if;
end $$;

create or replace function public.lobby_require() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  -- West hesabı (e-posta + şifre) yeterli; Mojang ile doğrulanmış Minecraft hesabı varsa adı ve skini kullanılır
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  return me;
end $$;

-- Kişiyi kendi (yeni) lobisine taşı; eski lobide lider idiyse liderlik en eski üyeye geçer
create or replace function public.lobby_move_home(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  old_lobby uuid;
  heir uuid;
  home uuid;
begin
  select lobby_id into old_lobby from lobby_members where user_id = uid;
  if old_lobby is not null and (select leader_id from lobbies where id = old_lobby) = uid then
    select user_id into heir from lobby_members where lobby_id = old_lobby and user_id <> uid order by joined_at limit 1;
    if heir is null then
      -- Lobide tek başına: zaten kendi lobisi
      return old_lobby;
    end if;
    delete from lobby_members where user_id = uid;
    -- Varisin kendi eski lobisi (boş olmalı) silinir, liderlik devredilir
    delete from lobbies where leader_id = heir and id <> old_lobby;
    update lobbies set leader_id = heir, updated_at = now() where id = old_lobby;
    perform lobby_touch_lobby(old_lobby, 'leader');
  elsif old_lobby is not null then
    delete from lobby_members where user_id = uid;
    perform lobby_touch_lobby(old_lobby, 'left');
  end if;
  insert into lobbies (leader_id) values (uid)
    on conflict (leader_id) do update set updated_at = now()
    returning id into home;
  insert into lobby_members (user_id, lobby_id) values (uid, home)
    on conflict (user_id) do update set lobby_id = excluded.lobby_id, joined_at = now();
  perform lobby_touch(uid, 'moved');
  return home;
end $$;

-- Kişinin şu anki lobisi (yoksa kendi lobisi kurulur)
create or replace function public.lobby_of(uid uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  select lobby_id into lid from lobby_members where user_id = uid;
  if lid is null then lid := lobby_move_home(uid); end if;
  return lid;
end $$;

-- Kişiyi bir lobiye al (doluluk ve engel denetimiyle)
create or replace function public.lobby_enter(uid uuid, lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  leader uuid;
  old_lobby uuid;
begin
  select leader_id into leader from lobbies where id = lid;
  if leader is null then raise exception 'Lobi artık yok'; end if;
  if exists (select 1 from lobby_members where user_id = uid and lobby_id = lid) then return; end if;
  if (select count(*) from lobby_members where lobby_id = lid) >= 7 then raise exception 'Lobi dolu (7/7)'; end if;
  if exists (select 1 from lobby_members m where m.lobby_id = lid and is_blocked(uid, m.user_id)) then
    raise exception 'Bu lobiye katılamazsın';
  end if;
  -- Önce eski lobiden düzgünce çık (liderlik devri dahil), sonra yeni lobiye geç
  select lobby_id into old_lobby from lobby_members where user_id = uid;
  if old_lobby is not null then
    perform lobby_move_home(uid);
    -- Kendi boş lobisi gereksiz: sil
    delete from lobbies where leader_id = uid and id <> lid and not exists (select 1 from lobby_members m where m.lobby_id = lobbies.id and m.user_id <> uid);
  end if;
  insert into lobby_members (user_id, lobby_id) values (uid, lid)
    on conflict (user_id) do update set lobby_id = excluded.lobby_id, joined_at = now();
  delete from lobby_invites where to_id = uid and lobby_id = lid;
  perform lobby_touch_lobby(lid, 'joined');
end $$;

-- Ben bu lobiye davetsiz katılabilir miyim?
create or replace function public.lobby_can_join(me uuid, lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case (select privacy from lobbies where id = lid)
    when 'open' then exists (select 1 from lobby_members m where m.lobby_id = lid and lobby_friends(me, m.user_id))
    when 'friends' then lobby_friends(me, (select leader_id from lobbies where id = lid))
    else false
  end
  and (select count(*) from lobby_members where lobby_id = lid) < 7
  and not exists (select 1 from lobby_members m where m.lobby_id = lid and is_blocked(me, m.user_id));
$$;

-- Bir kişinin, bakan kişiye gösterilecek durumu (gizlilik seçimlerine göre süzülmüş)
create or replace function public.lobby_person(viewer uuid, uid uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s lobby_settings;
  p lobby_presence;
  l mc_links;
  online boolean;
  self boolean := viewer = uid;
begin
  select * into s from lobby_settings where user_id = uid;
  select * into p from lobby_presence where user_id = uid;
  select * into l from mc_links where user_id = uid;
  online := lobby_online(uid) and (self or coalesce(s.show_online, true));
  return jsonb_build_object(
    'id', uid,
    'name', lobby_name(uid),
    'mc_uuid', l.mc_uuid,
    'mc_name', l.mc_name,
    'online', online,
    'singleplayer', online and coalesce(p.singleplayer, false),
    'server', case when online and (self or coalesce(s.show_server, true)) and not coalesce(p.singleplayer, false) then p.server end,
    'server_name', case when online and (self or coalesce(s.show_server, true)) and not coalesce(p.singleplayer, false) then p.server_name end,
    'joinable', online and not self and coalesce(s.show_server, true) and coalesce(s.allow_join, true)
                and not coalesce(p.singleplayer, false) and p.server is not null
  );
end $$;

-- ───────── İstemcinin çağırdığı fonksiyonlar ─────────

-- Doğrulama kodu: oyun bu kodla Mojang'a "katıldım" der, Edge Function hasJoined ile kontrol eder
create or replace function public.lobby_verify_start() returns text
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  -- gen_random_uuid yerleşik (Supabase'te pgcrypto 'extensions' şemasında olduğundan ona bağlı kalınmaz)
  n text := replace(gen_random_uuid()::text, '-', '');
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  perform lobby_rate(me, 'verify', 6, 300);
  insert into lobby_verifications (user_id, nonce) values (me, n)
    on conflict (user_id) do update set nonce = excluded.nonce, created_at = now();
  return n;
end $$;

-- Edge Function için: çağıranın (auth.uid) geçerli doğrulama kodunu bir kez verir ve siler
create or replace function public.lobby_verify_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  v lobby_verifications;
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  delete from lobby_verifications where user_id = me returning * into v;
  if v.user_id is null or v.created_at < now() - interval '2 minutes' then
    raise exception 'Doğrulama kodunun süresi doldu, tekrar dene';
  end if;
  return jsonb_build_object('user_id', v.user_id, 'nonce', v.nonce);
end $$;

-- Lobinin ve arkadaşların tüm durumu (tek istekte)
create or replace function public.lobby_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  linked boolean;
  lid uuid;
  lob lobbies;
  members jsonb;
  friends jsonb;
  invites jsonb;
  requests jsonb;
  st lobby_settings;
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  linked := exists (select 1 from mc_links where user_id = me);
  select * into st from lobby_settings where user_id = me;
  lid := lobby_of(me);
  select * into lob from lobbies where id = lid;
  select coalesce(jsonb_agg(lobby_person(me, m.user_id) || jsonb_build_object('leader', m.user_id = lob.leader_id) order by m.joined_at), '[]'::jsonb)
    into members from lobby_members m where m.lobby_id = lid;
  select coalesce(jsonb_agg(f.p order by (f.p->>'online')::boolean desc, f.p->>'name'), '[]'::jsonb) into friends from (
    select lobby_person(me, a.following_id)
           || jsonb_build_object(
                'in_my_lobby', exists (select 1 from lobby_members x where x.user_id = a.following_id and x.lobby_id = lid),
                'verified', exists (select 1 from mc_links x where x.user_id = a.following_id),
                'lobby_id', (select x.lobby_id from lobby_members x where x.user_id = a.following_id),
                'lobby_requested', exists (select 1 from lobby_requests q join lobby_members x on x.lobby_id = q.lobby_id
                    where x.user_id = a.following_id and q.from_id = me and q.created_at > now() - interval '10 minutes'),
                'lobby_joinable', lobby_online(a.following_id)
                    and coalesce((select show_online from lobby_settings where user_id = a.following_id), true)
                    and exists (select 1 from lobby_members x where x.user_id = a.following_id and x.lobby_id <> lid and lobby_can_join(me, x.lobby_id))
              ) as p
      from follows a
     where a.follower_id = me and a.status = 'accepted' and lobby_friends(me, a.following_id)
  ) f;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'from_id', i.from_id, 'from_name', lobby_name(i.from_id), 'lobby_id', i.lobby_id,
           'leader_name', lobby_name((select leader_id from lobbies where id = i.lobby_id)), 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
    into invites from lobby_invites i
   where i.to_id = me and i.created_at > now() - interval '10 minutes' and not is_blocked(me, i.from_id);
  -- Liderse: lobisine gelen katılma istekleri
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'from_id', q.from_id, 'from_name', lobby_name(q.from_id),
           'mc_name', (select mc_name from mc_links where user_id = q.from_id), 'created_at', q.created_at) order by q.created_at), '[]'::jsonb)
    into requests from lobby_requests q
   where q.lobby_id = lid and lob.leader_id = me and q.created_at > now() - interval '10 minutes' and not is_blocked(me, q.from_id);
  return jsonb_build_object(
    'verified', linked,
    'me', lobby_person(me, me),
    'lobby', jsonb_build_object('id', lob.id, 'leader_id', lob.leader_id, 'leader_name', lobby_name(lob.leader_id), 'privacy', lob.privacy, 'biome', lob.biome, 'members', members),
    'friends', friends,
    'invites', invites,
    'requests', requests,
    'settings', jsonb_build_object('show_online', coalesce(st.show_online, true), 'show_server', coalesce(st.show_server, true), 'allow_join', coalesce(st.allow_join, true))
  );
end $$;

create or replace function public.lobby_invite(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  lid uuid := lobby_of(me);
begin
  if not lobby_friends(me, target) then raise exception 'Yalnızca arkadaşlarını davet edebilirsin'; end if;
  if exists (select 1 from lobby_members where user_id = target and lobby_id = lid) then raise exception 'Zaten lobide'; end if;
  if (select count(*) from lobby_members where lobby_id = lid) >= 7 then raise exception 'Lobi dolu (7/7)'; end if;
  if exists (select 1 from lobby_invites where lobby_id = lid and to_id = target and created_at > now() - interval '30 seconds') then
    raise exception 'Bu kişiyi az önce davet ettin';
  end if;
  perform lobby_rate(me, 'invite', 8, 60);
  insert into lobby_invites (lobby_id, from_id, to_id) values (lid, me, target)
    on conflict (lobby_id, to_id) do update set from_id = excluded.from_id, created_at = now();
  perform lobby_touch(target, 'invite');
end $$;

create or replace function public.lobby_accept(invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  inv lobby_invites;
begin
  select * into inv from lobby_invites where id = invite and to_id = me;
  if inv.id is null or inv.created_at < now() - interval '10 minutes' then raise exception 'Davetin süresi dolmuş'; end if;
  if is_blocked(me, inv.from_id) then raise exception 'Bu daveti kabul edemezsin'; end if;
  perform lobby_rate(me, 'move', 20, 60);
  perform lobby_enter(me, inv.lobby_id);
  delete from lobby_invites where id = invite;
end $$;

create or replace function public.lobby_decline(invite uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  sender uuid;
begin
  delete from lobby_invites where id = invite and to_id = me returning from_id into sender;
  if sender is not null then perform lobby_touch(sender, 'declined'); end if;
  perform lobby_touch(me, 'declined');
end $$;

-- Davetsiz katıl (lobinin gizliliği izin veriyorsa)
create or replace function public.lobby_join(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := lobby_require();
begin
  if not lobby_can_join(me, lid) then raise exception 'Bu lobiye davetsiz katılamazsın'; end if;
  perform lobby_rate(me, 'move', 20, 60);
  perform lobby_enter(me, lid);
end $$;

create or replace function public.lobby_leave() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := lobby_require();
begin
  perform lobby_rate(me, 'move', 20, 60);
  perform lobby_move_home(me);
end $$;

create or replace function public.lobby_kick(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  lid uuid := lobby_of(me);
begin
  if (select leader_id from lobbies where id = lid) <> me then raise exception 'Yalnızca lobi lideri çıkarabilir'; end if;
  if target = me or not exists (select 1 from lobby_members where user_id = target and lobby_id = lid) then return; end if;
  perform lobby_move_home(target);
  perform lobby_touch(target, 'kicked');
  perform lobby_touch_lobby(lid, 'left');
end $$;

create or replace function public.lobby_set_privacy(p text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  lid uuid := lobby_of(me);
begin
  if p not in ('open', 'friends', 'private') then raise exception 'Geçersiz gizlilik'; end if;
  update lobbies set privacy = p, updated_at = now() where id = lid and leader_id = me;
  if not found then raise exception 'Yalnızca lobi lideri değiştirebilir'; end if;
  perform lobby_touch_lobby(lid, 'privacy');
end $$;

create or replace function public.lobby_set_biome(b text) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  lid uuid := lobby_of(me);
begin
  update lobbies set biome = b, updated_at = now() where id = lid and leader_id = me;
  if not found then raise exception 'Biyomu lobi lideri seçer'; end if;
  perform lobby_touch_lobby(lid, 'biome');
end $$;

-- Oyunun durumu. Yalnızca gerçekten değiştiğinde arkadaşlara ve lobiye bildirilir.
create or replace function public.lobby_presence_set(in_game boolean, singleplayer boolean, server text default null, server_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  old lobby_presence;
  was_online boolean;
  changed boolean;
  f uuid;
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  if server is not null and char_length(server) > 255 then server := left(server, 255); end if;
  if server_name is not null and char_length(server_name) > 64 then server_name := left(server_name, 64); end if;
  if singleplayer then server := null; server_name := null; end if;
  select * into old from lobby_presence where user_id = me;
  was_online := lobby_online(me);
  insert into lobby_presence (user_id, in_game, singleplayer, server, server_name, updated_at)
    values (me, in_game, singleplayer, server, server_name, now())
    on conflict (user_id) do update set in_game = excluded.in_game, singleplayer = excluded.singleplayer,
      server = excluded.server, server_name = excluded.server_name, updated_at = now();
  changed := not was_online or old.user_id is null or old.in_game is distinct from in_game
             or old.singleplayer is distinct from singleplayer or old.server is distinct from server;
  if changed and exists (select 1 from mc_links where user_id = me) then
    perform lobby_touch_lobby((select lobby_id from lobby_members where user_id = me), 'presence');
    for f in select a.following_id from follows a where a.follower_id = me and a.status = 'accepted' and lobby_friends(me, a.following_id) and lobby_online(a.following_id) loop
      perform lobby_touch(f, 'presence');
    end loop;
  end if;
end $$;

create or replace function public.lobby_settings_set(show_online boolean, show_server boolean, allow_join boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  f uuid;
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  insert into lobby_settings (user_id, show_online, show_server, allow_join, updated_at)
    values (me, show_online, show_server, allow_join, now())
    on conflict (user_id) do update set show_online = excluded.show_online, show_server = excluded.show_server,
      allow_join = excluded.allow_join, updated_at = now();
  for f in select a.following_id from follows a where a.follower_id = me and a.status = 'accepted' and lobby_friends(me, a.following_id) and lobby_online(a.following_id) loop
    perform lobby_touch(f, 'presence');
  end loop;
end $$;

-- Engelle: davetler silinir, aynı lobideyse ayrılırlar
create or replace function public.lobby_block(target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lid uuid;
begin
  if me is null or target is null or target = me then raise exception 'Geçersiz kişi'; end if;
  insert into blocks (blocker_id, blocked_id) values (me, target) on conflict do nothing;
  delete from lobby_invites where (from_id = me and to_id = target) or (from_id = target and to_id = me);
  delete from lobby_requests where from_id = target and lobby_id in (select id from lobbies where leader_id = me);
  select lobby_id into lid from lobby_members where user_id = me;
  if lid is not null and exists (select 1 from lobby_members where user_id = target and lobby_id = lid) then
    if (select leader_id from lobbies where id = lid) = me then perform lobby_move_home(target);
    else perform lobby_move_home(me);
    end if;
  end if;
  perform lobby_touch(target, 'presence');
  perform lobby_touch(me, 'presence');
end $$;

-- Lobi verilerimin hepsini sil (Minecraft bağlantısı, durum, ayarlar, lobi, davetler, bildirimler)
create or replace function public.lobby_delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  lid uuid;
begin
  if me is null then raise exception 'West hesabına giriş yapılmamış'; end if;
  select lobby_id into lid from lobby_members where user_id = me;
  if lid is not null then
    perform lobby_move_home(me);
  end if;
  delete from lobby_members where user_id = me;
  delete from lobbies where leader_id = me;
  delete from lobby_invites where from_id = me or to_id = me;
  delete from lobby_requests where from_id = me;
  delete from lobby_presence where user_id = me;
  delete from lobby_settings where user_id = me;
  delete from lobby_verifications where user_id = me;
  delete from lobby_actions where user_id = me;
  delete from lobby_events where user_id = me;
  delete from mc_links where user_id = me;
end $$;

-- Katılma isteği: lobideki bir arkadaşın lobisine (davetsiz katılamıyorsan) istek gönder
create or replace function public.lobby_request_join(lid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  leader uuid;
begin
  select leader_id into leader from lobbies where id = lid;
  if leader is null then raise exception 'Lobi artık yok'; end if;
  if exists (select 1 from lobby_members where user_id = me and lobby_id = lid) then raise exception 'Zaten bu lobidesin'; end if;
  if not exists (select 1 from lobby_members m where m.lobby_id = lid and lobby_friends(me, m.user_id)) then
    raise exception 'Yalnızca arkadaşlarının lobisine istek gönderebilirsin';
  end if;
  if exists (select 1 from lobby_members m where m.lobby_id = lid and is_blocked(me, m.user_id)) then raise exception 'Bu lobiye katılamazsın'; end if;
  if (select count(*) from lobby_members where lobby_id = lid) >= 7 then raise exception 'Lobi dolu (7/7)'; end if;
  if exists (select 1 from lobby_requests where lobby_id = lid and from_id = me and created_at > now() - interval '30 seconds') then
    raise exception 'İsteği az önce gönderdin';
  end if;
  perform lobby_rate(me, 'request', 6, 60);
  insert into lobby_requests (lobby_id, from_id) values (lid, me)
    on conflict (lobby_id, from_id) do update set created_at = now();
  perform lobby_touch(leader, 'request');
  perform lobby_touch(me, 'request');
end $$;

-- Lider isteği yanıtlar: kabul ederse istek sahibi lobiye ışınlanır
create or replace function public.lobby_request_answer(req uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := lobby_require();
  r lobby_requests;
begin
  select * into r from lobby_requests where id = req;
  if r.id is null then raise exception 'İstek artık yok'; end if;
  if (select leader_id from lobbies where id = r.lobby_id) <> me then raise exception 'Yalnızca lobi lideri yanıtlayabilir'; end if;
  delete from lobby_requests where id = req;
  if accept then
    if r.created_at < now() - interval '10 minutes' then raise exception 'İsteğin süresi dolmuş'; end if;
    perform lobby_enter(r.from_id, r.lobby_id);
  end if;
  perform lobby_touch(r.from_id, case when accept then 'request-accepted' else 'request-declined' end);
  perform lobby_touch(me, 'request');
end $$;

-- ───────── Yetkiler ─────────
revoke all on public.mc_links, public.lobby_verifications, public.lobby_settings, public.lobby_presence, public.lobbies,
  public.lobby_members, public.lobby_invites, public.lobby_requests, public.lobby_actions from anon, authenticated;
revoke all on public.lobby_events from anon, authenticated;
grant select on public.lobby_events, public.mc_links, public.lobby_settings to authenticated;

do $$
declare f text;
begin
  -- İç yardımcılar dışarıdan çağrılamasın
  foreach f in array array['lobby_touch(uuid,text)', 'lobby_touch_lobby(uuid,text)', 'lobby_rate(uuid,text,integer,integer)', 'lobby_move_home(uuid)',
                           'lobby_of(uuid)', 'lobby_enter(uuid,uuid)', 'lobby_person(uuid,uuid)', 'lobby_can_join(uuid,uuid)', 'lobby_require()',
                           'lobby_friends(uuid,uuid)', 'lobby_online(uuid)', 'lobby_name(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['lobby_verify_start()', 'lobby_verify_claim()', 'lobby_state()', 'lobby_invite(uuid)', 'lobby_accept(uuid)', 'lobby_decline(uuid)', 'lobby_join(uuid)', 'lobby_request_join(uuid)', 'lobby_request_answer(uuid,boolean)',
                           'lobby_leave()', 'lobby_kick(uuid)', 'lobby_set_privacy(text)', 'lobby_set_biome(text)',
                           'lobby_presence_set(boolean,boolean,text,text)', 'lobby_settings_set(boolean,boolean,boolean)', 'lobby_block(uuid)',
                           'lobby_delete_my_data()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
