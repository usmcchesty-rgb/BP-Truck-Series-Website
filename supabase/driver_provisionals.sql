-- BP Fantasy league provisional ledger — administration only.
-- Official race results remain sourced from SimRacerHub.
-- Run manually in Supabase SQL editor after reviewing.

create table if not exists driver_provisionals (
  id bigserial primary key,
  season_id text not null,
  driver_id text not null,
  race_number int not null,
  type text not null check (type in ('free', 'purchased', 'admin')),
  notes text,
  created_at timestamptz not null default now(),
  created_by text,
  unique (season_id, driver_id, race_number)
);

create index if not exists driver_provisionals_season_driver_idx
  on driver_provisionals (season_id, driver_id);

create index if not exists driver_provisionals_season_race_idx
  on driver_provisionals (season_id, race_number);
