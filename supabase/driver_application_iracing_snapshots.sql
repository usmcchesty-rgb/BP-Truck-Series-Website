-- iRacing profile license snapshots from BP Recruit Scanner (Phase 3)
-- Run once in the Supabase SQL editor.

create table if not exists driver_application_iracing_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  application_id uuid not null references driver_applications (id) on delete cascade,
  job_id uuid references iracing_lookup_jobs (id) on delete set null,
  customer_id text,
  source text not null default 'iracing_ui_profile',
  scrape_status text not null,
  scrape_error text,
  display_name text,
  oval_license_class text,
  oval_safety_rating text,
  oval_irating integer,
  raw_text text
);

create index if not exists driver_application_iracing_snapshots_application_id_idx
  on driver_application_iracing_snapshots (application_id);

create index if not exists driver_application_iracing_snapshots_customer_id_idx
  on driver_application_iracing_snapshots (customer_id);

create index if not exists driver_application_iracing_snapshots_created_at_idx
  on driver_application_iracing_snapshots (created_at desc);
