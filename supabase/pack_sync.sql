-- West Client · Arkadaşla paket senkronu
-- Bir instance'ın mod listesi kısa bir kodla paylaşılır; kodu kullanan arkadaşın launcher'ı, sahibi listeyi
-- güncelledikçe "Güncelleme var" der ve tek tıkla aynı hâle getirir.
-- Supabase → SQL Editor'de bir kez çalıştır.

create table if not exists public.pack_syncs (
  code text primary key check (code ~ '^[A-Z0-9]{6,10}$'),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 64),
  manifest jsonb not null check (pg_column_size(manifest) < 65536),
  updated_at timestamptz not null default now()
);

alter table public.pack_syncs enable row level security;

drop policy if exists "pack_syncs okuma" on public.pack_syncs;
create policy "pack_syncs okuma" on public.pack_syncs for select using (true);

drop policy if exists "pack_syncs ekleme" on public.pack_syncs;
create policy "pack_syncs ekleme" on public.pack_syncs for insert with check (owner = auth.uid());

drop policy if exists "pack_syncs güncelleme" on public.pack_syncs;
create policy "pack_syncs güncelleme" on public.pack_syncs for update using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists "pack_syncs silme" on public.pack_syncs;
create policy "pack_syncs silme" on public.pack_syncs for delete using (owner = auth.uid());
