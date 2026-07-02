-- Private admin-only contact email for driver profiles.
-- Run once in the Supabase SQL editor.

alter table driver_profiles
  add column if not exists form_email text;

comment on column driver_profiles.form_email is
  'Private admin-only contact email. Not shown on public driver pages.';
