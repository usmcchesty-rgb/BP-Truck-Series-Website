-- BP Fantasy Launch Phase — run in Supabase SQL Editor after SUPABASE_SETUP.sql
-- Requires Supabase Auth enabled (email/password).
--
-- Supabase Dashboard → Authentication → URL Configuration:
--   Site URL: https://www.blazingpedalsracing.com
--   Redirect URLs (add each):
--     https://www.blazingpedalsracing.com/fantasy/login.html
--     https://www.blazingpedalsracing.com/fantasy/signup.html
--     https://www.blazingpedalsracing.com/fantasy/dashboard.html
--     https://www.blazingpedalsracing.com/fantasy/lineup.html
--     https://blazingpedals.vercel.app/fantasy/login.html (Vercel preview)
--   Email templates: see supabase/fantasy_auth_email_templates.md

-- Optional lock enforcement (ISO timestamp). lock_time remains display text on slate.
alter table fantasy_slates add column if not exists lock_at timestamptz;

-- Player profile (extends auth.users)
create table if not exists fantasy_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One lineup per user per slate
create table if not exists fantasy_lineups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id text not null,
  race_number int not null,
  slate_id int not null references fantasy_slates(id) on delete cascade,
  total_salary int not null default 0,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'locked'))
);

create unique index if not exists fantasy_lineups_user_slate_idx
  on fantasy_lineups (user_id, slate_id);

create index if not exists fantasy_lineups_slate_idx
  on fantasy_lineups (slate_id);

create table if not exists fantasy_lineup_drivers (
  id bigserial primary key,
  lineup_id uuid not null references fantasy_lineups(id) on delete cascade,
  driver_id text not null,
  driver_name text not null default '',
  salary int not null,
  slot_order int not null check (slot_order >= 1 and slot_order <= 8),
  unique (lineup_id, driver_id),
  unique (lineup_id, slot_order)
);

-- Auto-create profile on signup
create or replace function public.handle_new_fantasy_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fantasy_profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (user_id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_fantasy_profile on auth.users;
create trigger on_auth_user_created_fantasy_profile
  after insert on auth.users
  for each row execute function public.handle_new_fantasy_user();

-- RLS
alter table fantasy_profiles enable row level security;
alter table fantasy_lineups enable row level security;
alter table fantasy_lineup_drivers enable row level security;

drop policy if exists fantasy_profiles_select_own on fantasy_profiles;
create policy fantasy_profiles_select_own on fantasy_profiles
  for select using (auth.uid() = user_id);

drop policy if exists fantasy_profiles_update_own on fantasy_profiles;
create policy fantasy_profiles_update_own on fantasy_profiles
  for update using (auth.uid() = user_id);

drop policy if exists fantasy_lineups_select_own on fantasy_lineups;
create policy fantasy_lineups_select_own on fantasy_lineups
  for select using (auth.uid() = user_id);

drop policy if exists fantasy_lineups_insert_own on fantasy_lineups;
create policy fantasy_lineups_insert_own on fantasy_lineups
  for insert with check (auth.uid() = user_id);

drop policy if exists fantasy_lineups_update_own on fantasy_lineups;
create policy fantasy_lineups_update_own on fantasy_lineups
  for update using (auth.uid() = user_id and status <> 'locked');

drop policy if exists fantasy_lineup_drivers_select_own on fantasy_lineup_drivers;
create policy fantasy_lineup_drivers_select_own on fantasy_lineup_drivers
  for select using (
    exists (
      select 1 from fantasy_lineups l
      where l.id = lineup_id and l.user_id = auth.uid()
    )
  );

drop policy if exists fantasy_lineup_drivers_insert_own on fantasy_lineup_drivers;
create policy fantasy_lineup_drivers_insert_own on fantasy_lineup_drivers
  for insert with check (
    exists (
      select 1 from fantasy_lineups l
      where l.id = lineup_id and l.user_id = auth.uid() and l.status <> 'locked'
    )
  );

drop policy if exists fantasy_lineup_drivers_delete_own on fantasy_lineup_drivers;
create policy fantasy_lineup_drivers_delete_own on fantasy_lineup_drivers
  for delete using (
    exists (
      select 1 from fantasy_lineups l
      where l.id = lineup_id and l.user_id = auth.uid() and l.status <> 'locked'
    )
  );

-- Service role bypasses RLS for admin/API routes.
