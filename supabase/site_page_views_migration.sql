-- Site analytics: anonymous page view tracking (no IP storage)
create table if not exists site_page_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  path text not null,
  full_url text,
  page_title text,
  referrer text,
  user_agent text,
  device_type text,
  browser text,
  os text,
  country text,
  region text,
  city text,
  session_id text,
  visitor_id text,
  is_admin boolean not null default false
);

create index if not exists site_page_views_created_at_idx
  on site_page_views (created_at desc);

create index if not exists site_page_views_path_idx
  on site_page_views (path);

create index if not exists site_page_views_visitor_id_idx
  on site_page_views (visitor_id);

create index if not exists site_page_views_session_id_idx
  on site_page_views (session_id);

create index if not exists site_page_views_is_admin_idx
  on site_page_views (is_admin);

alter table site_page_views enable row level security;
