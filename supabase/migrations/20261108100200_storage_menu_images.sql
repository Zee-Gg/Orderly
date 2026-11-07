-- Public bucket for menu photos. Path: {restaurant_id}/items/{file}.webp
-- Anyone can view; only owners/managers write inside their own restaurant folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'menu-images',
  'menu-images',
  true,
  2097152,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

create policy "menu-images: owner/manager read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'menu-images'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}')
  );

create policy "menu-images: owner/manager upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}')
  );

create policy "menu-images: owner/manager replace in own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'menu-images'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}')
  )
  with check (
    bucket_id = 'menu-images'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}')
  );

create policy "menu-images: owner/manager delete in own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}')
  );
