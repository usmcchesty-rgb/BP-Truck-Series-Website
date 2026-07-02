-- SRH disconnect metrics for application career snapshots.
-- Run once in the Supabase SQL editor.

alter table driver_application_srh_career_snapshots
  add column if not exists career_disconnects integer,
  add column if not exists career_disconnect_rate numeric,
  add column if not exists career_incidents_per_start numeric;
