-- ═══════════════════════════════════════════════════════════════════════════
--  West Client — Depo (topluluk dosyaları) ve yetkiler (roller)
--  Supabase → SQL Editor → New query → bu dosyanın TAMAMINI yapıştır → Run.
--  Önce setup.sql ve social.sql çalıştırılmış olmalı. Birden fazla kez çalıştırmak güvenlidir.
--
--  İlk yöneticiyi kendin atarsın (yalnızca SQL Editor'dan, launcher'dan yapılamaz):
--    update public.profiles set role = 'admin' where lower(username) = lower('KULLANICI_ADIN');
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────── Roller ─────────
-- member: herkes (indirir) · approved (Onaylı): Depo'ya dosya yükler
-- moderator: başvuruları ve şikâyetleri yönetir, Onaylı verir/alır, dosya kaldırır
-- admin (Yönetici): her şey + Moderatör/Yönetici atar
alter table public.profiles add column if not exists role text not null default 'member';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'approved', 'moderator', 'admin'));

-- Kullanıcı kendi rolünü değiştiremez (yalnızca aşağıdaki fonksiyonlar ya da SQL Editor)
create or replace function public.protect_role() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.role := old.role;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect_role on public.profiles;
create trigger profiles_protect_role before update on public.profiles for each row execute procedure public.protect_role();

create or replace function public.role_rank(r text) returns int language sql immutable as $$
  select case r when 'admin' then 3 when 'moderator' then 2 when 'approved' then 1 else 0 end
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from profiles where id = auth.uid()), 'member')
$$;

-- Rol değişiklikleri kaydı (kim, kimi, neyden neye)
create table if not exists public.role_log (
  id bigserial primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  target_id uuid not null references public.profiles(id) on delete cascade,
  old_role text not null,
  new_role text not null,
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now()
);

-- Bildirim türlerine "role" (yetkin değişti) ve "depot" (dosyan kaldırıldı) eklenir
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('like', 'reply', 'repost', 'quote', 'mention', 'follow', 'follow_request', 'follow_accept', 'message', 'poll_vote', 'role', 'depot'));

/**
 * Rol atama. Yönetici herkese her rolü verebilir (kendi rolü hariç: kendini kilitlemesin);
 * moderatör yalnızca Üye ↔ Onaylı arasında değiştirebilir ve moderatör/yöneticilere dokunamaz.
 */
create or replace function public.set_role(p_user uuid, p_role text, p_reason text default null) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mine text := my_role(); old text;
begin
  if me is null then raise exception 'Giriş yapmalısın'; end if;
  if p_role not in ('member', 'approved', 'moderator', 'admin') then raise exception 'Geçersiz rol'; end if;
  select role into old from profiles where id = p_user;
  if old is null then raise exception 'Kullanıcı bulunamadı'; end if;
  if p_user = me then raise exception 'Kendi yetkini değiştiremezsin'; end if;
  if mine = 'admin' then
    null;
  elsif mine = 'moderator' then
    if role_rank(old) >= 2 or role_rank(p_role) >= 2 then raise exception 'Bu yetkiyi yalnızca yöneticiler verebilir'; end if;
  else
    raise exception 'Bunun için yetkin yok';
  end if;
  if old = p_role then return p_role; end if;
  update profiles set role = p_role where id = p_user;
  insert into role_log (actor_id, target_id, old_role, new_role, reason) values (me, p_user, old, p_role, left(p_reason, 300));
  -- Bekleyen başvurusu varsa sonuçlandır
  update role_requests set status = case when role_rank(p_role) >= 1 then 'approved' else 'declined' end, decided_by = me, decided_at = now()
    where user_id = p_user and status = 'pending';
  insert into notifications (user_id, actor_id, type) values (p_user, me, 'role');
  return p_role;
end $$;

-- ───────── Onaylı olma başvuruları ─────────
create table if not exists public.role_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null check (char_length(message) between 10 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz
);
create unique index if not exists role_requests_one_pending on public.role_requests (user_id) where status = 'pending';

create or replace function public.request_approval(p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); rid uuid;
begin
  if me is null then raise exception 'Giriş yapmalısın'; end if;
  if role_rank(my_role()) >= 1 then raise exception 'Zaten dosya yükleyebiliyorsun'; end if;
  if exists (select 1 from role_requests where user_id = me and status = 'pending') then raise exception 'Bekleyen bir başvurun var'; end if;
  if exists (select 1 from role_requests where user_id = me and status = 'declined' and decided_at > now() - interval '7 days') then
    raise exception 'Başvurun yakın zamanda reddedildi; bir hafta sonra tekrar deneyebilirsin';
  end if;
  insert into role_requests (user_id, message) values (me, trim(p_message)) returning id into rid;
  return rid;
end $$;

create or replace function public.answer_role_request(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r role_requests;
begin
  if role_rank(my_role()) < 2 then raise exception 'Bunun için yetkin yok'; end if;
  select * into r from role_requests where id = p_id and status = 'pending';
  if r.id is null then raise exception 'Başvuru bulunamadı'; end if;
  if p_approve then
    perform set_role(r.user_id, 'approved', 'Başvuru onaylandı');
  else
    update role_requests set status = 'declined', decided_by = auth.uid(), decided_at = now() where id = p_id;
    insert into notifications (user_id, actor_id, type) values (r.user_id, auth.uid(), 'role');
  end if;
end $$;

-- ───────── Depo öğeleri ─────────
create table if not exists public.depot_items (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  kind text not null check (kind in ('mod', 'resourcepack', 'shader', 'world', 'schematic', 'datapack', 'modpack', 'other')),
  title text not null check (char_length(title) between 3 and 60),
  summary text not null default '' check (char_length(summary) <= 200),
  description text not null default '' check (char_length(description) <= 5000),
  version text not null default '' check (char_length(version) <= 32),
  mc_versions text[] not null default '{}' check (cardinality(mc_versions) <= 30),
  loaders text[] not null default '{}' check (loaders <@ array['fabric', 'forge', 'neoforge', 'quilt', 'vanilla']::text[]),
  icon_url text check (icon_url is null or char_length(icon_url) <= 400),
  file_path text not null check (char_length(file_path) <= 300),
  file_name text not null check (char_length(file_name) between 1 and 120),
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  downloads int not null default 0,
  removed boolean not null default false,
  removed_reason text check (char_length(removed_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Tanıtım fotoğrafları: [{ "url": "...", "caption": "..." }] (en fazla 8)
alter table public.depot_items add column if not exists gallery jsonb not null default '[]'::jsonb;
alter table public.depot_items drop constraint if exists depot_items_gallery_check;
alter table public.depot_items add constraint depot_items_gallery_check check (jsonb_typeof(gallery) = 'array' and jsonb_array_length(gallery) <= 8);
create index if not exists depot_items_kind on public.depot_items (kind, created_at desc) where not removed;
create index if not exists depot_items_author on public.depot_items (author_id, created_at desc);
create index if not exists depot_items_popular on public.depot_items (downloads desc) where not removed;

-- Yazar yalnızca açıklama alanlarını düzenler; dosya, sayaç ve kaldırma durumu korunur
create or replace function public.protect_depot_item() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.id := old.id;
    new.author_id := old.author_id;
    new.kind := old.kind;
    new.file_path := old.file_path;
    new.file_name := old.file_name;
    new.file_size := old.file_size;
    new.sha256 := old.sha256;
    new.downloads := old.downloads;
    new.removed := old.removed;
    new.removed_reason := old.removed_reason;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists depot_items_protect on public.depot_items;
create trigger depot_items_protect before update on public.depot_items for each row execute procedure public.protect_depot_item();

-- Bir kullanıcının indirmesi bir kez sayılır
create table if not exists public.depot_downloads (
  item_id uuid not null references public.depot_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);

create or replace function public.depot_count_download(p_item uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into depot_downloads (item_id, user_id) select p_item, auth.uid() where exists (select 1 from depot_items where id = p_item and not removed)
    on conflict do nothing;
  if found then update depot_items set downloads = downloads + 1 where id = p_item; end if;
end $$;

-- Moderatör kaldırır (yazar görmeye devam eder, başkaları göremez); geri alınabilir
create or replace function public.depot_moderate(p_item uuid, p_remove boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  if role_rank(my_role()) < 2 then raise exception 'Bunun için yetkin yok'; end if;
  update depot_items set removed = p_remove, removed_reason = case when p_remove then left(p_reason, 300) end where id = p_item returning author_id into a;
  if a is null then raise exception 'Dosya bulunamadı'; end if;
  if p_remove then insert into notifications (user_id, actor_id, type) values (a, auth.uid(), 'depot'); end if;
end $$;

-- Liste görünümü: yazar adı, fotoğrafı ve rolüyle
drop view if exists public.depot_view;
create view public.depot_view with (security_invoker = true) as
  select d.*, p.username, p.display_name, p.avatar_url, p.verified, p.role as author_role
  from public.depot_items d join public.profiles p on p.id = d.author_id;

-- ───────── Şikâyetler: depo dosyaları da şikâyet edilebilir ─────────
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'profile', 'message', 'story', 'depot'));
alter table public.reports add column if not exists resolved boolean not null default false;

-- ───────── Satır güvenliği ─────────
alter table public.depot_items enable row level security;
alter table public.depot_downloads enable row level security;
alter table public.role_requests enable row level security;
alter table public.role_log enable row level security;

drop policy if exists "depot: görünür" on public.depot_items;
create policy "depot: görünür" on public.depot_items for select
  using (not removed or author_id = auth.uid() or role_rank(my_role()) >= 2);
drop policy if exists "depot: onaylılar yükler" on public.depot_items;
create policy "depot: onaylılar yükler" on public.depot_items for insert to authenticated
  with check (author_id = auth.uid() and role_rank(my_role()) >= 1 and not removed and downloads = 0
              and file_path like auth.uid()::text || '/%');
drop policy if exists "depot: yazar düzenler" on public.depot_items;
create policy "depot: yazar düzenler" on public.depot_items for update to authenticated
  using (author_id = auth.uid() or role_rank(my_role()) >= 2);
drop policy if exists "depot: yazar ya da moderatör siler" on public.depot_items;
create policy "depot: yazar ya da moderatör siler" on public.depot_items for delete to authenticated
  using (author_id = auth.uid() or role_rank(my_role()) >= 2);

drop policy if exists "depot_downloads: kendi" on public.depot_downloads;
create policy "depot_downloads: kendi" on public.depot_downloads for select using (user_id = auth.uid());

drop policy if exists "role_requests: kendi ya da moderatör" on public.role_requests;
create policy "role_requests: kendi ya da moderatör" on public.role_requests for select
  using (user_id = auth.uid() or role_rank(my_role()) >= 2);

drop policy if exists "role_log: moderatör" on public.role_log;
create policy "role_log: moderatör" on public.role_log for select using (role_rank(my_role()) >= 2);

drop policy if exists "reports: moderatör görür" on public.reports;
create policy "reports: moderatör görür" on public.reports for select using (role_rank(my_role()) >= 2);
drop policy if exists "reports: moderatör çözer" on public.reports;
create policy "reports: moderatör çözer" on public.reports for update using (role_rank(my_role()) >= 2);

grant select on public.depot_view to anon, authenticated;
grant select, insert, update, delete on public.depot_items to authenticated;
grant select on public.depot_items to anon;
grant select on public.depot_downloads, public.role_requests, public.role_log to authenticated;
grant update on public.reports to authenticated;
revoke all on function public.set_role(uuid, text, text), public.request_approval(text), public.answer_role_request(uuid, boolean),
  public.depot_count_download(uuid), public.depot_moderate(uuid, boolean, text) from public, anon;
grant execute on function public.set_role(uuid, text, text), public.request_approval(text), public.answer_role_request(uuid, boolean),
  public.depot_count_download(uuid), public.depot_moderate(uuid, boolean, text), public.my_role(), public.role_rank(text) to authenticated;

-- ───────── Dosya deposu (en fazla 50 MB; Supabase ücretsiz planının dosya sınırı) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('depot', 'depot', true, 52428800, null)
on conflict (id) do update set public = true, file_size_limit = 52428800, allowed_mime_types = null;

drop policy if exists "depot: herkes indirir" on storage.objects;
create policy "depot: herkes indirir" on storage.objects for select using (bucket_id = 'depot');
drop policy if exists "depot: onaylılar kendi klasörüne yükler" on storage.objects;
create policy "depot: onaylılar kendi klasörüne yükler" on storage.objects for insert to authenticated
  with check (bucket_id = 'depot' and (storage.foldername(name))[1] = auth.uid()::text and public.role_rank(public.my_role()) >= 1);
drop policy if exists "depot: sahibi ya da moderatör siler" on storage.objects;
create policy "depot: sahibi ya da moderatör siler" on storage.objects for delete to authenticated
  using (bucket_id = 'depot' and ((storage.foldername(name))[1] = auth.uid()::text or public.role_rank(public.my_role()) >= 2));

-- ───────── Görseller: yalnızca West'in kendi deposundan, yükleyenin klasöründen ─────────
-- (dışarıdan bağlanan görsel, açan herkesin IP'sini o siteye sızdırabilir)
create or replace function public.depot_media_ok(u text, author uuid) returns boolean language sql immutable as $$
  select u is null or (char_length(u) <= 400 and u ~ ('^https://[A-Za-z0-9.-]+/storage/v1/object/public/media/' || author::text || '/depot/[A-Za-z0-9._-]+$'))
$$;

create or replace function public.check_depot_media() returns trigger language plpgsql as $$
declare g jsonb;
begin
  if not depot_media_ok(new.icon_url, new.author_id) then raise exception 'Simge yalnızca West''e yüklenmiş bir görsel olabilir'; end if;
  for g in select * from jsonb_array_elements(new.gallery) loop
    if jsonb_typeof(g) <> 'object' or not depot_media_ok(g->>'url', new.author_id) or g->>'url' is null
       or char_length(coalesce(g->>'caption', '')) > 120 then
      raise exception 'Galeride geçersiz görsel';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists depot_items_media on public.depot_items;
create trigger depot_items_media before insert or update of icon_url, gallery on public.depot_items for each row execute procedure public.check_depot_media();

-- ───────── Sürümler ─────────
create table if not exists public.depot_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.depot_items(id) on delete cascade,
  version text not null check (char_length(version) between 1 and 32),
  changelog text not null default '' check (char_length(changelog) <= 2000),
  mc_versions text[] not null default '{}' check (cardinality(mc_versions) <= 30),
  loaders text[] not null default '{}' check (loaders <@ array['fabric', 'forge', 'neoforge', 'quilt', 'vanilla']::text[]),
  file_path text not null check (char_length(file_path) <= 300),
  file_name text not null check (char_length(file_name) between 1 and 120),
  file_size bigint not null check (file_size > 0 and file_size <= 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (item_id, version)
);
create index if not exists depot_versions_item on public.depot_versions (item_id, created_at desc);

-- İlk sürüm, dosya paylaşılınca kendiliğinden kaydedilir
create or replace function public.depot_first_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into depot_versions (item_id, version, mc_versions, loaders, file_path, file_name, file_size, sha256, created_at)
  values (new.id, coalesce(nullif(new.version, ''), '1.0'), new.mc_versions, new.loaders, new.file_path, new.file_name, new.file_size, new.sha256, new.created_at)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists depot_items_first_version on public.depot_items;
create trigger depot_items_first_version after insert on public.depot_items for each row execute procedure public.depot_first_version();

-- Önceden paylaşılmış dosyaların ilk sürümü
insert into public.depot_versions (item_id, version, mc_versions, loaders, file_path, file_name, file_size, sha256, created_at)
select i.id, coalesce(nullif(i.version, ''), '1.0'), i.mc_versions, i.loaders, i.file_path, i.file_name, i.file_size, i.sha256, i.created_at
from public.depot_items i where not exists (select 1 from public.depot_versions v where v.item_id = i.id)
on conflict do nothing;

/** Yeni sürüm yayınla: dosya önce yükleyenin klasörüne yüklenir, sonra bu çağrıyla öğe güncellenir. */
create or replace function public.depot_publish_version(p_item uuid, p_version text, p_changelog text, p_file_path text, p_file_name text,
  p_file_size bigint, p_sha256 text, p_mc_versions text[], p_loaders text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare it depot_items; vid uuid; v text := trim(p_version);
begin
  select * into it from depot_items where id = p_item;
  if it.id is null then raise exception 'Dosya bulunamadı'; end if;
  if it.author_id <> auth.uid() then raise exception 'Yalnızca paylaşan yeni sürüm yükleyebilir'; end if;
  if role_rank(my_role()) < 1 then raise exception 'Bunun için Onaylı olmalısın'; end if;
  if it.removed then raise exception 'Kaldırılmış bir dosyaya sürüm eklenemez'; end if;
  if p_file_path not like auth.uid()::text || '/%' then raise exception 'Geçersiz dosya yolu'; end if;
  if v = '' then raise exception 'Sürüm numarası gerekli'; end if;
  if exists (select 1 from depot_versions where item_id = p_item and version = v) then raise exception 'Bu sürüm numarası zaten var'; end if;
  insert into depot_versions (item_id, version, changelog, mc_versions, loaders, file_path, file_name, file_size, sha256)
  values (p_item, v, coalesce(p_changelog, ''), coalesce(p_mc_versions, '{}'), coalesce(p_loaders, '{}'), p_file_path, p_file_name, p_file_size, lower(p_sha256))
  returning id into vid;
  update depot_items set version = v, mc_versions = coalesce(p_mc_versions, '{}'), loaders = coalesce(p_loaders, '{}'),
    file_path = p_file_path, file_name = p_file_name, file_size = p_file_size, sha256 = lower(p_sha256), updated_at = now()
    where id = p_item;
  return vid;
end $$;

/** Eski bir sürümü sil (güncel sürüm silinemez); depodaki dosyasının yolunu döner */
create or replace function public.depot_delete_version(p_version uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v depot_versions; it depot_items;
begin
  select * into v from depot_versions where id = p_version;
  if v.id is null then raise exception 'Sürüm bulunamadı'; end if;
  select * into it from depot_items where id = v.item_id;
  if it.author_id <> auth.uid() and role_rank(my_role()) < 2 then raise exception 'Bunun için yetkin yok'; end if;
  if it.file_path = v.file_path then raise exception 'Güncel sürüm silinemez; önce yeni bir sürüm yükle'; end if;
  delete from depot_versions where id = p_version;
  return v.file_path;
end $$;

alter table public.depot_versions enable row level security;
drop policy if exists "depot_versions: öğe görünürse" on public.depot_versions;
create policy "depot_versions: öğe görünürse" on public.depot_versions for select
  using (exists (select 1 from public.depot_items i where i.id = item_id));
grant select on public.depot_versions to anon, authenticated;
revoke all on function public.depot_publish_version(uuid, text, text, text, text, bigint, text, text[], text[]), public.depot_delete_version(uuid) from public, anon;
grant execute on function public.depot_publish_version(uuid, text, text, text, text, bigint, text, text[], text[]), public.depot_delete_version(uuid) to authenticated;
