-- Add iRacing display name to driver applications (Phase 1.5)
-- Run once in the Supabase SQL editor if driver_applications already exists.

alter table driver_applications
  add column if not exists iracing_display_name text;

alter table driver_applications
  alter column driver_name drop not null;

-- Backfill display name from legacy driver_name when present.
update driver_applications
set iracing_display_name = driver_name
where iracing_display_name is null
  and driver_name is not null
  and btrim(driver_name) <> '';
