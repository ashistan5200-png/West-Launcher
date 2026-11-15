-- ═══════════════════════════════════════════════════════════════════════════
--  West Client — West Profili ve sosyal ağ (X + Instagram benzeri)
--  Supabase → SQL Editor → New query → bu dosyanın TAMAMINI yapıştır → Run.
--  Önce setup.sql çalıştırılmış olmalı. Birden fazla kez çalıştırmak güvenlidir.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ───────── Profil ─────────
alter table public.profiles add column if not exists display_name text check (char_length(display_name) <= 40);
alter table public.profiles add column if not exists bio text check (char_length(bio) <= 300);
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists banner_url text;
alter table public.profiles add column if not exists website text check (char_length(website) <= 200);
alter table public.profiles add column if not exists location text check (char_length(location) <= 40);
alter table public.profiles add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists mc_username text check (char_length(mc_username) <= 16);
alter table public.profiles add column if not exists is_private boolean not null default false;
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.profiles add column if not exists allow_dms text not null default 'everyone' check (allow_dms in ('everyone', 'followers', 'none'));
alter table public.profiles add column if not exists pinned_post_id uuid;
alter table public.profiles add column if not exists followers_count int not null default 0;
alter table public.profiles add column if not exists following_count int not null default 0;
alter table public.profiles add column if not exists posts_count int not null default 0;

-- Kullanıcı "doğrulanmış" rozetini ve sayaçları kendisi değiştiremez
create or replace function public.protect_profile() returns trigger language plpgsql as $$
begin
  -- Doğrudan kullanıcı isteği (sayaçları güncelleyen iç fonksiyonlar değil)
  if current_user in ('authenticated', 'anon') then
    new.verified := old.verified;
    new.followers_count := old.followers_count;
    new.following_count := old.following_count;
    new.posts_count := old.posts_count;
    new.id := old.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles for each row execute procedure public.protect_profile();

-- ───────── Engelleme / sessize alma / takip ─────────
create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create table if not exists public.mutes (
  muter_id uuid not null references public.profiles(id) on delete cascade,
  muted_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  check (muter_id <> muted_id)
);
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);
create index if not exists follows_following on public.follows (following_id, status);

-- İkisinden biri diğerini engellediyse true
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- Görüntüleyen (auth.uid()) bu kişinin gönderilerini görebilir mi?
create or replace function public.can_see(author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() = author then true
    when auth.uid() is not null and is_blocked(auth.uid(), author) then false
    when not coalesce((select is_private from profiles where id = author), false) then true
    when auth.uid() is null then false
    else exists (select 1 from follows where follower_id = auth.uid() and following_id = author and status = 'accepted')
  end;
$$;

-- Gizli hesaba takip isteği "beklemede" başlar; engelliyken takip edilemez
create or replace function public.follow_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_blocked(new.follower_id, new.following_id) then
    raise exception 'Bu kullanıcıyı takip edemezsin';
  end if;
  if tg_op = 'INSERT' then
    new.status := case when (select is_private from profiles where id = new.following_id) then 'pending' else 'accepted' end;
  end if;
  return new;
end $$;
drop trigger if exists follows_before on public.follows;
create trigger follows_before before insert on public.follows for each row execute procedure public.follow_before();

-- Güncellemede yalnızca "beklemede → kabul" değişebilir; kimlikler kilitli
create or replace function public.follow_lock() returns trigger language plpgsql as $$
begin
  new.follower_id := old.follower_id;
  new.following_id := old.following_id;
  new.created_at := old.created_at;
  if new.status <> 'accepted' then new.status := old.status; end if;
  return new;
end $$;
drop trigger if exists follows_lock on public.follows;
create trigger follows_lock before update on public.follows for each row execute procedure public.follow_lock();

-- ───────── Gönderiler ─────────
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text check (char_length(body) <= 500),
  -- [{ "url": "...", "w": 1280, "h": 720, "alt": "..." }] en fazla 4
  media jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4),
  reply_to uuid references public.posts(id) on delete set null,
  root_id uuid references public.posts(id) on delete set null,
  repost_of uuid references public.posts(id) on delete cascade,
  quote_of uuid references public.posts(id) on delete set null,
  audience text not null default 'everyone' check (audience in ('everyone', 'followers')),
  reply_policy text not null default 'everyone' check (reply_policy in ('everyone', 'following', 'mentioned')),
  tags text[] not null default '{}',
  mentions text[] not null default '{}',
  like_count int not null default 0,
  reply_count int not null default 0,
  repost_count int not null default 0,
  quote_count int not null default 0,
  bookmark_count int not null default 0,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  -- Boş gönderi olmasın: metin, görsel, yeniden paylaşım ya da alıntıdan biri
  check (coalesce(char_length(trim(body)), 0) > 0 or jsonb_array_length(media) > 0 or repost_of is not null)
);
create index if not exists posts_author_created on public.posts (author_id, created_at desc);
create index if not exists posts_created on public.posts (created_at desc);
create index if not exists posts_reply_to on public.posts (reply_to, created_at);
create index if not exists posts_tags on public.posts using gin (tags);
create unique index if not exists posts_one_repost on public.posts (author_id, repost_of) where repost_of is not null and body is null;

-- Doğrudan istemci isteği mi? (iç sayaç güncellemeleri security definer fonksiyonlardan gelir)
create or replace function public.current_user_is_client() returns boolean language sql stable as $$
  select coalesce(current_setting('west.internal', true), '') <> '1';
$$;

-- Etiketler (#minecraft) ve bahsetmeler (@ashi) metinden çıkarılır; zincir kökü ayarlanır
create or replace function public.post_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare parent posts%rowtype;
begin
  new.tags := coalesce(array(select distinct lower(m[1]) from regexp_matches(coalesce(new.body, ''), '#([[:alnum:]_ğüşıöçĞÜŞİÖÇ]{1,40})', 'g') as m), '{}');
  new.mentions := coalesce(array(select distinct lower(m[1]) from regexp_matches(coalesce(new.body, ''), '@([A-Za-z0-9_]{3,16})', 'g') as m), '{}');
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.like_count := 0; new.reply_count := 0; new.repost_count := 0; new.quote_count := 0; new.bookmark_count := 0; new.view_count := 0;
    if new.reply_to is not null then
      select * into parent from posts where id = new.reply_to;
      if not found or not can_see(parent.author_id) then raise exception 'Bu gönderiye yanıt verilemez'; end if;
      if parent.reply_policy = 'following' and parent.author_id <> auth.uid()
         and not exists (select 1 from follows where follower_id = parent.author_id and following_id = auth.uid() and status = 'accepted') then
        raise exception 'Yalnızca yazarın takip ettiği kişiler yanıt verebilir';
      end if;
      if parent.reply_policy = 'mentioned' and parent.author_id <> auth.uid()
         and not (lower((select username from profiles where id = auth.uid())) = any(parent.mentions)) then
        raise exception 'Yalnızca bahsedilen kişiler yanıt verebilir';
      end if;
      new.root_id := coalesce(parent.root_id, parent.id);
    end if;
    if new.repost_of is not null and not can_see((select author_id from posts where id = new.repost_of)) then
      raise exception 'Bu gönderi paylaşılamaz';
    end if;
  elsif session_user is not null and current_user_is_client() then
    new.author_id := old.author_id; new.created_at := old.created_at; new.reply_to := old.reply_to; new.root_id := old.root_id;
    new.repost_of := old.repost_of; new.quote_of := old.quote_of;
    new.like_count := old.like_count; new.reply_count := old.reply_count; new.repost_count := old.repost_count;
    new.quote_count := old.quote_count; new.bookmark_count := old.bookmark_count; new.view_count := old.view_count;
    if new.body is distinct from old.body or new.media is distinct from old.media then new.edited_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists posts_before on public.posts;
create trigger posts_before before insert or update on public.posts for each row execute procedure public.post_before();

-- ───────── Beğeni / yer imi / anket ─────────
create table if not exists public.likes (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists likes_post on public.likes (post_id);
create table if not exists public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create table if not exists public.polls (
  post_id uuid primary key references public.posts(id) on delete cascade,
  options text[] not null check (array_length(options, 1) between 2 and 4),
  ends_at timestamptz not null
);
create table if not exists public.poll_votes (
  post_id uuid not null references public.polls(post_id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  option int not null check (option between 0 and 3),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ───────── Bildirimler ─────────
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('like', 'reply', 'repost', 'quote', 'mention', 'follow', 'follow_request', 'follow_accept', 'message', 'poll_vote')),
  post_id uuid references public.posts(id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);

create or replace function public.notify(recipient uuid, actor uuid, kind text, post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if recipient is null or recipient = actor or is_blocked(recipient, actor)
     or exists (select 1 from mutes where muter_id = recipient and muted_id = actor) then
    return;
  end if;
  insert into notifications (user_id, actor_id, type, post_id) values (recipient, actor, kind, post);
end $$;

-- Sayaçlar ve bildirimler tek yerde
create or replace function public.post_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare m text; target uuid;
begin
  perform set_config('west.internal', '1', true);
  if tg_op = 'INSERT' then
    update profiles set posts_count = posts_count + 1 where id = new.author_id;
    if new.reply_to is not null then
      update posts set reply_count = reply_count + 1 where id = new.reply_to;
      perform notify((select author_id from posts where id = new.reply_to), new.author_id, 'reply', new.id);
    end if;
    if new.repost_of is not null and new.body is null then
      update posts set repost_count = repost_count + 1 where id = new.repost_of;
      perform notify((select author_id from posts where id = new.repost_of), new.author_id, 'repost', new.repost_of);
    end if;
    if new.quote_of is not null then
      update posts set quote_count = quote_count + 1 where id = new.quote_of;
      perform notify((select author_id from posts where id = new.quote_of), new.author_id, 'quote', new.id);
    end if;
    foreach m in array new.mentions loop
      select id into target from profiles where lower(username) = m;
      perform notify(target, new.author_id, 'mention', new.id);
    end loop;
  elsif tg_op = 'DELETE' then
    update profiles set posts_count = greatest(posts_count - 1, 0) where id = old.author_id;
    if old.reply_to is not null then update posts set reply_count = greatest(reply_count - 1, 0) where id = old.reply_to; end if;
    if old.repost_of is not null and old.body is null then update posts set repost_count = greatest(repost_count - 1, 0) where id = old.repost_of; end if;
    if old.quote_of is not null then update posts set quote_count = greatest(quote_count - 1, 0) where id = old.quote_of; end if;
  end if;
  perform set_config('west.internal', '', true);
  return null;
end $$;
drop trigger if exists posts_after on public.posts;
create trigger posts_after after insert or delete on public.posts for each row execute procedure public.post_after();

create or replace function public.like_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('west.internal', '1', true);
  if tg_op = 'INSERT' then
    update posts set like_count = like_count + 1 where id = new.post_id;
    perform notify((select author_id from posts where id = new.post_id), new.user_id, 'like', new.post_id);
  else
    update posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  perform set_config('west.internal', '', true);
  return null;
end $$;
drop trigger if exists likes_after on public.likes;
create trigger likes_after after insert or delete on public.likes for each row execute procedure public.like_after();

create or replace function public.bookmark_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('west.internal', '1', true);
  if tg_op = 'INSERT' then update posts set bookmark_count = bookmark_count + 1 where id = new.post_id;
  else update posts set bookmark_count = greatest(bookmark_count - 1, 0) where id = old.post_id; end if;
  perform set_config('west.internal', '', true);
  return null;
end $$;
drop trigger if exists bookmarks_after on public.bookmarks;
create trigger bookmarks_after after insert or delete on public.bookmarks for each row execute procedure public.bookmark_after();

create or replace function public.follow_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('west.internal', '1', true);
  if tg_op = 'INSERT' then
    if new.status = 'accepted' then
      update profiles set followers_count = followers_count + 1 where id = new.following_id;
      update profiles set following_count = following_count + 1 where id = new.follower_id;
      perform notify(new.following_id, new.follower_id, 'follow', null);
    else
      perform notify(new.following_id, new.follower_id, 'follow_request', null);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status = 'pending' and new.status = 'accepted' then
      update profiles set followers_count = followers_count + 1 where id = new.following_id;
      update profiles set following_count = following_count + 1 where id = new.follower_id;
      perform notify(new.follower_id, new.following_id, 'follow_accept', null);
    end if;
  elsif tg_op = 'DELETE' then
    if old.status = 'accepted' then
      update profiles set followers_count = greatest(followers_count - 1, 0) where id = old.following_id;
      update profiles set following_count = greatest(following_count - 1, 0) where id = old.follower_id;
    end if;
  end if;
  perform set_config('west.internal', '', true);
  return null;
end $$;
drop trigger if exists follows_after on public.follows;
create trigger follows_after after insert or update or delete on public.follows for each row execute procedure public.follow_after();

-- Engellenince karşılıklı takipler kalkar
create or replace function public.block_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from follows where (follower_id = new.blocker_id and following_id = new.blocked_id) or (follower_id = new.blocked_id and following_id = new.blocker_id);
  return null;
end $$;
drop trigger if exists blocks_after on public.blocks;
create trigger blocks_after after insert on public.blocks for each row execute procedure public.block_after();

-- ───────── Mesajlar (DM) ─────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  title text check (char_length(title) <= 60),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conv_members_user on public.conversation_members (user_id);
-- Üyelik satırında yalnızca "okundu" zamanı güncellenebilir
create or replace function public.member_lock() returns trigger language plpgsql as $$
begin
  new.conversation_id := old.conversation_id;
  new.user_id := old.user_id;
  return new;
end $$;
drop trigger if exists conv_members_lock on public.conversation_members;
create trigger conv_members_lock before update on public.conversation_members for each row execute procedure public.member_lock();
-- Bildirimde yalnızca "okundu" değişebilir
create or replace function public.notification_lock() returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id; new.actor_id := old.actor_id; new.type := old.type; new.post_id := old.post_id; new.created_at := old.created_at;
  return new;
end $$;
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body text check (char_length(body) <= 2000),
  media jsonb not null default '[]'::jsonb,
  reply_to uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  check (coalesce(char_length(trim(body)), 0) > 0 or jsonb_array_length(media) > 0)
);
create index if not exists messages_conv on public.messages (conversation_id, created_at desc);

create or replace function public.is_member(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = conv and user_id = auth.uid());
$$;

-- İki kişilik sohbeti bul ya da başlat (engel ve DM ayarı kontrol edilir)
create or replace function public.start_dm(other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare conv uuid; pref text;
begin
  if auth.uid() is null or other = auth.uid() then raise exception 'Geçersiz'; end if;
  if is_blocked(auth.uid(), other) then raise exception 'Bu kullanıcıya mesaj gönderilemez'; end if;
  select c.id into conv from conversations c
    join conversation_members a on a.conversation_id = c.id and a.user_id = auth.uid()
    join conversation_members b on b.conversation_id = c.id and b.user_id = other
    where not c.is_group limit 1;
  if conv is not null then return conv; end if;
  select allow_dms into pref from profiles where id = other;
  -- 'followers' = alıcının takip ettiği kişiler mesaj atabilir
  if pref = 'none' or (pref = 'followers' and not exists (select 1 from follows where follower_id = other and following_id = auth.uid() and status = 'accepted')) then
    raise exception 'Bu kullanıcı mesaj kabul etmiyor';
  end if;
  insert into conversations default values returning id into conv;
  insert into conversation_members (conversation_id, user_id) values (conv, auth.uid()), (conv, other);
  return conv;
end $$;

create or replace function public.message_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  for r in select user_id from conversation_members where conversation_id = new.conversation_id and user_id <> new.sender_id loop
    perform notify(r, new.sender_id, 'message', null);
  end loop;
  return null;
end $$;
drop trigger if exists messages_after on public.messages;
create trigger messages_after after insert on public.messages for each row execute procedure public.message_after();

-- ───────── Hikâyeler (24 saat) ─────────
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  media_url text not null,
  caption text check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists stories_author on public.stories (author_id, created_at desc);
create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  viewed_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

-- ───────── Şikâyetler ─────────
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  target_type text not null check (target_type in ('post', 'profile', 'message', 'story')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  created_at timestamptz not null default now()
);

-- ───────── Satır güvenliği (RLS) ─────────
alter table public.blocks enable row level security;
alter table public.mutes enable row level security;
alter table public.follows enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.bookmarks enable row level security;
alter table public.polls enable row level security;
alter table public.poll_votes enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.reports enable row level security;

do $$
declare t text;
begin
  -- Eski politikaları temizle (dosya tekrar çalıştırılabilsin)
  for t in select format('drop policy if exists %I on %I.%I', policyname, schemaname, tablename) from pg_policies
    where schemaname = 'public' and tablename in ('blocks','mutes','follows','posts','likes','bookmarks','polls','poll_votes','notifications','conversations','conversation_members','messages','stories','story_views','reports')
  loop execute t; end loop;
end $$;

create policy "blocks: kendi" on public.blocks for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
create policy "mutes: kendi" on public.mutes for all using (muter_id = auth.uid()) with check (muter_id = auth.uid());

create policy "follows: görünür" on public.follows for select using (status = 'accepted' or follower_id = auth.uid() or following_id = auth.uid());
create policy "follows: takip et" on public.follows for insert with check (follower_id = auth.uid());
create policy "follows: isteği kabul et" on public.follows for update using (following_id = auth.uid()) with check (following_id = auth.uid());
create policy "follows: bırak / takipçiyi çıkar" on public.follows for delete using (follower_id = auth.uid() or following_id = auth.uid());

create policy "posts: görünür" on public.posts for select using (
  can_see(author_id) and (audience = 'everyone' or author_id = auth.uid()
    or exists (select 1 from follows where follower_id = auth.uid() and following_id = author_id and status = 'accepted')));
create policy "posts: paylaş" on public.posts for insert with check (auth.uid() is not null);
create policy "posts: düzenle" on public.posts for update using (author_id = auth.uid());
create policy "posts: sil" on public.posts for delete using (author_id = auth.uid());

create policy "likes: görünür" on public.likes for select using (true);
create policy "likes: beğen" on public.likes for insert with check (user_id = auth.uid() and can_see((select author_id from posts where id = post_id)));
create policy "likes: geri al" on public.likes for delete using (user_id = auth.uid());

create policy "bookmarks: kendi" on public.bookmarks for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "polls: görünür" on public.polls for select using (exists (select 1 from posts where id = post_id));
create policy "polls: oluştur" on public.polls for insert with check (exists (select 1 from posts where id = post_id and author_id = auth.uid()));
create policy "poll_votes: görünür" on public.poll_votes for select using (true);
create policy "poll_votes: oy ver" on public.poll_votes for insert with check (
  user_id = auth.uid() and exists (select 1 from polls where polls.post_id = poll_votes.post_id and ends_at > now()
    and option < array_length(options, 1)));

drop trigger if exists notifications_lock on public.notifications;
create trigger notifications_lock before update on public.notifications for each row execute procedure public.notification_lock();
create policy "notifications: kendi" on public.notifications for select using (user_id = auth.uid());
create policy "notifications: okundu" on public.notifications for update using (user_id = auth.uid());
create policy "notifications: sil" on public.notifications for delete using (user_id = auth.uid());

create policy "conversations: üyeler" on public.conversations for select using (is_member(id));
create policy "conversation_members: üyeler" on public.conversation_members for select using (is_member(conversation_id));
create policy "conversation_members: okundu" on public.conversation_members for update using (user_id = auth.uid());
create policy "conversation_members: ayrıl" on public.conversation_members for delete using (user_id = auth.uid());
create policy "messages: üyeler" on public.messages for select using (is_member(conversation_id));
create policy "messages: gönder" on public.messages for insert with check (
  sender_id = auth.uid() and is_member(conversation_id)
  and not exists (select 1 from conversation_members o where o.conversation_id = messages.conversation_id and o.user_id <> auth.uid() and is_blocked(auth.uid(), o.user_id)));
create policy "messages: sil" on public.messages for delete using (sender_id = auth.uid());

create policy "stories: görünür" on public.stories for select using (expires_at > now() and can_see(author_id) or author_id = auth.uid());
create policy "stories: paylaş" on public.stories for insert with check (author_id = auth.uid());
create policy "stories: sil" on public.stories for delete using (author_id = auth.uid());
create policy "story_views: izle" on public.story_views for insert with check (viewer_id = auth.uid());
create policy "story_views: görünür" on public.story_views for select using (
  viewer_id = auth.uid() or exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "reports: gönder" on public.reports for insert with check (reporter_id = auth.uid());

-- ───────── Görünümler ve fonksiyonlar (istemci bunları kullanır) ─────────

-- Gönderi + yazar + "ben beğendim mi?" bayrakları. security_invoker: RLS uygulanır.
create or replace view public.post_view with (security_invoker = true) as
select p.*,
  a.username, a.display_name, a.avatar_url, a.verified,
  exists (select 1 from likes l where l.post_id = p.id and l.user_id = auth.uid()) as liked,
  exists (select 1 from bookmarks b where b.post_id = p.id and b.user_id = auth.uid()) as bookmarked,
  exists (select 1 from posts r where r.repost_of = p.id and r.author_id = auth.uid() and r.body is null) as reposted,
  (select row_to_json(x) from (select options, ends_at,
     (select coalesce(json_agg(c order by o), '[]') from (select o, count(v.user_id) c from generate_series(0, array_length(pl.options, 1) - 1) o
        left join poll_votes v on v.post_id = pl.post_id and v.option = o group by o) t) as counts,
     (select option from poll_votes v where v.post_id = pl.post_id and v.user_id = auth.uid()) as my_vote
   from polls pl where pl.post_id = p.id) x) as poll
from posts p join profiles a on a.id = p.author_id;

-- Takip edilenler + kendi gönderilerin (sessize alınanlar hariç)
create or replace function public.home_feed(p_before timestamptz default now(), p_limit int default 30)
returns setof public.post_view language sql stable as $$
  select * from post_view v
  where v.created_at < p_before
    and (v.author_id = auth.uid() or v.author_id in (select following_id from follows where follower_id = auth.uid() and status = 'accepted'))
    and v.reply_to is null
    and v.author_id not in (select muted_id from mutes where muter_id = auth.uid())
  order by v.created_at desc limit least(p_limit, 50);
$$;

-- "Senin için": son 7 günün etkileşime göre sıralı gönderileri
create or replace function public.explore_feed(p_offset int default 0, p_limit int default 30)
returns setof public.post_view language sql stable as $$
  select * from post_view v
  where v.created_at > now() - interval '7 days' and v.reply_to is null and v.repost_of is null
    and v.author_id not in (select muted_id from mutes where muter_id = auth.uid())
  order by (v.like_count + 2 * v.repost_count + 3 * v.reply_count + v.quote_count + 1)
           / power(extract(epoch from (now() - v.created_at)) / 3600 + 2, 1.5) desc
  offset p_offset limit least(p_limit, 50);
$$;

-- Son 24 saatin popüler etiketleri
create or replace function public.trending_tags(p_limit int default 10)
returns table(tag text, posts bigint) language sql stable as $$
  select t, count(*) from posts, unnest(tags) t
  where created_at > now() - interval '24 hours' and can_see(author_id)
  group by t order by count(*) desc, t limit least(p_limit, 30);
$$;

-- Kim kimi takip etmeli: takip ettiklerinin takip ettikleri, sonra popüler hesaplar
create or replace function public.who_to_follow(p_limit int default 5)
returns setof public.profiles language sql stable security definer set search_path = public as $$
  select p.* from profiles p
  where p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and not exists (select 1 from follows f where f.follower_id = auth.uid() and f.following_id = p.id)
    and not is_blocked(coalesce(auth.uid(), p.id), p.id)
  order by (select count(*) from follows f2 join follows f1 on f1.following_id = f2.follower_id
            where f1.follower_id = auth.uid() and f2.following_id = p.id and f2.status = 'accepted') desc,
           p.followers_count desc
  limit least(p_limit, 20);
$$;

-- Görüntülenme sayısı (tek çağrıda birden çok gönderi)
create or replace function public.add_views(ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update posts set view_count = view_count + 1 where id = any(ids) and can_see(author_id);
$$;

-- Okunmamış bildirim ve mesaj sayıları
create or replace function public.unread_counts() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'notifications', (select count(*) from notifications where user_id = auth.uid() and not read),
    'messages', (select count(*) from conversation_members cm join conversations c on c.id = cm.conversation_id
                 where cm.user_id = auth.uid() and c.last_message_at > cm.last_read_at));
$$;

grant execute on function public.home_feed, public.explore_feed, public.trending_tags, public.who_to_follow,
  public.add_views, public.unread_counts, public.start_dm, public.can_see, public.is_blocked to anon, authenticated;
grant select on public.post_view to anon, authenticated;

-- ───────── Dosya depolama: avatar, banner, gönderi ve hikâye görselleri ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = true, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media: herkes görür" on storage.objects;
create policy "media: herkes görür" on storage.objects for select using (bucket_id = 'media');
drop policy if exists "media: kendi klasörüne yükle" on storage.objects;
create policy "media: kendi klasörüne yükle" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "media: kendi dosyasını sil" on storage.objects;
create policy "media: kendi dosyasını sil" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
