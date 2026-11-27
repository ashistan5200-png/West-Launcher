-- West Client · Discord'dan "Birlikte oyna"
-- Oyun açılınca paketin mod listesi ve (varsa) sunucu adresi kısa bir davet koduyla saklanır.
-- Discord'daki "Birlikte oyna" düğmesi westclient.app/katil?k=KOD adresine gider; arkadaşın
-- West Client'ı aynı paketi kurar ve aynı sunucuya girer. Davetler 7 gün sonra silinir.
-- Hesap gerekmez: tabloya doğrudan erişim yok, yalnızca iki fonksiyon üzerinden yazılır/okunur
-- (kodu bilmeyen davetleri listeleyemez).
-- Supabase → SQL Editor'de bir kez çalıştır.

create table if not exists public.play_invites (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  name text not null default '' check (char_length(name) <= 64),
  manifest jsonb not null check (pg_column_size(manifest) < 32768),
  server text check (server is null or char_length(server) <= 255),
  created_at timestamptz not null default now()
);

alter table public.play_invites enable row level security;
-- Politika yok: anon/authenticated doğrudan okuyamaz, yazamaz.

create or replace function public.create_play_invite(p_name text, p_manifest jsonb, p_server text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  c text;
begin
  if p_manifest is null or pg_column_size(p_manifest) >= 32768 then
    raise exception 'manifest too large';
  end if;
  -- Eski davetleri temizle
  delete from public.play_invites where created_at < now() - interval '7 days';
  for i in 1..6 loop
    c := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    begin
      insert into public.play_invites (code, name, manifest, server)
      values (c, left(coalesce(p_name, ''), 64), p_manifest, nullif(left(coalesce(p_server, ''), 255), ''));
      return c;
    exception when unique_violation then
      -- çok nadir: başka kod dene
    end;
  end loop;
  raise exception 'could not create invite';
end;
$$;

create or replace function public.get_play_invite(p_code text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object('code', code, 'name', name, 'manifest', manifest, 'server', server, 'created_at', created_at)
  from public.play_invites
  where code = upper(p_code) and created_at > now() - interval '7 days';
$$;

revoke all on function public.create_play_invite(text, jsonb, text) from public;
revoke all on function public.get_play_invite(text) from public;
grant execute on function public.create_play_invite(text, jsonb, text) to anon, authenticated;
grant execute on function public.get_play_invite(text) to anon, authenticated;
