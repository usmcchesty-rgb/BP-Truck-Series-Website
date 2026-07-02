-- Number reservation workflow for driver applications.
-- Run once in the Supabase SQL editor.

create table if not exists driver_number_reservations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  number text not null,
  status text not null default 'pending',
  application_id uuid references driver_applications (id) on delete set null,
  driver_id text,
  iracing_customer_id text,
  note text,
  constraint driver_number_reservations_status_check
    check (status in ('available', 'pending', 'assigned', 'reserved', 'released'))
);

create unique index if not exists driver_number_reservations_active_number_uidx
  on driver_number_reservations (number)
  where status in ('pending', 'assigned', 'reserved');

create index if not exists driver_number_reservations_application_id_idx
  on driver_number_reservations (application_id);

create index if not exists driver_number_reservations_status_idx
  on driver_number_reservations (status);

create index if not exists driver_number_reservations_number_idx
  on driver_number_reservations (number);
