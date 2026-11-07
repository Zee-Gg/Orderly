-- Menu RPCs.
-- SECURITY INVOKER functions run as the caller, so RLS still decides every
-- write; they exist to make multi-table saves a single transaction.
-- SECURITY DEFINER functions (set_item_stock, get_public_menu) check access
-- themselves and expose only the minimum.

-- ---------------------------------------------------------------------------
-- Stock toggle: owner/manager/staff/kitchen, only for branches they can
-- access, and ONLY the is_available column. Writes its own audit entry.
-- ---------------------------------------------------------------------------
create or replace function public.set_item_stock(
  p_branch_id uuid,
  p_item_id uuid,
  p_is_available boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_restaurant_id uuid;
  v_old boolean;
begin
  select b.restaurant_id into v_restaurant_id
  from public.branches b
  where b.id = p_branch_id and b.is_active;
  if v_restaurant_id is null then
    raise exception 'Branch not found.' using errcode = 'P0002';
  end if;

  if v_uid is null
     or not private.has_role(v_restaurant_id, '{owner,manager,staff,kitchen}')
     or not private.can_access_branch(p_branch_id) then
    raise exception 'You can''t change stock for this branch.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.menu_items i
    where i.id = p_item_id and i.restaurant_id = v_restaurant_id and i.archived_at is null
  ) then
    raise exception 'Item not found.' using errcode = 'P0002';
  end if;

  select s.is_available into v_old
  from public.branch_item_settings s
  where s.branch_id = p_branch_id and s.item_id = p_item_id;

  insert into public.branch_item_settings (branch_id, item_id, restaurant_id, is_available)
  values (p_branch_id, p_item_id, v_restaurant_id, p_is_available)
  on conflict (branch_id, item_id) do update set is_available = excluded.is_available;

  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    v_restaurant_id, v_uid, 'menu_item.stock_changed', 'menu_item', p_item_id::text,
    jsonb_build_object('is_available', coalesce(v_old, true), 'branch_id', p_branch_id),
    jsonb_build_object('is_available', p_is_available, 'branch_id', p_branch_id)
  );
  return p_is_available;
end;
$$;

-- ---------------------------------------------------------------------------
-- Save an item with its sizes, extras groups and branch settings in one go.
-- p_item:
-- { id?, category_id, name, name_ur, description, description_ur, image_url,
--   base_price, is_active, tags[], prep_time_minutes, aliases[], removable_options[],
--   sizes: [{ id?, key, name, name_ur, price, is_default }],         -- in display order
--   group_ids: [uuid],                                               -- in display order
--   branches: [{ branch_id, is_hidden, is_available, price_override,
--                size_prices: [{ size_key, price }] }] }
-- Removed sizes are archived, never deleted (orders may reference them).
-- ---------------------------------------------------------------------------
create or replace function public.save_menu_item(p_restaurant_id uuid, p_item jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_id uuid := nullif(p_item ->> 'id', '')::uuid;
  v_size jsonb;
  v_branch jsonb;
  v_size_id uuid;
  v_keys jsonb := '{}'::jsonb;
  v_keep uuid[];
  v_i integer := 0;
begin
  if v_item_id is null then
    insert into public.menu_items (
      restaurant_id, category_id, name, name_ur, description, description_ur, image_url,
      base_price, is_active, tags, prep_time_minutes, aliases, removable_options, sort_order
    )
    values (
      p_restaurant_id,
      (p_item ->> 'category_id')::uuid,
      p_item ->> 'name',
      nullif(p_item ->> 'name_ur', ''),
      nullif(p_item ->> 'description', ''),
      nullif(p_item ->> 'description_ur', ''),
      nullif(p_item ->> 'image_url', ''),
      (p_item ->> 'base_price')::integer,
      coalesce((p_item ->> 'is_active')::boolean, true),
      array(select jsonb_array_elements_text(coalesce(p_item -> 'tags', '[]'))),
      (p_item ->> 'prep_time_minutes')::integer,
      array(select jsonb_array_elements_text(coalesce(p_item -> 'aliases', '[]'))),
      array(select jsonb_array_elements_text(coalesce(p_item -> 'removable_options', '[]'))),
      coalesce((select max(sort_order) + 1 from public.menu_items
                where category_id = (p_item ->> 'category_id')::uuid), 0)
    )
    returning id into v_item_id;
  else
    update public.menu_items set
      category_id = (p_item ->> 'category_id')::uuid,
      name = p_item ->> 'name',
      name_ur = nullif(p_item ->> 'name_ur', ''),
      description = nullif(p_item ->> 'description', ''),
      description_ur = nullif(p_item ->> 'description_ur', ''),
      image_url = nullif(p_item ->> 'image_url', ''),
      base_price = (p_item ->> 'base_price')::integer,
      is_active = coalesce((p_item ->> 'is_active')::boolean, true),
      tags = array(select jsonb_array_elements_text(coalesce(p_item -> 'tags', '[]'))),
      prep_time_minutes = (p_item ->> 'prep_time_minutes')::integer,
      aliases = array(select jsonb_array_elements_text(coalesce(p_item -> 'aliases', '[]'))),
      removable_options = array(select jsonb_array_elements_text(coalesce(p_item -> 'removable_options', '[]')))
    where id = v_item_id and restaurant_id = p_restaurant_id and archived_at is null;
    if not found then
      raise exception 'Item not found.' using errcode = 'P0002';
    end if;
  end if;

  -- Sizes -------------------------------------------------------------------
  v_keep := array(
    select (s ->> 'id')::uuid from jsonb_array_elements(coalesce(p_item -> 'sizes', '[]')) s
    where nullif(s ->> 'id', '') is not null
  );
  -- Clear defaults first so the "one default" unique index never trips mid-save.
  update public.item_variants set is_default = false
  where item_id = v_item_id and is_default;
  update public.item_variants set archived_at = now(), is_active = false
  where item_id = v_item_id and archived_at is null and not (id = any (v_keep));

  for v_size in select * from jsonb_array_elements(coalesce(p_item -> 'sizes', '[]')) loop
    if nullif(v_size ->> 'id', '') is not null then
      update public.item_variants set
        name = v_size ->> 'name',
        name_ur = nullif(v_size ->> 'name_ur', ''),
        price = (v_size ->> 'price')::integer,
        is_default = coalesce((v_size ->> 'is_default')::boolean, false),
        sort_order = v_i,
        is_active = true
      where id = (v_size ->> 'id')::uuid and item_id = v_item_id and archived_at is null
      returning id into v_size_id;
      if v_size_id is null then
        raise exception 'Size not found.' using errcode = 'P0002';
      end if;
    else
      insert into public.item_variants (restaurant_id, item_id, name, name_ur, price, is_default, sort_order)
      values (
        p_restaurant_id, v_item_id, v_size ->> 'name', nullif(v_size ->> 'name_ur', ''),
        (v_size ->> 'price')::integer, coalesce((v_size ->> 'is_default')::boolean, false), v_i
      )
      returning id into v_size_id;
    end if;
    v_keys := v_keys || jsonb_build_object(v_size ->> 'key', v_size_id);
    v_size_id := null;
    v_i := v_i + 1;
  end loop;

  -- Extras groups -------------------------------------------------------------
  delete from public.item_modifier_groups where item_id = v_item_id;
  insert into public.item_modifier_groups (item_id, group_id, restaurant_id, sort_order)
  select v_item_id, g.value::uuid, p_restaurant_id, (g.ordinality - 1)::integer
  from jsonb_array_elements_text(coalesce(p_item -> 'group_ids', '[]')) with ordinality g;

  -- Branch settings and prices -----------------------------------------------
  for v_branch in select * from jsonb_array_elements(coalesce(p_item -> 'branches', '[]')) loop
    insert into public.branch_item_settings
      (branch_id, item_id, restaurant_id, is_hidden, is_available, price_override)
    values (
      (v_branch ->> 'branch_id')::uuid, v_item_id, p_restaurant_id,
      coalesce((v_branch ->> 'is_hidden')::boolean, false),
      coalesce((v_branch ->> 'is_available')::boolean, true),
      (v_branch ->> 'price_override')::integer
    )
    on conflict (branch_id, item_id) do update set
      is_hidden = excluded.is_hidden,
      is_available = excluded.is_available,
      price_override = excluded.price_override;

    delete from public.branch_variant_prices bvp
    using public.item_variants v
    where bvp.variant_id = v.id
      and v.item_id = v_item_id
      and bvp.branch_id = (v_branch ->> 'branch_id')::uuid;

    insert into public.branch_variant_prices (branch_id, variant_id, restaurant_id, price)
    select (v_branch ->> 'branch_id')::uuid, (v_keys ->> (sp ->> 'size_key'))::uuid,
      p_restaurant_id, (sp ->> 'price')::integer
    from jsonb_array_elements(coalesce(v_branch -> 'size_prices', '[]')) sp
    where v_keys ? (sp ->> 'size_key');
  end loop;

  return v_item_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Save a reusable Extras/Choices group and its options in one go.
-- p_group: { id?, name, name_ur, min_select, max_select,
--            options: [{ id?, name, name_ur, price_delta, is_default, is_available }] }
-- Removed options are archived.
-- ---------------------------------------------------------------------------
create or replace function public.save_modifier_group(p_restaurant_id uuid, p_group jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_group_id uuid := nullif(p_group ->> 'id', '')::uuid;
  v_option jsonb;
  v_keep uuid[];
  v_i integer := 0;
begin
  if v_group_id is null then
    insert into public.modifier_groups (restaurant_id, name, name_ur, min_select, max_select, sort_order)
    values (
      p_restaurant_id, p_group ->> 'name', nullif(p_group ->> 'name_ur', ''),
      (p_group ->> 'min_select')::integer, (p_group ->> 'max_select')::integer,
      coalesce((select max(sort_order) + 1 from public.modifier_groups where restaurant_id = p_restaurant_id), 0)
    )
    returning id into v_group_id;
  else
    update public.modifier_groups set
      name = p_group ->> 'name',
      name_ur = nullif(p_group ->> 'name_ur', ''),
      min_select = (p_group ->> 'min_select')::integer,
      max_select = (p_group ->> 'max_select')::integer
    where id = v_group_id and restaurant_id = p_restaurant_id and archived_at is null;
    if not found then
      raise exception 'Extras group not found.' using errcode = 'P0002';
    end if;
  end if;

  v_keep := array(
    select (o ->> 'id')::uuid from jsonb_array_elements(coalesce(p_group -> 'options', '[]')) o
    where nullif(o ->> 'id', '') is not null
  );
  update public.modifier_options set archived_at = now(), is_default = false
  where group_id = v_group_id and archived_at is null and not (id = any (v_keep));

  for v_option in select * from jsonb_array_elements(coalesce(p_group -> 'options', '[]')) loop
    if nullif(v_option ->> 'id', '') is not null then
      update public.modifier_options set
        name = v_option ->> 'name',
        name_ur = nullif(v_option ->> 'name_ur', ''),
        price_delta = (v_option ->> 'price_delta')::integer,
        is_default = coalesce((v_option ->> 'is_default')::boolean, false),
        is_available = coalesce((v_option ->> 'is_available')::boolean, true),
        sort_order = v_i
      where id = (v_option ->> 'id')::uuid and group_id = v_group_id and archived_at is null;
      if not found then
        raise exception 'Option not found.' using errcode = 'P0002';
      end if;
    else
      insert into public.modifier_options
        (restaurant_id, group_id, name, name_ur, price_delta, is_default, is_available, sort_order)
      values (
        p_restaurant_id, v_group_id, v_option ->> 'name', nullif(v_option ->> 'name_ur', ''),
        (v_option ->> 'price_delta')::integer,
        coalesce((v_option ->> 'is_default')::boolean, false),
        coalesce((v_option ->> 'is_available')::boolean, true),
        v_i
      );
    end if;
    v_i := v_i + 1;
  end loop;

  return v_group_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reordering (drag and drop)
-- ---------------------------------------------------------------------------
create or replace function public.reorder_menu_categories(p_restaurant_id uuid, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.menu_categories c set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where c.id = o.id and c.restaurant_id = p_restaurant_id;
$$;

create or replace function public.reorder_menu_items(p_category_id uuid, p_ids uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.menu_items i set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where i.id = o.id and i.category_id = p_category_id;
$$;

-- ---------------------------------------------------------------------------
-- Bulk price update: apply pre-computed new prices + ONE audit entry,
-- atomically. Runs as the caller (RLS: owner/manager only).
-- p_changes: [{ kind: 'item'|'size'|'item_branch'|'size_branch', id, branch_id?, price }]
-- ---------------------------------------------------------------------------
create or replace function public.apply_price_changes(
  p_restaurant_id uuid,
  p_changes jsonb,
  p_audit jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_change jsonb;
  v_count integer := 0;
begin
  for v_change in select * from jsonb_array_elements(p_changes) loop
    case v_change ->> 'kind'
      when 'item' then
        update public.menu_items set base_price = (v_change ->> 'price')::integer
        where id = (v_change ->> 'id')::uuid and restaurant_id = p_restaurant_id;
      when 'size' then
        update public.item_variants set price = (v_change ->> 'price')::integer
        where id = (v_change ->> 'id')::uuid and restaurant_id = p_restaurant_id;
      when 'item_branch' then
        update public.branch_item_settings set price_override = (v_change ->> 'price')::integer
        where item_id = (v_change ->> 'id')::uuid and branch_id = (v_change ->> 'branch_id')::uuid
          and restaurant_id = p_restaurant_id;
      when 'size_branch' then
        update public.branch_variant_prices set price = (v_change ->> 'price')::integer
        where variant_id = (v_change ->> 'id')::uuid and branch_id = (v_change ->> 'branch_id')::uuid
          and restaurant_id = p_restaurant_id;
      else
        raise exception 'Unknown price change.' using errcode = '22023';
    end case;
    if not found then
      raise exception 'A price could not be changed. Nothing was saved.' using errcode = '42501';
    end if;
    v_count := v_count + 1;
  end loop;

  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (
    p_restaurant_id, (select auth.uid()), 'menu.bulk_price_update', 'menu', p_restaurant_id::text,
    p_audit -> 'old', p_audit -> 'new'
  );
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public customer menu (Phase 8). The ONLY anonymous read path to menu data.
-- Returns null unless the restaurant is trial/active and the branch is active.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_menu(p_restaurant_slug text, p_branch_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select id, name, slug, logo_url, phone, whatsapp_number, city
    from public.restaurants
    where slug = lower(btrim(p_restaurant_slug)) and status in ('trial', 'active')
  ),
  b as (
    select br.id, br.name, br.area, br.address, br.is_open, br.opening_hours
    from public.branches br
    join r on r.id = br.restaurant_id
    where br.id = p_branch_id and br.is_active
  ),
  items as (
    select i.*, coalesce(s.is_available, true) as in_stock, s.price_override
    from public.menu_items i
    join r on r.id = i.restaurant_id
    join public.menu_categories c
      on c.id = i.category_id and c.archived_at is null and c.is_active
    left join public.branch_item_settings s
      on s.item_id = i.id and s.branch_id = p_branch_id
    where i.archived_at is null
      and i.is_active
      and not coalesce(s.is_hidden, false)
      and exists (select 1 from b)
  )
  select case when not exists (select 1 from b) then null else jsonb_build_object(
    'restaurant', (select to_jsonb(r) from r),
    'branch', (select to_jsonb(b) from b),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'name_ur', c.name_ur,
        'description', c.description,
        'items', (
          select jsonb_agg(jsonb_build_object(
            'id', it.id,
            'name', it.name,
            'name_ur', it.name_ur,
            'description', it.description,
            'description_ur', it.description_ur,
            'image_url', it.image_url,
            'tags', to_jsonb(it.tags),
            'removable_options', to_jsonb(it.removable_options),
            'prep_time_minutes', it.prep_time_minutes,
            'is_available', it.in_stock,
            'price', coalesce(it.price_override, it.base_price),
            'sizes', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', v.id, 'name', v.name, 'name_ur', v.name_ur, 'is_default', v.is_default,
                'price', coalesce(bvp.price, v.price)
              ) order by v.sort_order)
              from public.item_variants v
              left join public.branch_variant_prices bvp
                on bvp.variant_id = v.id and bvp.branch_id = p_branch_id
              where v.item_id = it.id and v.is_active and v.archived_at is null
            ), '[]'::jsonb),
            'groups', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', g.id, 'name', g.name, 'name_ur', g.name_ur,
                'min_select', g.min_select, 'max_select', g.max_select,
                'options', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', o.id, 'name', o.name, 'name_ur', o.name_ur,
                    'price_delta', o.price_delta, 'is_default', o.is_default,
                    'is_available', o.is_available
                  ) order by o.sort_order)
                  from public.modifier_options o
                  where o.group_id = g.id and o.archived_at is null
                ), '[]'::jsonb)
              ) order by img.sort_order)
              from public.item_modifier_groups img
              join public.modifier_groups g on g.id = img.group_id and g.archived_at is null
              where img.item_id = it.id
            ), '[]'::jsonb)
          ) order by it.sort_order, it.name)
          from items it
          where it.category_id = c.id
        )
      ) order by c.sort_order, c.name)
      from public.menu_categories c
      join r on r.id = c.restaurant_id
      where c.archived_at is null and c.is_active
        and exists (select 1 from items it where it.category_id = c.id)
    ), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants
-- ---------------------------------------------------------------------------
revoke execute on function public.set_item_stock(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_item_stock(uuid, uuid, boolean) to authenticated;

revoke execute on function public.save_menu_item(uuid, jsonb) from public, anon;
grant execute on function public.save_menu_item(uuid, jsonb) to authenticated;

revoke execute on function public.save_modifier_group(uuid, jsonb) from public, anon;
grant execute on function public.save_modifier_group(uuid, jsonb) to authenticated;

revoke execute on function public.reorder_menu_categories(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_menu_categories(uuid, uuid[]) to authenticated;

revoke execute on function public.reorder_menu_items(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_menu_items(uuid, uuid[]) to authenticated;

revoke execute on function public.apply_price_changes(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_price_changes(uuid, jsonb, jsonb) to authenticated;

revoke execute on function public.get_public_menu(text, uuid) from public;
grant execute on function public.get_public_menu(text, uuid) to anon, authenticated;
