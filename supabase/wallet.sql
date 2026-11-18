-- West Coin cüzdanı (sunucuda)
-- Supabase → SQL Editor'da bir kez çalıştırın (setup.sql ve social.sql'den SONRA).
--
-- Bakiye, sahip olunan ve kuşanılan öğeler burada tutulur. İstemciler tablolara doğrudan yazamaz;
-- her değişiklik aşağıdaki fonksiyonlardan geçer ve fiyatlar sunucudaki listeden okunur.
-- Kazanç: oyun açılınca wallet_session_start(), kapanınca wallet_earn(saniye). Sunucu, oturum başladığından
-- bu yana gerçekten geçen süreden fazlasını saymaz (en fazla 12 saat).

-- ───── Mağaza listesi (herkes okuyabilir) ─────
create table if not exists public.shop_items (
  id         text primary key,
  kind       text not null,
  slot       text not null,
  price      int  not null check (price >= 0),
  plus_only  boolean not null default false,
  days       int  not null default 0
);
alter table public.shop_items enable row level security;
drop policy if exists shop_items_read on public.shop_items;
create policy shop_items_read on public.shop_items for select using (true);

insert into public.shop_items (id, kind, slot, price, plus_only, days) values
  ('plus_30', 'plus', 'plus', 2500, false, 30),
  ('plus_90', 'plus', 'plus', 6500, false, 90),
  ('plus_365', 'plus', 'plus', 22000, false, 365),
  ('theme_ocean', 'theme', 'theme', 600, false, 0),
  ('theme_forest', 'theme', 'theme', 600, false, 0),
  ('theme_rose', 'theme', 'theme', 600, false, 0),
  ('theme_mono', 'theme', 'theme', 500, false, 0),
  ('theme_nether', 'theme', 'theme', 900, false, 0),
  ('theme_end', 'theme', 'theme', 900, false, 0),
  ('sky_dawn', 'sky', 'sky', 400, false, 0),
  ('sky_night', 'sky', 'sky', 400, false, 0),
  ('sky_snow', 'sky', 'sky', 500, false, 0),
  ('sky_sakura', 'sky', 'sky', 700, false, 0),
  ('sky_nether', 'sky', 'sky', 700, false, 0),
  ('sky_end', 'sky', 'sky', 700, false, 0),
  ('trail_stars', 'trail', 'trail', 300, false, 0),
  ('trail_snow', 'trail', 'trail', 300, false, 0),
  ('trail_fire', 'trail', 'trail', 400, false, 0),
  ('trail_hearts', 'trail', 'trail', 400, false, 0),
  ('menu_ocean', 'menuTheme', 'menuTheme', 500, false, 0),
  ('menu_forest', 'menuTheme', 'menuTheme', 500, false, 0),
  ('menu_nether', 'menuTheme', 'menuTheme', 700, false, 0),
  ('menu_end', 'menuTheme', 'menuTheme', 700, false, 0),
  ('cape_west', 'cape', 'cape', 0, false, 0),
  ('cape_sunset', 'cape', 'cape', 1200, false, 0),
  ('cape_ocean', 'cape', 'cape', 1200, false, 0),
  ('cape_forest', 'cape', 'cape', 1200, false, 0),
  ('cape_sakura', 'cape', 'cape', 1500, false, 0),
  ('cape_nether', 'cape', 'cape', 1500, false, 0),
  ('cape_end', 'cape', 'cape', 1500, false, 0),
  ('hat_cap', 'hat', 'hat', 1000, false, 0),
  ('hat_catears', 'hat', 'hat', 1200, false, 0),
  ('hat_tophat', 'hat', 'hat', 1500, false, 0),
  ('hat_wizard', 'hat', 'hat', 1800, false, 0),
  ('hat_crown', 'hat', 'hat', 2500, false, 0),
  ('back_bag', 'back', 'back', 1200, false, 0),
  ('back_wings', 'back', 'back', 3000, false, 0),
  ('back_dragon', 'back', 'back', 3500, false, 0),
  ('aura_hearts', 'aura', 'aura', 800, false, 0),
  ('aura_notes', 'aura', 'aura', 800, false, 0),
  ('aura_flame', 'aura', 'aura', 1000, false, 0),
  ('theme_gold', 'theme', 'theme', 0, true, 0),
  ('theme_aurora', 'theme', 'theme', 0, true, 0),
  ('sky_aurora', 'sky', 'sky', 0, true, 0),
  ('trail_rainbow', 'trail', 'trail', 0, true, 0),
  ('menu_gold', 'menuTheme', 'menuTheme', 0, true, 0),
  ('cape_plus', 'cape', 'cape', 0, true, 0),
  ('hat_halo', 'hat', 'hat', 0, true, 0),
  ('back_plus_wings', 'back', 'back', 0, true, 0),
  ('aura_stars', 'aura', 'aura', 0, true, 0)
on conflict (id) do update set kind = excluded.kind, slot = excluded.slot, price = excluded.price, plus_only = excluded.plus_only, days = excluded.days;

-- ───── Cüzdanlar ─────
create table if not exists public.wallets (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  coins           bigint not null default 0 check (coins >= 0),
  earned_total    bigint not null default 0,
  carry_secs      int    not null default 0,
  plus_until      timestamptz,
  session_started timestamptz,
  imported        boolean not null default false,
  created_at      timestamptz not null default now()
);
create table if not exists public.wallet_items (
  user_id  uuid not null references auth.users (id) on delete cascade,
  item_id  text not null references public.shop_items (id),
  at       timestamptz not null default now(),
  primary key (user_id, item_id)
);
create table if not exists public.wallet_equipped (
  user_id  uuid not null references auth.users (id) on delete cascade,
  slot     text not null,
  item_id  text not null references public.shop_items (id),
  primary key (user_id, slot)
);
create table if not exists public.wallet_log (
  id       bigserial primary key,
  user_id  uuid not null references auth.users (id) on delete cascade,
  amount   int  not null,
  reason   text not null,
  at       timestamptz not null default now()
);
create index if not exists wallet_log_user on public.wallet_log (user_id, at desc);

alter table public.wallets enable row level security;
alter table public.wallet_items enable row level security;
alter table public.wallet_equipped enable row level security;
alter table public.wallet_log enable row level security;
-- Yalnızca kendi kayıtlarını okur; yazma yalnızca fonksiyonlarla
drop policy if exists wallets_read on public.wallets;
create policy wallets_read on public.wallets for select using (user_id = auth.uid());
drop policy if exists wallet_items_read on public.wallet_items;
create policy wallet_items_read on public.wallet_items for select using (user_id = auth.uid());
drop policy if exists wallet_equipped_read on public.wallet_equipped;
create policy wallet_equipped_read on public.wallet_equipped for select using (user_id = auth.uid());
drop policy if exists wallet_log_read on public.wallet_log;
create policy wallet_log_read on public.wallet_log for select using (user_id = auth.uid());

-- ───── Yardımcılar ─────

-- Cüzdan yoksa oluştur (ilk kez: 300 coin hediye ve West pelerini)
create or replace function public._wallet_ensure(uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id, coins, earned_total) values (uid, 300, 300) on conflict (user_id) do nothing;
  if found then
    insert into public.wallet_log (user_id, amount, reason) values (uid, 300, 'welcome');
  end if;
end $$;

create or replace function public._wallet_can_use(uid uuid, it public.shop_items)
returns boolean language sql stable security definer set search_path = public as $$
  select (it.price = 0 and not it.plus_only)
      or exists (select 1 from public.wallet_items wi where wi.user_id = uid and wi.item_id = it.id)
      or (it.plus_only and coalesce((select plus_until > now() from public.wallets w where w.user_id = uid), false));
$$;

-- Görünüm: launcher'ın ihtiyaç duyduğu her şey tek JSON'da
create or replace function public._wallet_view(uid uuid, extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w public.wallets;
begin
  select * into w from public.wallets where user_id = uid;
  -- Plus bittiyse Plus'a özel kuşanılanlar görünmez (kayıt kalır; Plus yenilenince geri gelir)
  return jsonb_build_object(
    'coins', w.coins,
    'earnedTotal', w.earned_total,
    'carrySecs', w.carry_secs,
    'plusUntil', w.plus_until,
    'plus', coalesce(w.plus_until > now(), false),
    'owned', coalesce((select jsonb_agg(item_id order by at) from public.wallet_items where user_id = uid), '[]'::jsonb),
    'equipped', coalesce((select jsonb_object_agg(e.slot, e.item_id) from public.wallet_equipped e join public.shop_items s on s.id = e.item_id
                          where e.user_id = uid and public._wallet_can_use(uid, s)), '{}'::jsonb),
    'imported', w.imported,
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'amount', amount, 'reason', reason) order by at desc)
                         from (select * from public.wallet_log where user_id = uid order by at desc limit 30) l), '[]'::jsonb)
  ) || extra;
end $$;

-- ───── İstemcinin çağırdığı fonksiyonlar ─────

create or replace function public.wallet_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  return public._wallet_view(uid);
end $$;

create or replace function public.wallet_session_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  update public.wallets set session_started = now() where user_id = uid;
  return public._wallet_view(uid);
end $$;

-- Oyun kapandı: istemcinin söylediği süre, sunucunun ölçtüğü süreyle (ve 12 saatle) sınırlanır
create or replace function public.wallet_earn(p_secs int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  w public.wallets;
  real_secs int;
  secs int;
  rate int;
  total int;
  gain int := 0;
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  select * into w from public.wallets where user_id = uid for update;
  if w.session_started is null then
    return public._wallet_view(uid, jsonb_build_object('earned', 0));
  end if;
  real_secs := greatest(0, floor(extract(epoch from now() - w.session_started))::int);
  secs := least(greatest(coalesce(p_secs, 0), 0), real_secs, 12 * 3600);
  rate := case when w.plus_until > now() then 150 else 100 end;
  total := w.carry_secs + secs;
  gain := total * rate / 3600;
  update public.wallets
     set coins = wallets.coins + gain,
         earned_total = wallets.earned_total + gain,
         carry_secs = total - (gain * 3600 / rate),
         session_started = null
   where user_id = uid;
  if gain > 0 then
    insert into public.wallet_log (user_id, amount, reason) values (uid, gain, 'play');
  end if;
  return public._wallet_view(uid, jsonb_build_object('earned', gain));
end $$;

create or replace function public.wallet_buy(p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  it public.shop_items;
  w public.wallets;
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  select * into it from public.shop_items where id = p_item;
  if not found then raise exception 'Böyle bir öğe yok'; end if;
  if it.plus_only then raise exception 'Bu öğe West Plus''a özel; West Plus açıkken ücretsiz kullanılır'; end if;
  select * into w from public.wallets where user_id = uid for update;
  if it.kind <> 'plus' and exists (select 1 from public.wallet_items where user_id = uid and item_id = it.id) then
    raise exception 'Bu öğe zaten sende';
  end if;
  if w.coins < it.price then raise exception 'Yeterli West Coin yok (% gerekiyor)', it.price; end if;
  update public.wallets set coins = coins - it.price,
         plus_until = case when it.kind = 'plus' then greatest(coalesce(plus_until, now()), now()) + make_interval(days => it.days) else plus_until end
   where user_id = uid;
  if it.kind <> 'plus' then
    insert into public.wallet_items (user_id, item_id) values (uid, it.id);
  end if;
  insert into public.wallet_log (user_id, amount, reason) values (uid, -it.price, it.id);
  return public._wallet_view(uid);
end $$;

-- Kuşan (p_item null → o yuvayı boşalt)
create or replace function public.wallet_equip(p_slot text, p_item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  it public.shop_items;
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  if p_item is null then
    delete from public.wallet_equipped where user_id = uid and slot = p_slot;
    return public._wallet_view(uid);
  end if;
  select * into it from public.shop_items where id = p_item;
  if not found or it.slot <> p_slot or it.kind = 'plus' then raise exception 'Böyle bir öğe yok'; end if;
  if not public._wallet_can_use(uid, it) then
    raise exception '%', case when it.plus_only then 'Bu öğe için West Plus gerekiyor' else 'Önce bu öğeyi satın almalısın' end;
  end if;
  insert into public.wallet_equipped (user_id, slot, item_id) values (uid, p_slot, p_item)
    on conflict (user_id, slot) do update set item_id = excluded.item_id;
  return public._wallet_view(uid);
end $$;

-- Bilgisayardaki eski cüzdanı bir kez aktar. Dosya elle düzenlenmiş olabileceği için coin en fazla 5000,
-- öğeler yalnızca satılan (Plus'a özel olmayan) öğeler, Plus süresi en fazla 30 gün.
create or replace function public.wallet_import(p_coins int, p_owned text[], p_plus_until timestamptz, p_equipped jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  w public.wallets;
  k text;
begin
  if uid is null then raise exception 'login'; end if;
  perform public._wallet_ensure(uid);
  select * into w from public.wallets where user_id = uid for update;
  if w.imported then return public._wallet_view(uid); end if;
  update public.wallets set
    coins = coins + least(greatest(coalesce(p_coins, 0), 0), 5000),
    plus_until = case when p_plus_until > now() then greatest(coalesce(plus_until, now()), least(p_plus_until, now() + interval '30 days')) else plus_until end,
    imported = true
   where user_id = uid;
  insert into public.wallet_items (user_id, item_id)
    select uid, s.id from public.shop_items s
     where s.id = any(coalesce(p_owned, '{}')) and s.kind <> 'plus' and not s.plus_only and s.price > 0
    on conflict do nothing;
  insert into public.wallet_log (user_id, amount, reason) values (uid, least(greatest(coalesce(p_coins, 0), 0), 5000), 'import');
  for k in select jsonb_object_keys(coalesce(p_equipped, '{}'::jsonb)) loop
    begin
      perform public.wallet_equip(k, p_equipped ->> k);
    exception when others then null;
    end;
  end loop;
  return public._wallet_view(uid);
end $$;

-- Yetkiler: yardımcılar dışarıya kapalı, istemci fonksiyonları yalnızca girişli kullanıcıya açık
revoke all on function public._wallet_ensure(uuid), public._wallet_can_use(uuid, public.shop_items), public._wallet_view(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.wallet_get(), public.wallet_session_start(), public.wallet_earn(int), public.wallet_buy(text),
  public.wallet_equip(text, text), public.wallet_import(int, text[], timestamptz, jsonb) from public, anon;
grant execute on function public.wallet_get(), public.wallet_session_start(), public.wallet_earn(int), public.wallet_buy(text),
  public.wallet_equip(text, text), public.wallet_import(int, text[], timestamptz, jsonb) to authenticated;
