-- iRacing lookup job queue for BP Recruit Scanner (Phase 1)
-- Run once in the Supabase SQL editor.

create table if not exists iracing_lookup_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  application_id uuid not null references driver_applications (id) on delete cascade,
  customer_id text,
  status text not null default 'queued',
  attempts integer not null default 0,
  worker_name text,
  started_at timestamptz,
  completed_at timestamptz,
  error text
);

create index if not exists iracing_lookup_jobs_status_idx
  on iracing_lookup_jobs (status);

create unique index if not exists iracing_lookup_jobs_application_id_idx
  on iracing_lookup_jobs (application_id);

create or replace function iracing_lookup_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists iracing_lookup_jobs_updated_at on iracing_lookup_jobs;

create trigger iracing_lookup_jobs_updated_at
before update on iracing_lookup_jobs
for each row
execute function iracing_lookup_jobs_set_updated_at();

create or replace function enqueue_iracing_lookup_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into iracing_lookup_jobs (application_id, customer_id, status)
  values (new.id, new.iracing_customer_id, 'queued')
  on conflict (application_id) do nothing;

  return new;
end;
$$;

drop trigger if exists driver_applications_enqueue_lookup on driver_applications;

create trigger driver_applications_enqueue_lookup
after insert on driver_applications
for each row
execute function enqueue_iracing_lookup_job();

-- Enable Realtime events for the local Recruit Scanner.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'iracing_lookup_jobs'
  ) then
    alter publication supabase_realtime add table iracing_lookup_jobs;
  end if;
end;
$$;
