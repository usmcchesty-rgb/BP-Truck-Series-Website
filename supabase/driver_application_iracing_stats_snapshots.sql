-- iRacing profile career stats snapshots from BP Recruit Scanner (Phase 4)
-- Run once in the Supabase SQL editor.

create table if not exists driver_application_iracing_stats_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  application_id uuid not null references driver_applications (id) on delete cascade,
  job_id uuid references iracing_lookup_jobs (id) on delete set null,
  customer_id text,
  source text not null default 'iracing_ui_profile_stats',
  scrape_status text not null,
  scrape_error text,
  category text,
  starts integer,
  wins integer,
  top5 integer,
  poles integer,
  avg_start numeric,
  avg_finish numeric,
  total_laps integer,
  laps_led integer,
  incidents_per_race numeric,
  points_per_race numeric,
  win_percentage numeric,
  top5_percentage numeric,
  raw_text text,
  raw_json jsonb
);

create index if not exists driver_application_iracing_stats_snapshots_application_id_idx
  on driver_application_iracing_stats_snapshots (application_id);

create index if not exists driver_application_iracing_stats_snapshots_customer_id_idx
  on driver_application_iracing_stats_snapshots (customer_id);

create index if not exists driver_application_iracing_stats_snapshots_created_at_idx
  on driver_application_iracing_stats_snapshots (created_at desc);
