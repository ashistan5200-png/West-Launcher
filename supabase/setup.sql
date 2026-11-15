-- West Client hesapları için Supabase kurulumu.
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run.

-- Kullanıcı adları (e-posta ve şifre Supabase Auth'ta, burada değil)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  created_at timestamptz not null default now()
);
-- Büyük/küçük harf fark etmeksizin benzersiz
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
drop policy if exists "Kullanıcı adları herkese açık" on public.profiles;
create policy "Kullanıcı adları herkese açık" on public.profiles for select using (true);
drop policy if exists "Herkes kendi profilini düzenler" on public.profiles;
create policy "Herkes kendi profilini düzenler" on public.profiles for update using (auth.uid() = id);

-- Kayıt olunca profil satırı otomatik oluşur (kullanıcı adı kayıt formundan gelir)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();
