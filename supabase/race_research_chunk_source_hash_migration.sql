-- Additive migration: tie transcript chunks to parent source content identity.
-- Run after race_research_intelligence_migration.sql
-- Existing chunks with NULL source_content_hash are treated as stale by application code.

alter table race_research_chunks
  add column if not exists source_content_hash text;

alter table race_research_chunks
  add column if not exists chunking_policy_version text;

comment on column race_research_chunks.source_content_hash is
  'Parent race_research_sources.content_hash when chunk was created; NULL means stale until reprocessed.';

comment on column race_research_chunks.chunking_policy_version is
  'Application chunking policy version when chunk was created; NULL means stale until reprocessed.';

create index if not exists race_research_chunks_source_content_hash_idx
  on race_research_chunks (source_id, source_content_hash);

-- Rollback (manual, if needed):
-- drop index if exists race_research_chunks_source_content_hash_idx;
-- alter table race_research_chunks drop column if exists source_content_hash;
