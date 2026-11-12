-- Phase 9: riders see only their deliveries. The bot settings tables from 7C
-- (menu images, offers, FAQs) were readable by every member; exclude riders.
do $$
declare t text;
begin
  foreach t in array array['menu_media', 'offers', 'restaurant_faqs'] loop
    execute format('drop policy if exists "%1$s: members read" on public.%1$I', t);
    execute format('create policy "%1$s: staff read (not riders)" on public.%1$I for select to authenticated
      using (private.has_role(restaurant_id, ''{owner,manager,staff,kitchen}'') or (select private.is_super_admin()))', t);
  end loop;
end $$;
