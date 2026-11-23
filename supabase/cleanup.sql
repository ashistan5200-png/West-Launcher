-- ═══════════════════════════════════════════════════════════════════════════
--  West Client — kaldırılan özelliklerin (Depo, roller, Mağaza / West Coin, oyun içi lobi) Supabase artıkları
--  İSTEĞE BAĞLI: bu tablolardaki veriler KALICI olarak silinir.
--  Supabase → SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.
--
--  Depo'nun dosya deposunu (bucket "depot") SQL ile silmek Supabase'te engellidir:
--  Storage → depot → tüm dosyaları seç → Delete, sonra deponun menüsünden "Delete bucket".
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────── Depo ve roller ─────────
drop policy if exists "depot: herkes indirir" on storage.objects;
drop policy if exists "depot: onaylılar kendi klasörüne yükler" on storage.objects;
drop policy if exists "depot: sahibi ya da moderatör siler" on storage.objects;
drop policy if exists "reports: moderatör görür" on public.reports;
drop policy if exists "reports: moderatör çözer" on public.reports;
drop view if exists public.depot_view;
drop table if exists public.depot_versions cascade;
drop table if exists public.depot_downloads cascade;
drop table if exists public.depot_items cascade;
drop table if exists public.role_requests cascade;
drop table if exists public.role_log cascade;
drop function if exists public.depot_publish_version(uuid, text, text, text, text, bigint, text, text[], text[]);
drop function if exists public.depot_delete_version(uuid);
drop function if exists public.depot_first_version() cascade;
drop function if exists public.depot_count_download(uuid);
drop function if exists public.depot_moderate(uuid, boolean, text);
drop function if exists public.protect_depot_item() cascade;
drop function if exists public.check_depot_media() cascade;
drop function if exists public.depot_media_ok(text, uuid);
drop function if exists public.set_role(uuid, text, text);
drop function if exists public.request_approval(text);
drop function if exists public.answer_role_request(uuid, boolean);
drop trigger if exists profiles_protect_role on public.profiles;
drop function if exists public.protect_role();
drop function if exists public.my_role();
drop function if exists public.role_rank(text);
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles drop column if exists role;
delete from public.reports where target_type = 'depot';
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'profile', 'message', 'story'));
delete from public.notifications where type in ('role', 'depot');
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in
  ('like', 'reply', 'repost', 'quote', 'mention', 'follow', 'follow_request', 'follow_accept', 'message', 'poll_vote'));

-- ───────── Mağaza ve West Coin ─────────
drop function if exists public.wallet_import cascade;
drop function if exists public.wallet_equip cascade;
drop function if exists public.wallet_buy cascade;
drop function if exists public.wallet_earn cascade;
drop function if exists public.wallet_session_start cascade;
drop function if exists public.wallet_get cascade;
drop function if exists public._wallet_view cascade;
drop function if exists public._wallet_can_use cascade;
drop function if exists public._wallet_ensure cascade;
drop table if exists public.wallet_log cascade;
drop table if exists public.wallet_equipped cascade;
drop table if exists public.wallet_items cascade;
drop table if exists public.wallets cascade;
drop table if exists public.shop_items cascade;

-- ───────── Oyun içi lobi ve grup sesli sohbeti ─────────
drop policy if exists west_voice_listen on realtime.messages;
drop policy if exists west_voice_send on realtime.messages;
drop table if exists public.lobby_events cascade;
drop table if exists public.lobby_actions cascade;
drop table if exists public.lobby_requests cascade;
drop table if exists public.lobby_invites cascade;
drop table if exists public.lobby_members cascade;
drop table if exists public.lobbies cascade;
drop table if exists public.lobby_presence cascade;
drop table if exists public.lobby_settings cascade;
drop table if exists public.lobby_verifications cascade;
drop table if exists public.mc_links cascade;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'lobby\_%' loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
end $$;
