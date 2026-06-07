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

create table if not exists driver_profiles (
  slug text primary key,
  driver_name text not null,
  iracing_id text,
  truck_number text,
  photo_url text,
  manufacturer text,
  team text,
  updated_at timestamptz default now()
);
