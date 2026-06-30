-- BP Recruit Scanner Phase 2: allowed lookup job statuses
-- Run once in the Supabase SQL editor if iracing_lookup_jobs already exists.

alter table iracing_lookup_jobs
  drop constraint if exists iracing_lookup_jobs_status_check;

alter table iracing_lookup_jobs
  add constraint iracing_lookup_jobs_status_check
  check (status in ('queued', 'processing', 'completed', 'failed', 'needs_login'));
