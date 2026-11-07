-- The only way to create a restaurant: restaurant + first branch + owner
-- membership + audit entry, in one transaction.

create or replace function public.create_restaurant_with_owner(
  p_name text,
  p_slug text,
  p_city text,
  p_phone text,
  p_branch_name text,
  p_branch_address text,
  p_branch_area text,
  p_opening_hours jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_slug text := lower(btrim(p_slug));
  v_restaurant_id uuid;
  v_branch_id uuid;
begin
  if v_uid is null then
    raise exception 'You need to be signed in.' using errcode = '42501';
  end if;

  if (select count(*) from public.memberships m
      where m.user_id = v_uid and m.role = 'owner') >= 5 then
    raise exception 'You can own at most 5 restaurants.' using errcode = 'P0001';
  end if;

  if private.is_reserved_slug(v_slug) then
    raise exception 'This link is reserved. Please choose another.' using errcode = 'P0001';
  end if;

  insert into public.restaurants (name, slug, city, phone, created_by, trial_ends_at)
  values (
    btrim(p_name),
    v_slug,
    nullif(btrim(p_city), ''),
    nullif(btrim(p_phone), ''),
    v_uid,
    now() + interval '14 days'
  )
  returning id into v_restaurant_id;

  insert into public.branches (restaurant_id, name, address, area, city, phone, opening_hours, is_open)
  values (
    v_restaurant_id,
    btrim(p_branch_name),
    nullif(btrim(p_branch_address), ''),
    nullif(btrim(p_branch_area), ''),
    nullif(btrim(p_city), ''),
    nullif(btrim(p_phone), ''),
    p_opening_hours,
    false
  )
  returning id into v_branch_id;

  insert into public.memberships (user_id, restaurant_id, branch_id, role)
  values (v_uid, v_restaurant_id, null, 'owner');

  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, new_data)
  values (
    v_restaurant_id, v_uid, 'restaurant.created', 'restaurant', v_restaurant_id::text,
    jsonb_build_object('name', btrim(p_name), 'slug', v_slug, 'first_branch_id', v_branch_id)
  );

  return v_restaurant_id;
end;
$$;

-- Slug check for the onboarding form. Users can't read other restaurants,
-- so this runs as definer and returns only a yes/no.
create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(p_slug)) ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
    and not private.is_reserved_slug(lower(btrim(p_slug)))
    and not exists (select 1 from public.restaurants r where r.slug = lower(btrim(p_slug)));
$$;

revoke execute on function public.create_restaurant_with_owner(text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.create_restaurant_with_owner(text, text, text, text, text, text, text, jsonb) to authenticated;

revoke execute on function public.is_slug_available(text) from public, anon;
grant execute on function public.is_slug_available(text) to authenticated;
