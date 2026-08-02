-- Race Intelligence Package — research sources, chunks, facts, and package status
-- Run once in the Supabase SQL editor after SUPABASE_SETUP.sql
-- Non-destructive: creates new tables only.
--
-- Access: no RLS on these tables (same pattern as race_control_reports).
-- Server API uses Supabase service role; no anonymous client write policies.

create extension if not exists pgcrypto;

-- 1. Raw sources per race
create table if not exists race_research_sources (
  id uuid primary key default gen_random_uuid(),
  season_id text not null,
  race_number integer not null check (race_number >= 1),
  race_id text,
  source_type text not null,
  source_key text not null default '',
  title text,
  original_filename text,
  source_url text,
  raw_text text,
  storage_path text,
  content_hash text not null,
  character_count integer,
  processing_status text not null default 'pending',
  processing_error text,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (season_id, race_number, source_type, source_key)
);

create index if not exists race_research_sources_season_race_idx
  on race_research_sources (season_id, race_number desc);

create index if not exists race_research_sources_type_status_idx
  on race_research_sources (source_type, processing_status);

create index if not exists race_research_sources_season_race_hash_idx
  on race_research_sources (season_id, race_number, content_hash);

-- 2. Chunks for large sources
create table if not exists race_research_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references race_research_sources(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  start_character integer,
  end_character integer,
  start_timestamp numeric,
  end_timestamp numeric,
  chunk_text text not null,
  content_hash text not null,
  processing_status text not null default 'pending',
  extraction_version text not null default '2.0',
  extraction_method text,
  extraction_cache jsonb,
  processing_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create index if not exists race_research_chunks_source_idx
  on race_research_chunks (source_id, chunk_index);

create index if not exists race_research_chunks_hash_version_idx
  on race_research_chunks (content_hash, extraction_version);

-- 3. Normalized facts (orphan cleanup handled in API when removing source links)
create table if not exists race_facts (
  id uuid primary key default gen_random_uuid(),
  season_id text not null,
  race_number integer not null check (race_number >= 1),
  race_id text,
  fact_type text not null,
  category text not null default '',
  summary text not null,
  driver_ids text[] not null default '{}',
  driver_names text[] not null default '{}',
  team_names text[] not null default '{}',
  lap_number integer,
  sequence_order integer,
  importance_score numeric not null default 0,
  confidence text not null default 'unverified',
  structured_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists race_facts_season_race_idx
  on race_facts (season_id, race_number desc);

create index if not exists race_facts_type_importance_idx
  on race_facts (fact_type, importance_score desc);

-- 4. Fact ↔ source evidence (cascade removes links; facts deleted only when no links remain — API)
create table if not exists race_fact_sources (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references race_facts(id) on delete cascade,
  source_id uuid not null references race_research_sources(id) on delete cascade,
  chunk_id uuid references race_research_chunks(id) on delete set null,
  source_start_character integer,
  source_end_character integer,
  source_start_timestamp numeric,
  source_end_timestamp numeric,
  source_excerpt text,
  support_type text not null default 'primary',
  created_at timestamptz not null default now()
);

create index if not exists race_fact_sources_fact_idx on race_fact_sources (fact_id);
create index if not exists race_fact_sources_source_idx on race_fact_sources (source_id);

-- 5. Package readiness
create table if not exists race_package_status (
  id uuid primary key default gen_random_uuid(),
  season_id text not null,
  race_number integer not null check (race_number >= 1),
  race_id text,
  package_version text not null default '1.0',
  package_status text not null default 'empty',
  source_count integer not null default 0,
  processed_source_count integer not null default 0,
  fact_count integer not null default 0,
  event_count integer not null default 0,
  quote_count integer not null default 0,
  conflict_count integer not null default 0,
  coverage_score numeric not null default 0,
  source_coverage jsonb not null default '{}'::jsonb,
  last_built_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, race_number)
);

create index if not exists race_package_status_season_race_idx
  on race_package_status (season_id, race_number desc);