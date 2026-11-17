-- West+ abonelikleri ve kod sistemi
-- Supabase → SQL Editor'da bir kez çalıştırılır (setup.sql ve social.sql'den sonra).
--
-- Kodlar e-pin sitelerinde (itemsatış vb.) satılır. Veritabanında kodun kendisi değil,
-- SHA-256 özeti tutulur: tablo sızsa bile kodlar kullanılamaz.
-- Kod üretmek için: node tools/plus-codes/generate.mjs (çıktıdaki SQL buraya yapıştırılır).

create extension if not exists pgcrypto;

-- Satılan kodlar (yalnızca özet). İstemciler bu tabloyu hiç göremez.
create table if not exists public.plus_codes (
  code_hash   text primary key,
  plan        text not null check (plan in ('month', 'quarter', 'year')),
  days        int  not null check (days between 1 and 400),
  batch       text,
  created_at  timestamptz not null default now(),
  redeemed_by uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz
);
alter table public.plus_codes enable row level security;
-- Politika yok: istemciden okuma/yazma kapalı; yalnızca aşağıdaki fonksiyon dokunur.

-- Kimin West+'ı ne zamana kadar açık
create table if not exists public.plus_subscriptions (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.plus_subscriptions enable row level security;
drop policy if exists "kendi aboneliğini görür" on public.plus_subscriptions;
create policy "kendi aboneliğini görür" on public.plus_subscriptions for select using (user_id = auth.uid());

-- Kod denemeleri (tahminle kod bulmaya karşı sınır)
create table if not exists public.plus_redeem_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists plus_redeem_attempts_user_at on public.plus_redeem_attempts (user_id, at);
alter table public.plus_redeem_attempts enable row level security;

-- Kodu kullan. Hata durumunda istisna atmak yerine {ok:false} döner; böylece deneme kaydı silinmez.
create or replace function public.redeem_plus_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  h      text;
  c      public.plus_codes;
  cur    timestamptz;
  newexp timestamptz;
  recent int;
begin
  if uid is null then
    return json_build_object('ok', false, 'error', 'login');
  end if;

  select count(*) into recent from public.plus_redeem_attempts
   where user_id = uid and at > now() - interval '10 minutes';
  if recent >= 10 then
    return json_build_object('ok', false, 'error', 'rate');
  end if;
  insert into public.plus_redeem_attempts (user_id) values (uid);

  -- Biçim farklarını yok say: boşluk, tire, küçük harf
  h := encode(digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');

  select * into c from public.plus_codes where code_hash = h for update;
  if not found then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;
  if c.redeemed_by is not null then
    return json_build_object('ok', false, 'error', 'used');
  end if;

  select expires_at into cur from public.plus_subscriptions where user_id = uid;
  -- Süresi devam ediyorsa üstüne eklenir
  newexp := greatest(coalesce(cur, now()), now()) + make_interval(days => c.days);

  insert into public.plus_subscriptions (user_id, expires_at) values (uid, newexp)
    on conflict (user_id) do update set expires_at = excluded.expires_at, updated_at = now();
  update public.plus_codes set redeemed_by = uid, redeemed_at = now() where code_hash = h;

  return json_build_object('ok', true, 'plan', c.plan, 'days', c.days, 'expires_at', newexp);
end;
$$;
revoke all on function public.redeem_plus_code(text) from public, anon;
grant execute on function public.redeem_plus_code(text) to authenticated;

-- Hangi kullanıcılar West+? (Sosyal ve oyun içinde rozet göstermek için; yalnızca evet/hayır döner)
create or replace function public.plus_members(p_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from public.plus_subscriptions
   where user_id = any(p_ids[1:200]) and expires_at > now();
$$;
revoke all on function public.plus_members(uuid[]) from public, anon;
grant execute on function public.plus_members(uuid[]) to authenticated;

-- Eski deneme kayıtlarını temizlemek için (isteğe bağlı, elle ya da pg_cron ile):
-- delete from public.plus_redeem_attempts where at < now() - interval '1 day';
