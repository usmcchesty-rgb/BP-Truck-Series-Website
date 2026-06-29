-- Race Control parser reference fixtures (admin regression / learning)
-- Run once in the Supabase SQL editor after race_control_reports exists.

create table if not exists race_control_parser_fixtures (
  id bigserial primary key,
  report_id bigint references race_control_reports(id) on delete set null,
  season_id text not null,
  race_number integer not null,
  track_name text,
  expected_winner text,
  expected_sof integer,
  expected_driver_count integer,
  expected_caution_count integer,
  expected_stage_count integer,
  expected_parser_version text,
  expected_min_confidence text,
  notes text,
  is_reference boolean not null default true,
  last_regression_at timestamptz,
  last_regression_status text,
  last_regression_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, race_number)
);

create index if not exists race_control_parser_fixtures_season_idx
  on race_control_parser_fixtures (season_id, race_number desc);

create table if not exists race_control_parser_regression_state (
  id integer primary key default 1 check (id = 1),
  last_run_at timestamptz,
  last_parser_version text,
  last_summary jsonb,
  updated_at timestamptz not null default now()
);

insert into race_control_parser_regression_state (id)
values (1)
on conflict (id) do nothing;
