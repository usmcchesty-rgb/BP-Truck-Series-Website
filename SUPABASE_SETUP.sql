create table if not exists site_settings (
  id int primary key default 1,
  "seriesName" text,
  "seasonName" text,
  "standingsUrl" text,
  "scheduleUrl" text,
  "playoffCut" int,
  "refreshSeconds" int,
  "raceStartTime" text
);

-- If upgrading an existing site_settings table, run once:
alter table site_settings add column if not exists "raceStartTime" text;

insert into site_settings (id, "seriesName", "seasonName", "standingsUrl", "scheduleUrl", "playoffCut", "refreshSeconds")
values (1, 'Blazing Pedals Truck Series', 'Season 11', 'https://www.simracerhub.com/scoring/season_standings.php?season_id=27987', 'https://www.simracerhub.com/scoring/season_schedule.php?season_id=27987', 16, 60)
on conflict (id) do nothing;

-- If upgrading from the old slug-based driver_profiles table, run once:
-- drop table if exists driver_profiles;

-- Driver photo uploads (Supabase Storage)
-- Run once in the Supabase SQL editor:
--
-- insert into storage.buckets (id, name, public)
-- values ('driver-photos', 'driver-photos', true)
-- on conflict (id) do update set public = true;
--
-- create policy "Public read driver photos"
-- on storage.objects for select
-- using (bucket_id = 'driver-photos');

create table if not exists driver_profiles (
  driver_id text primary key,
  iracing_name text not null,
  display_name text,
  car_number text,
  photo_url text,
  active boolean default true,
  updated_at timestamptz default now()
);

-- Power Rankings (weekly Top 10 + optional honorable mentions)
create table if not exists power_rankings_weeks (
  id serial primary key,
  race_number int not null,
  published_date date,
  published boolean default false,
  prophet_take text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Existing deployments: run once to add The Pedal Prophet weekly article column
-- alter table power_rankings_weeks add column if not exists prophet_take text;

create unique index if not exists power_rankings_weeks_race_number_idx
  on power_rankings_weeks (race_number);

create table if not exists power_rankings_entries (
  id serial primary key,
  week_id int not null references power_rankings_weeks(id) on delete cascade,
  rank int not null check (rank >= 1 and rank <= 10),
  driver_id text not null,
  movement int default 0,
  subtitle text not null default '',
  writeup text not null default '',
  unique (week_id, rank),
  unique (week_id, driver_id)
);

create table if not exists power_rankings_honorable_mentions (
  id serial primary key,
  week_id int not null references power_rankings_weeks(id) on delete cascade,
  sort_order int not null check (sort_order >= 1 and sort_order <= 3),
  driver_id text not null,
  writeup text not null default '',
  unique (week_id, sort_order)
);
