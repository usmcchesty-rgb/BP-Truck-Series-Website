-- BP Fantasy post-race lineup scoring — run after fantasy_launch.sql
-- Idempotent race/week scoring storage. Does not alter submitted lineups.

alter table site_settings add column if not exists "fantasyRaceScoringConfig" jsonb default '{}'::jsonb;

create table if not exists fantasy_driver_scores (
  id bigserial primary key,
  slate_id int not null references fantasy_slates(id) on delete cascade,
  driver_id text not null,
  race_number int not null,
  finish_position int,
  start_position int,
  positions_gained numeric,
  base_points numeric not null default 0,
  bonus_points numeric not null default 0,
  penalty_points numeric not null default 0,
  total_points numeric not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  scoring_version text not null default 'fantasy-race-v1-default',
  scored_at timestamptz not null default now(),
  unique (slate_id, driver_id)
);

create index if not exists fantasy_driver_scores_slate_idx
  on fantasy_driver_scores (slate_id);

create table if not exists fantasy_lineup_scores (
  id bigserial primary key,
  slate_id int not null references fantasy_slates(id) on delete cascade,
  lineup_id uuid not null references fantasy_lineups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  race_number int not null,
  total_points numeric not null default 0,
  rank int not null default 0,
  scoring_version text not null default 'fantasy-race-v1-default',
  breakdown jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null default now(),
  unique (lineup_id, slate_id)
);

create index if not exists fantasy_lineup_scores_slate_idx
  on fantasy_lineup_scores (slate_id);

create index if not exists fantasy_lineup_scores_season_race_idx
  on fantasy_lineup_scores (race_number);
