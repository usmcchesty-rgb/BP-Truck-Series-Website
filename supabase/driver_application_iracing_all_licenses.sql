-- Phase 4B/4C/4D: all license categories + full stats JSON + yearly progression
-- Run once in the Supabase SQL editor.

alter table driver_application_iracing_snapshots
  add column if not exists licenses_json jsonb;

alter table driver_application_iracing_stats_snapshots
  add column if not exists stats_json jsonb;

alter table driver_application_iracing_stats_snapshots
  add column if not exists yearly_stats_json jsonb;

alter table driver_application_iracing_stats_snapshots
  add column if not exists yearly_parse_status text;

alter table driver_application_iracing_stats_snapshots
  add column if not exists yearly_parse_error text;
