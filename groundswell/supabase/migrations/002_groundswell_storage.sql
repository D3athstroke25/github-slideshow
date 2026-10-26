-- Public "media" bucket for cover images, avatars and story images.
-- Anyone can read. Uploads are accepted only at a path issued by gs_upload_ticket() in the
-- last 30 minutes, so only signed-in Groundswell users can add files, and only where told.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "gs upload with ticket" on storage.objects;
create policy "gs upload with ticket" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and public.gs_ticket_ok(name));
