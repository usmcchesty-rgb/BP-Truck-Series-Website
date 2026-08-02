-- Race Intelligence — atomic fact swap, canonical facts, source version history
-- Additive migration. Run after race_research_intelligence_migration.sql

-- ---------------------------------------------------------------------------
-- Source version history (active row remains on race_research_sources)
-- ---------------------------------------------------------------------------
create table if not exists race_research_source_versions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references race_research_sources(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  content_hash text not null,
  raw_text text,
  source_metadata jsonb not null default '{}'::jsonb,
  processing_version text,
  is_active boolean not null default false,
  fact_count_at_version integer,
  chunk_count_at_version integer,
  created_at timestamptz not null default now(),
  unique (source_id, version_number),
  unique (source_id, content_hash)
);

create index if not exists race_research_source_versions_source_idx
  on race_research_source_versions (source_id, version_number desc);

-- ---------------------------------------------------------------------------
-- Canonical facts (cross-source consolidated layer)
-- ---------------------------------------------------------------------------
create table if not exists race_canonical_facts (
  id uuid primary key default gen_random_uuid(),
  season_id text not null,
  race_number integer not null check (race_number >= 1),
  canonical_code text not null,
  fact_type text not null,
  category text not null default '',
  summary text not null,
  driver_ids text[] not null default '{}',
  driver_names text[] not null default '{}',
  lap_number integer,
  sequence_order integer,
  importance_score numeric not null default 0,
  current_confidence text not null default 'unverified',
  confidence_history jsonb not null default '[]'::jsonb,
  structured_data jsonb not null default '{}'::jsonb,
  is_conflicting boolean not null default false,
  conflict_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, race_number, canonical_code)
);

create index if not exists race_canonical_facts_season_race_idx
  on race_canonical_facts (season_id, race_number desc);

alter table race_facts
  add column if not exists canonical_fact_id uuid references race_canonical_facts(id) on delete set null;

create index if not exists race_facts_canonical_fact_idx
  on race_facts (canonical_fact_id);

create table if not exists race_canonical_fact_evidence (
  id uuid primary key default gen_random_uuid(),
  canonical_fact_id uuid not null references race_canonical_facts(id) on delete cascade,
  source_id uuid not null references race_research_sources(id) on delete cascade,
  extracted_fact_id uuid references race_facts(id) on delete set null,
  chunk_id uuid references race_research_chunks(id) on delete set null,
  source_type text,
  source_excerpt text,
  support_type text not null default 'primary',
  created_at timestamptz not null default now(),
  unique (canonical_fact_id, source_id, extracted_fact_id)
);

create index if not exists race_canonical_fact_evidence_canonical_idx
  on race_canonical_fact_evidence (canonical_fact_id);

create table if not exists race_canonical_fact_history (
  id uuid primary key default gen_random_uuid(),
  canonical_fact_id uuid not null references race_canonical_facts(id) on delete cascade,
  previous_summary text,
  previous_confidence text,
  previous_evidence_count integer,
  changed_at timestamptz not null default now(),
  change_reason text
);

create index if not exists race_canonical_fact_history_fact_idx
  on race_canonical_fact_history (canonical_fact_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- Atomic per-source fact replacement (service role only)
-- ---------------------------------------------------------------------------
create or replace function swap_source_facts_atomic(
  p_source_id uuid,
  p_facts jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fact jsonb;
  v_link jsonb;
  v_new_fact_id uuid;
  v_new_ids uuid[] := '{}';
  v_old_ids uuid[];
  v_old_id uuid;
  v_link_count integer;
  v_facts_created integer := 0;
begin
  if p_source_id is null then
    raise exception 'source_id required';
  end if;

  select coalesce(array_agg(distinct fact_id), '{}') into v_old_ids
  from race_fact_sources
  where source_id = p_source_id;

  if p_facts is null or jsonb_typeof(p_facts) <> 'array' then
    p_facts := '[]'::jsonb;
  end if;

  for v_fact in select * from jsonb_array_elements(p_facts)
  loop
    insert into race_facts (
      season_id, race_number, race_id, fact_type, category, summary,
      driver_ids, driver_names, team_names, lap_number, sequence_order,
      importance_score, confidence, structured_data, first_seen_at, updated_at
    ) values (
      v_fact->>'seasonId',
      (v_fact->>'raceNumber')::integer,
      nullif(v_fact->>'raceId', ''),
      v_fact->>'factType',
      coalesce(v_fact->>'category', ''),
      v_fact->>'summary',
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_fact->'driverIds', '[]'::jsonb)) t(x)), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_fact->'driverNames', '[]'::jsonb)) t(x)), '{}'),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(v_fact->'teamNames', '[]'::jsonb)) t(x)), '{}'),
      nullif(v_fact->>'lapNumber', '')::integer,
      nullif(v_fact->>'sequenceOrder', '')::integer,
      coalesce((v_fact->>'importanceScore')::numeric, 0),
      coalesce(v_fact->>'confidence', 'unverified'),
      coalesce(v_fact->'structuredData', '{}'::jsonb),
      now(),
      now()
    )
    returning id into v_new_fact_id;

    v_new_ids := array_append(v_new_ids, v_new_fact_id);
    v_facts_created := v_facts_created + 1;

    for v_link in select * from jsonb_array_elements(coalesce(v_fact->'evidenceLinks', '[]'::jsonb))
    loop
      insert into race_fact_sources (
        fact_id, source_id, chunk_id,
        source_start_character, source_end_character,
        source_start_timestamp, source_end_timestamp,
        source_excerpt, support_type
      ) values (
        v_new_fact_id,
        (v_link->>'sourceId')::uuid,
        nullif(v_link->>'chunkId', '')::uuid,
        nullif(v_link->>'sourceStartCharacter', '')::integer,
        nullif(v_link->>'sourceEndCharacter', '')::integer,
        nullif(v_link->>'sourceStartTimestamp', '')::numeric,
        nullif(v_link->>'sourceEndTimestamp', '')::numeric,
        nullif(v_link->>'sourceExcerpt', ''),
        coalesce(v_link->>'supportType', 'primary')
      );
    end loop;
  end loop;

  if v_old_ids is not null and array_length(v_old_ids, 1) > 0 then
    delete from race_fact_sources
    where source_id = p_source_id
      and fact_id = any(v_old_ids);

    foreach v_old_id in array v_old_ids
    loop
      if v_old_id = any(v_new_ids) then
        continue;
      end if;
      select count(*) into v_link_count from race_fact_sources where fact_id = v_old_id;
      if v_link_count = 0 then
        delete from race_facts where id = v_old_id;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'factsCreated', v_facts_created,
    'newFactIds', to_jsonb(v_new_ids),
    'replacedFactCount', coalesce(array_length(v_old_ids, 1), 0)
  );
exception when others then
  raise;
end;
$$;

revoke all on function swap_source_facts_atomic(uuid, jsonb) from public;
grant execute on function swap_source_facts_atomic(uuid, jsonb) to service_role;

-- Rollback (manual):
-- drop function if exists swap_source_facts_atomic(uuid, jsonb);
-- drop table if exists race_canonical_fact_history;
-- drop table if exists race_canonical_fact_evidence;
-- alter table race_facts drop column if exists canonical_fact_id;
-- drop table if exists race_canonical_facts;
-- drop table if exists race_research_source_versions;
