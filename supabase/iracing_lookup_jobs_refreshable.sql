-- BP Recruit Scanner: allow refreshed iRacing lookup jobs per application.
-- Keeps one active lookup job per application while preserving completed/failed history.

alter table iracing_lookup_jobs
  add column if not exists reason text not null default 'application_submitted';

alter table iracing_lookup_jobs
  drop constraint if exists iracing_lookup_jobs_reason_check;

alter table iracing_lookup_jobs
  add constraint iracing_lookup_jobs_reason_check
  check (reason in ('application_submitted', 'manual_refresh', 'scheduled_refresh', 'retry_failed'));

drop index if exists iracing_lookup_jobs_application_id_idx;
drop index if exists iracing_lookup_jobs_active_application_id_idx;

create unique index iracing_lookup_jobs_active_application_id_idx
  on iracing_lookup_jobs (application_id)
  where status in ('queued', 'processing', 'needs_login');

create or replace function enqueue_iracing_lookup_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into iracing_lookup_jobs (application_id, customer_id, status, reason)
  values (new.id, new.iracing_customer_id, 'queued', 'application_submitted')
  on conflict (application_id) where status in ('queued', 'processing', 'needs_login')
  do nothing;

  return new;
end;
$$;
