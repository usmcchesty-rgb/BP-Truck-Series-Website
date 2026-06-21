create table if not exists site_settings (
  id int primary key default 1,
  "seriesName" text,
  "seasonName" text,
  "standingsUrl" text,
  "scheduleUrl" text,
  "playoffCut" int,
  "refreshSeconds" int,
  "raceStartTime" text,
  "raceCompletionBufferMinutes" int,
  "headerLogoUrl" text,
  "headerLogoAltText" text,
  "headerLogoUpdatedAt" timestamptz,
  "milesApexImageUrl" text,
  "milesApexImageUpdatedAt" timestamptz,
  "milesApexImageZoom" numeric default 1,
  "milesApexImageX" numeric default 50,
  "milesApexImageY" numeric default 50
);

-- If upgrading an existing site_settings table, run once:
alter table site_settings add column if not exists "raceStartTime" text;
alter table site_settings add column if not exists "raceCompletionBufferMinutes" int;
alter table site_settings add column if not exists "headerLogoUrl" text;
alter table site_settings add column if not exists "headerLogoAltText" text;
alter table site_settings add column if not exists "headerLogoUpdatedAt" timestamptz;
alter table site_settings add column if not exists "milesApexImageUrl" text;
alter table site_settings add column if not exists "milesApexImageUpdatedAt" timestamptz;
alter table site_settings add column if not exists "milesApexImageZoom" numeric default 1;
alter table site_settings add column if not exists "milesApexImageX" numeric default 50;
alter table site_settings add column if not exists "milesApexImageY" numeric default 50;
alter table site_settings add column if not exists "powerRankingsFormulaImageUrl" text;
alter table site_settings add column if not exists "powerRankingsFormulaImageUpdatedAt" timestamptz;
alter table site_settings add column if not exists "fantasyHeroBackgroundUrl" text;
alter table site_settings add column if not exists "fantasyHeroBackgroundUpdatedAt" timestamptz;
alter table site_settings add column if not exists "fantasyHeaderLogoUrl" text;
alter table site_settings add column if not exists "fantasyHeaderLogoUpdatedAt" timestamptz;
alter table site_settings add column if not exists "fantasyHeaderLogoTopPercent" numeric;
alter table site_settings add column if not exists "fantasyHeaderLogoWidthVw" numeric;
alter table site_settings add column if not exists "fantasyHeaderLogoMaxWidthPx" numeric;

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
-- insert into storage.buckets (id, name, public)
-- values ('driver-standing-photos', 'driver-standing-photos', true)
-- on conflict (id) do update set public = true;
--
-- create policy "Public read driver photos"
-- on storage.objects for select
-- using (bucket_id = 'driver-photos');
--
-- Public site assets (header logo)
-- insert into storage.buckets (id, name, public)
-- values ('site-assets', 'site-assets', true)
-- on conflict (id) do update set public = true;
--
-- create policy "Public read site assets"
-- on storage.objects for select
-- using (bucket_id = 'site-assets');

create table if not exists driver_profiles (
  driver_id text primary key,
  iracing_name text not null,
  display_name text,
  car_number text,
  photo_url text,
  active boolean default true,
  is_streamer boolean default false,
  stream_url text,
  date_of_birth text,
  hometown text,
  team text,
  updated_at timestamptz default now()
);

-- Existing deployments: run once (safe to re-run)
alter table driver_profiles add column if not exists is_streamer boolean default false;
alter table driver_profiles add column if not exists stream_url text;
alter table driver_profiles add column if not exists date_of_birth text;
alter table driver_profiles add column if not exists hometown text;
alter table driver_profiles add column if not exists team text;

-- Google Form bio sync fields (run once on existing deployments)
alter table driver_profiles add column if not exists bio text;
alter table driver_profiles add column if not exists years_sim_racing text;
alter table driver_profiles add column if not exists driving_style text;
alter table driver_profiles add column if not exists favorite_track text;
alter table driver_profiles add column if not exists favorite_nascar_driver text;
alter table driver_profiles add column if not exists sim_racing_accomplishment text;
alter table driver_profiles add column if not exists season_goal text;
alter table driver_profiles add column if not exists fun_fact text;
alter table driver_profiles add column if not exists facebook_url text;
alter table driver_profiles add column if not exists twitter_url text;
alter table driver_profiles add column if not exists instagram_url text;
alter table driver_profiles add column if not exists youtube_url text;
alter table driver_profiles add column if not exists twitch_url text;
alter table driver_profiles add column if not exists tiktok_url text;
alter table driver_profiles add column if not exists car_image_url text;
alter table driver_profiles add column if not exists form_email text;
alter table driver_profiles add column if not exists form_submitted_at timestamptz;
alter table driver_profiles add column if not exists form_permission_granted boolean default false;
alter table driver_profiles add column if not exists standing_photo_url text;
alter table driver_profiles add column if not exists standing_photo_zoom numeric default 1;
alter table driver_profiles add column if not exists standing_photo_x numeric default 50;
alter table driver_profiles add column if not exists standing_photo_y numeric default 50;
alter table driver_profiles add column if not exists standing_photo_updated_at timestamptz;
alter table driver_profiles add column if not exists standing_photo_enabled boolean default true;

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

create table if not exists news_articles (
  id bigint generated always as identity primary key,
  article_type text not null,
  headline text not null,
  subheadline text,
  slug text unique,
  summary text,
  body text not null,
  author text default 'Miles Apex',
  race_number integer,
  spotlight_driver_id text,
  published boolean default false,
  featured_image_url text,
  featured_image_zoom numeric default 1,
  featured_image_x numeric default 50,
  featured_image_y numeric default 50,
  featured_image_display_mode text default 'fill',
  featured_image_updated_at timestamptz,
  news_topic text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  published_at timestamptz
);

-- Existing deployments: run once
-- alter table news_articles add column if not exists spotlight_driver_id text;
alter table news_articles add column if not exists featured_image_zoom numeric default 1;
alter table news_articles add column if not exists featured_image_x numeric default 50;
alter table news_articles add column if not exists featured_image_y numeric default 50;
alter table news_articles add column if not exists featured_image_updated_at timestamptz;
alter table news_articles add column if not exists spotlight_image_url text;
alter table news_articles add column if not exists spotlight_image_updated_at timestamptz;
alter table news_articles add column if not exists featured_image_display_mode text default 'fill';
alter table news_articles add column if not exists news_topic text;

create table if not exists race_transcripts (
  id bigint generated always as identity primary key,
  race_number integer not null unique,
  race_name text,
  transcript text not null,
  source_url text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
