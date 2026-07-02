-- Contact fields synced from approved driver applications.
-- Run once in the Supabase SQL editor.

alter table driver_profiles
  add column if not exists discord_name text,
  add column if not exists timezone text;
