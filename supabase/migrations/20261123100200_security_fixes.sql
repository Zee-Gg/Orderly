-- Phase 12 security review (Supabase advisors).
--
-- 1) multiple_permissive_policies: Postgres runs EVERY permissive policy for
--    each row. Merge the rider policy with the staff policy into ONE policy
--    per table. Who can read what does not change.
drop policy if exists "orders: front of house with branch access read" on public.orders;
drop policy if exists "orders: assigned rider reads own deliveries" on public.orders;
create policy "orders: staff with branch access, assigned rider, super admin read" on public.orders
  for select to authenticated
  using (
    (private.has_role(restaurant_id, '{owner,manager,staff}') and private.can_access_branch(branch_id))
    or (rider_id is not null and private.rider_can_see(rider_id, restaurant_id, status, delivered_at, failed_at))
    or (select private.is_super_admin())
  );

drop policy if exists "order_items: readable with the order (incl. kitchen)" on public.order_items;
drop policy if exists "order_items: assigned rider reads" on public.order_items;
create policy "order_items: readable with the order (kitchen, rider, super admin)" on public.order_items
  for select to authenticated
  using (
    private.can_read_order_kitchen(order_id)
    or private.rider_can_read_order(order_id)
    or (select private.is_super_admin())
  );

drop policy if exists "order_item_modifiers: readable with the order (incl. kitchen)" on public.order_item_modifiers;
drop policy if exists "order_item_modifiers: assigned rider reads" on public.order_item_modifiers;
create policy "order_item_modifiers: readable with the order (kitchen, rider, super admin)" on public.order_item_modifiers
  for select to authenticated
  using (
    private.can_read_order_item(order_item_id)
    or exists (select 1 from public.order_items i where i.id = order_item_id and private.rider_can_read_order(i.order_id))
    or (select private.is_super_admin())
  );

drop policy if exists "rider_profiles: front of house read" on public.rider_profiles;
drop policy if exists "rider_profiles: rider reads self" on public.rider_profiles;
create policy "rider_profiles: front of house, self, super admin read" on public.rider_profiles
  for select to authenticated
  using (
    private.has_role(restaurant_id, '{owner,manager,staff}')
    or user_id = (select auth.uid())
    or (select private.is_super_admin())
  );

-- 2) get_public_menu (Phase 3) is no longer used by the app: the menu page
--    uses get_public_menu_info + the pricing engine. Close it to the API.
revoke execute on function public.get_public_menu(text, uuid) from public, anon, authenticated;
grant execute on function public.get_public_menu(text, uuid) to service_role;
