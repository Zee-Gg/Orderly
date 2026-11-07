-- Public bucket for restaurant logos. Path: {restaurant_id}/{file}.
-- Anyone can view; only owners can write to their own restaurant's folder.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'restaurant-logos',
  'restaurant-logos',
  true,
  1048576,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "restaurant-logos: owners read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'restaurant-logos'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner}')
  );

create policy "restaurant-logos: owners upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'restaurant-logos'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner}')
  );

create policy "restaurant-logos: owners replace in own folder"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'restaurant-logos'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner}')
  )
  with check (
    bucket_id = 'restaurant-logos'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner}')
  );

create policy "restaurant-logos: owners delete in own folder"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'restaurant-logos'
    and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner}')
  );
