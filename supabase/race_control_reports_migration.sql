-- Race Control PDF reports (supplemental race data — not required for site operation)
-- Run once in the Supabase SQL editor.

create table if not exists race_control_reports (
  id bigserial primary key,
  season_id text not null,
  race_number integer not null,
  track_name text,
  race_date text,
  file_url text,
  file_path text,
  original_filename text,
  uploaded_at timestamptz,
  uploaded_by text,
  parse_status text not null default 'uploaded',
  parse_error text,
  parsed_text text,
  parsed_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, race_number)
);

create index if not exists race_control_reports_season_race_idx
  on race_control_reports (season_id, race_number desc);

-- Storage bucket for Race Control PDFs
insert into storage.buckets (id, name, public)
values ('race-control-pdfs', 'race-control-pdfs', true)
on conflict (id) do update set public = true;

create policy "Public read race control pdfs"
on storage.objects
for select
using (bucket_id = 'race-control-pdfs');

-- Service role uploads via API; no direct client write policy required.
