-- Driver applications (Join Blazing Pedals — Phase 1)
-- Run once in the Supabase SQL editor.

create table if not exists driver_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending',
  driver_name text not null,
  iracing_customer_id text not null,
  discord_name text,
  email text,
  age_confirmed boolean not null default false,
  timezone text,
  preferred_number text,
  racing_background text,
  why_join text,
  referred_by text,
  admin_notes text,
  constraint driver_applications_status_check check (
    status in ('pending', 'reviewing', 'approved', 'rejected', 'waitlist', 'recruiting_race')
  )
);

create index if not exists driver_applications_created_at_idx
  on driver_applications (created_at desc);

create index if not exists driver_applications_status_idx
  on driver_applications (status);

create index if not exists driver_applications_iracing_customer_id_idx
  on driver_applications (iracing_customer_id);

-- One open application per iRacing Customer ID
create unique index if not exists driver_applications_open_iracing_id_idx
  on driver_applications (iracing_customer_id)
  where status in ('pending', 'reviewing', 'recruiting_race', 'waitlist');

create or replace function driver_applications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists driver_applications_updated_at on driver_applications;

create trigger driver_applications_updated_at
before update on driver_applications
for each row
execute function driver_applications_set_updated_at();
