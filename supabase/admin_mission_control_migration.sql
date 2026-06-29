-- Admin Mission Control checklist state (per season + race week)
-- Run once in the Supabase SQL editor.

alter table site_settings add column if not exists "adminMissionControl" jsonb default '{}'::jsonb;

-- Backfill nulls for existing row
update site_settings set "adminMissionControl" = '{}'::jsonb where id = 1 and "adminMissionControl" is null;
