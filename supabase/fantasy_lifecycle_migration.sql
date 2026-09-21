-- Fantasy week/race lifecycle automation setting + last-run snapshot.
-- Persisted on existing site_settings (no new table).
-- Run this in the Supabase SQL editor BEFORE deploying Fantasy automation.

alter table site_settings
  add column if not exists "fantasyLifecycle" jsonb default '{"automationEnabled": true}'::jsonb;

update site_settings
set "fantasyLifecycle" = '{"automationEnabled": true}'::jsonb
where id = 1
  and "fantasyLifecycle" is null;

-- Atomic cross-instance lock: one UPDATE claims the row, or zero rows are returned.
create or replace function claim_fantasy_lifecycle_lock(
  p_token text,
  p_trigger text,
  p_ttl_seconds integer
) returns jsonb
language plpgsql
as $$
declare
  claimed jsonb;
  ttl integer := greatest(5, coalesce(p_ttl_seconds, 90));
begin
  update site_settings
  set "fantasyLifecycle" = coalesce("fantasyLifecycle", '{"automationEnabled": true}'::jsonb)
    || jsonb_build_object(
      'lockToken', p_token,
      'lockTrigger', p_trigger,
      'lockUntil', (now() + make_interval(secs => ttl))
    )
  where id = 1
    and (
      coalesce("fantasyLifecycle"->>'lockToken', '') = ''
      or coalesce(("fantasyLifecycle"->>'lockUntil')::timestamptz, '-infinity'::timestamptz) <= now()
    )
  returning "fantasyLifecycle" into claimed;

  if claimed is null then
    return jsonb_build_object('acquired', false);
  end if;
  return jsonb_build_object('acquired', true, 'lockToken', p_token);
end;
$$;

revoke all on function claim_fantasy_lifecycle_lock(text, text, integer) from public, anon, authenticated;
grant execute on function claim_fantasy_lifecycle_lock(text, text, integer) to service_role;
