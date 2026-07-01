-- SimRacerHub all-leagues career snapshots for driver applications.
-- Run once in the Supabase SQL editor.

create table if not exists driver_application_srh_career_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  application_id uuid not null references driver_applications (id) on delete cascade,
  source text not null default 'simracerhub_driver_stats_all_leagues',
  scrape_status text not null,
  scrape_error text,
  lookup_name text,
  matched_driver_id text,
  matched_driver_name text,
  match_confidence text,
  match_candidates_json jsonb,
  career_starts integer,
  career_wins integer,
  career_top5s integer,
  career_top10s integer,
  career_average_finish numeric,
  career_poles integer,
  career_laps_led integer,
  career_incidents integer,
  career_incidents_per_race numeric,
  race_entries_used integer,
  source_url text,
  raw_search_json jsonb,
  career_stats_json jsonb
);

create index if not exists driver_application_srh_career_snapshots_application_id_idx
  on driver_application_srh_career_snapshots (application_id);

create index if not exists driver_application_srh_career_snapshots_matched_driver_id_idx
  on driver_application_srh_career_snapshots (matched_driver_id);

create index if not exists driver_application_srh_career_snapshots_created_at_idx
  on driver_application_srh_career_snapshots (created_at desc);
