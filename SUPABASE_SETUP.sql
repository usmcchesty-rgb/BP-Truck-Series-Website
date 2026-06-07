create table if not exists site_settings (
  id int primary key default 1,
  "seriesName" text,
  "seasonName" text,
  "standingsUrl" text,
  "scheduleUrl" text,
  "playoffCut" int,
  "refreshSeconds" int
);

insert into site_settings (id, "seriesName", "seasonName", "standingsUrl", "scheduleUrl", "playoffCut", "refreshSeconds")
values (1, 'Blazing Pedals Truck Series', 'Season 11', 'https://www.simracerhub.com/scoring/season_standings.php?season_id=27987', 'https://www.simracerhub.com/scoring/season_schedule.php?season_id=27987', 16, 60)
on conflict (id) do nothing;

-- If upgrading from the old slug-based driver_profiles table, run once:
-- drop table if exists driver_profiles;

create table if not exists driver_profiles (
  driver_id text primary key,
  iracing_name text not null,
  display_name text,
  car_number text,
  photo_url text,
  active boolean default true,
  updated_at timestamptz default now()
);
