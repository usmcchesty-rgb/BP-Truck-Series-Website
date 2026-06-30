-- Per-track cache-bust versions for Supabase track image URLs (slug -> ms timestamp)
alter table site_settings add column if not exists "trackImageVersions" jsonb default '{}'::jsonb;

update site_settings
set "trackImageVersions" = '{}'::jsonb
where id = 1 and "trackImageVersions" is null;
