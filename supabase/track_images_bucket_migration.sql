-- Track map PNGs for schedule / homepage previews
insert into storage.buckets (id, name, public)
values ('track-images', 'track-images', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read track images" on storage.objects;

create policy "Public read track images"
on storage.objects
for select
using (bucket_id = 'track-images');

-- Service role uploads via API; no direct client write policy required.
