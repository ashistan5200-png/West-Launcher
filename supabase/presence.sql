-- West Client: çevrimiçi durumu (oyun içi Sosyal'deki "Çevrimiçi" ve arkadaş durumları için)
-- Supabase → SQL Editor'da bir kez çalıştırın. social.sql'den SONRA.

create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'online' check (status in ('online', 'away', 'busy', 'invisible')),
  activity text check (activity is null or char_length(activity) <= 80),
  updated_at timestamptz not null default now()
);

alter table public.presence enable row level security;

-- Herkes yalnızca kendi durumunu yazar
drop policy if exists presence_write_self on public.presence;
create policy presence_write_self on public.presence
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Durumu yalnızca karşılıklı takipleşilen arkadaşlar görür; "görünmez" olan hiç görünmez
drop policy if exists presence_read_friends on public.presence;
create policy presence_read_friends on public.presence
  for select using (
    user_id = auth.uid()
    or (
      status <> 'invisible'
      and exists (select 1 from public.follows a
                  where a.follower_id = auth.uid() and a.following_id = presence.user_id and a.status = 'accepted')
      and exists (select 1 from public.follows b
                  where b.follower_id = presence.user_id and b.following_id = auth.uid() and b.status = 'accepted')
    )
  );
