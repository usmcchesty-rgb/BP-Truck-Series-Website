-- Driver roster fields used by approved applications and iRacing ID backfills.
-- Run once in the Supabase SQL editor.

alter table driver_profiles
  add column if not exists iracing_customer_id text,
  add column if not exists source_application_id uuid references driver_applications (id) on delete set null,
  add column if not exists approved_application_at timestamptz;

create unique index if not exists driver_profiles_iracing_customer_id_uidx
  on driver_profiles (iracing_customer_id)
  where iracing_customer_id is not null and iracing_customer_id <> '';

create index if not exists driver_profiles_source_application_id_idx
  on driver_profiles (source_application_id);
