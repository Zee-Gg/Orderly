-- Order write RPCs. SERVICE ROLE ONLY: execute is revoked from anon and
-- authenticated, so nobody can call them from a browser with fake prices.
-- The Next.js server calls them with the admin client AFTER checking the
-- user's permission and branch access and re-pricing via the pricing engine.
--
-- Errors use SQLSTATE P0001 with a stable token as the message:
--   VERSION_CONFLICT, INVALID_TRANSITION, NOT_EDITABLE, ON_HOLD,
--   CUSTOMER_BLOCKED, ROLE_NOT_ALLOWED, REASON_REQUIRED, ORDER_NOT_FOUND,
--   BRANCH_NOT_FOUND

-- ---------------------------------------------------------------------------
-- State machine (mirrors src/lib/orders/status.ts)
-- ---------------------------------------------------------------------------
create or replace function private.order_transition_allowed(
  p_from public.order_status,
  p_to public.order_status,
  p_type public.order_type
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'pending_confirmation' then p_to in ('awaiting_acceptance', 'cancelled')
    when 'awaiting_acceptance' then p_to in ('accepted', 'cancelled')
    when 'accepted' then p_to in ('preparing', 'cancelled')
    when 'preparing' then p_to in ('ready', 'cancelled')
    when 'ready' then
      (p_to = 'out_for_delivery' and p_type = 'delivery')
      or (p_to = 'completed' and p_type in ('pickup', 'dine_in'))
      or p_to = 'cancelled'
    when 'out_for_delivery' then p_to in ('delivered', 'failed')
    when 'delivered' then p_to = 'completed'
    else false
  end;
$$;

-- Active role of a user in a restaurant (null if none).
create or replace function private.member_role_of(p_user_id uuid, p_restaurant_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.memberships m
  where m.user_id = p_user_id and m.restaurant_id = p_restaurant_id and m.is_active;
$$;

-- ---------------------------------------------------------------------------
-- create_order(p jsonb) → { id, order_number, duplicate }
-- p: { restaurant_id, branch_id, idempotency_key?, status, order_type, source,
--      payment_method, actor_type, actor_user_id?, override_block?,
--      customer?: { phone, name }, customer_name?, address?: { address_text, area,
--      landmark, latitude, longitude, label, save }, table_number?, notes?,
--      subtotal, delivery_fee, discount, tax, service_charge, total,
--      items: [{ item_id, variant_id, item_name, size_name, quantity, unit_price,
--                line_total, removals[], notes, snapshot,
--                modifiers: [{ option_id, group_name, option_name, price_delta }] }] }
-- ---------------------------------------------------------------------------
create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_restaurant uuid := (p ->> 'restaurant_id')::uuid;
  v_branch uuid := (p ->> 'branch_id')::uuid;
  v_key text := nullif(p ->> 'idempotency_key', '');
  v_status public.order_status := (p ->> 'status')::public.order_status;
  v_actor uuid := nullif(p ->> 'actor_user_id', '')::uuid;
  v_phone text := nullif(p -> 'customer' ->> 'phone', '');
  v_existing record;
  v_customer_id uuid;
  v_blocked boolean := false;
  v_prep integer;
  v_number integer;
  v_order_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_addr jsonb := p -> 'address';
begin
  select b.default_prep_minutes into v_prep
  from public.branches b
  where b.id = v_branch and b.restaurant_id = v_restaurant and b.is_active;
  if v_prep is null then
    raise exception 'BRANCH_NOT_FOUND';
  end if;

  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  -- Idempotency: same key → same order, even for simultaneous requests.
  if v_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_restaurant::text || ':' || v_key, 0));
    select o.id, o.order_number into v_existing
    from public.orders o
    where o.restaurant_id = v_restaurant and o.idempotency_key = v_key;
    if found then
      return jsonb_build_object('id', v_existing.id, 'order_number', v_existing.order_number, 'duplicate', true);
    end if;
  end if;

  -- Find or create the customer by phone.
  if v_phone is not null then
    insert into public.customers (restaurant_id, phone, name)
    values (v_restaurant, v_phone, nullif(btrim(p -> 'customer' ->> 'name'), ''))
    on conflict (restaurant_id, phone) do update
      set name = coalesce(excluded.name, public.customers.name)
    returning id, is_blocked into v_customer_id, v_blocked;

    if v_blocked and not coalesce((p ->> 'override_block')::boolean, false) then
      raise exception 'CUSTOMER_BLOCKED';
    end if;

    if v_addr is not null
       and nullif(btrim(v_addr ->> 'address_text'), '') is not null
       and coalesce((v_addr ->> 'save')::boolean, false)
       and not exists (
         select 1 from public.customer_addresses a
         where a.customer_id = v_customer_id
           and lower(btrim(a.address_text)) = lower(btrim(v_addr ->> 'address_text'))
       ) then
      insert into public.customer_addresses
        (restaurant_id, customer_id, label, address_text, area, landmark, latitude, longitude, is_default)
      values (
        v_restaurant, v_customer_id, nullif(v_addr ->> 'label', ''), btrim(v_addr ->> 'address_text'),
        nullif(v_addr ->> 'area', ''), nullif(v_addr ->> 'landmark', ''),
        (v_addr ->> 'latitude')::double precision, (v_addr ->> 'longitude')::double precision,
        not exists (select 1 from public.customer_addresses a where a.customer_id = v_customer_id)
      );
    end if;
  end if;

  -- Atomic per-restaurant number: #1001, #1002, ...
  insert into public.order_counters (restaurant_id, last_number)
  values (v_restaurant, 1001)
  on conflict (restaurant_id) do update set last_number = public.order_counters.last_number + 1
  returning last_number into v_number;

  insert into public.orders (
    restaurant_id, branch_id, order_number, customer_id, customer_name, customer_phone,
    order_type, source, status, payment_method,
    subtotal, delivery_fee, discount, tax, service_charge, total,
    address_text, area, landmark, latitude, longitude, table_number, notes,
    accepted_at, expected_ready_at, idempotency_key, created_by
  )
  values (
    v_restaurant, v_branch, v_number, v_customer_id,
    nullif(btrim(coalesce(p -> 'customer' ->> 'name', p ->> 'customer_name')), ''),
    v_phone,
    (p ->> 'order_type')::public.order_type,
    (p ->> 'source')::public.order_source,
    v_status,
    coalesce((p ->> 'payment_method')::public.payment_method, 'cod'),
    (p ->> 'subtotal')::integer,
    coalesce((p ->> 'delivery_fee')::integer, 0),
    coalesce((p ->> 'discount')::integer, 0),
    coalesce((p ->> 'tax')::integer, 0),
    coalesce((p ->> 'service_charge')::integer, 0),
    (p ->> 'total')::integer,
    nullif(btrim(v_addr ->> 'address_text'), ''), nullif(v_addr ->> 'area', ''),
    nullif(v_addr ->> 'landmark', ''),
    (v_addr ->> 'latitude')::double precision, (v_addr ->> 'longitude')::double precision,
    nullif(p ->> 'table_number', ''), nullif(p ->> 'notes', ''),
    case when v_status in ('accepted', 'preparing') then now() end,
    case when v_status in ('accepted', 'preparing') then now() + make_interval(mins => v_prep) end,
    v_key, v_actor
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.order_items (
      restaurant_id, order_id, item_id, variant_id, item_name, size_name, quantity,
      unit_price, line_total, removals, notes, snapshot
    )
    values (
      v_restaurant, v_order_id, (v_item ->> 'item_id')::uuid, nullif(v_item ->> 'variant_id', '')::uuid,
      v_item ->> 'item_name', nullif(v_item ->> 'size_name', ''), (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::integer, (v_item ->> 'line_total')::integer,
      array(select jsonb_array_elements_text(coalesce(v_item -> 'removals', '[]'))),
      nullif(v_item ->> 'notes', ''), v_item -> 'snapshot'
    )
    returning id into v_item_id;

    insert into public.order_item_modifiers
      (restaurant_id, order_item_id, option_id, group_name, option_name, price_delta)
    select v_restaurant, v_item_id, nullif(m ->> 'option_id', '')::uuid, m ->> 'group_name',
      m ->> 'option_name', (m ->> 'price_delta')::integer
    from jsonb_array_elements(coalesce(v_item -> 'modifiers', '[]')) m;
  end loop;

  insert into public.order_events (restaurant_id, order_id, event_type, to_status, actor_type, actor_user_id, data)
  values (
    v_restaurant, v_order_id, 'created', v_status, (p ->> 'actor_type')::public.actor_type, v_actor,
    jsonb_build_object('source', p ->> 'source', 'order_type', p ->> 'order_type', 'total', (p ->> 'total')::integer)
  );

  return jsonb_build_object('id', v_order_id, 'order_number', v_number, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order_status: move along p_path (e.g. {accepted,preparing} for
-- "Accept & start") with a row lock and optimistic version check.
-- ---------------------------------------------------------------------------
create or replace function public.transition_order_status(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_path public.order_status[],
  p_actor_type public.actor_type,
  p_actor_user_id uuid default null,
  p_reason text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_from public.order_status;
  v_to public.order_status;
  v_role public.member_role;
  v_prep integer;
begin
  select * into o from public.orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;
  if array_length(p_path, 1) is null then
    raise exception 'INVALID_TRANSITION';
  end if;

  v_role := case when p_actor_user_id is null then null
                 else private.member_role_of(p_actor_user_id, p_restaurant_id) end;
  select b.default_prep_minutes into v_prep from public.branches b where b.id = o.branch_id;

  v_from := o.status;
  foreach v_to in array p_path loop
    if not private.order_transition_allowed(v_from, v_to, o.order_type) then
      raise exception 'INVALID_TRANSITION';
    end if;
    if o.is_on_hold and v_to <> 'cancelled' then
      raise exception 'ON_HOLD';
    end if;
    if p_actor_type = 'staff' then
      if v_role is null then
        raise exception 'ROLE_NOT_ALLOWED';
      end if;
      -- Late cancellations are manager+ only.
      if v_to = 'cancelled' and v_from in ('preparing', 'ready') and v_role not in ('owner', 'manager') then
        raise exception 'ROLE_NOT_ALLOWED';
      end if;
      -- Kitchen can only start and finish cooking.
      if v_role = 'kitchen' and not (
        (v_from = 'accepted' and v_to = 'preparing') or (v_from = 'preparing' and v_to = 'ready')
      ) then
        raise exception 'ROLE_NOT_ALLOWED';
      end if;
      if v_role = 'rider' then
        raise exception 'ROLE_NOT_ALLOWED';
      end if;
    end if;
    if v_to in ('cancelled', 'failed') and nullif(btrim(p_reason), '') is null then
      raise exception 'REASON_REQUIRED';
    end if;

    update public.orders set
      status = v_to,
      accepted_at = case when v_to in ('accepted', 'preparing') then coalesce(accepted_at, now()) else accepted_at end,
      expected_ready_at = case when v_to in ('accepted', 'preparing')
        then coalesce(expected_ready_at, now() + make_interval(mins => coalesce(v_prep, 20)))
        else expected_ready_at end,
      preparing_at = case when v_to = 'preparing' then now() else preparing_at end,
      ready_at = case when v_to = 'ready' then now() else ready_at end,
      dispatched_at = case when v_to = 'out_for_delivery' then now() else dispatched_at end,
      delivered_at = case when v_to = 'delivered' then now() else delivered_at end,
      completed_at = case when v_to = 'completed' then now() else completed_at end,
      cancelled_at = case when v_to = 'cancelled' then now() else cancelled_at end,
      failed_at = case when v_to = 'failed' then now() else failed_at end,
      cancel_reason = case when v_to in ('cancelled', 'failed') then p_reason else cancel_reason end,
      cancel_note = case when v_to in ('cancelled', 'failed') then nullif(btrim(p_note), '') else cancel_note end,
      cancelled_by = case when v_to = 'cancelled' then p_actor_user_id else cancelled_by end,
      is_on_hold = case when v_to = 'cancelled' then false else is_on_hold end
    where id = o.id;

    insert into public.order_events
      (restaurant_id, order_id, event_type, from_status, to_status, actor_type, actor_user_id, data)
    values (
      o.restaurant_id, o.id, case when v_to = 'cancelled' then 'cancelled' else 'status_changed' end,
      v_from, v_to, p_actor_type, p_actor_user_id,
      case when v_to in ('cancelled', 'failed')
        then jsonb_build_object('reason', p_reason, 'note', nullif(btrim(p_note), ''))
        else '{}'::jsonb end
    );

    -- Customer history
    if o.customer_id is not null then
      if v_to = 'completed' then
        update public.customers set
          total_orders = total_orders + 1,
          total_spent = total_spent + o.total,
          last_order_at = now()
        where id = o.customer_id;
      elsif v_to = 'cancelled' and p_reason = 'fake_order' then
        update public.customers set cancelled_count = cancelled_count + 1 where id = o.customer_id;
      elsif v_to = 'failed' and p_reason = 'customer_refused' then
        update public.customers set refused_count = refused_count + 1 where id = o.customer_id;
      end if;
    end if;

    if v_to = 'cancelled' then
      insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, old_data, new_data)
      values (
        o.restaurant_id, p_actor_user_id, 'order.cancelled', 'order', o.id::text,
        jsonb_build_object('status', v_from, 'order_number', o.order_number, 'total', o.total),
        jsonb_build_object('status', 'cancelled', 'reason', p_reason, 'note', nullif(btrim(p_note), ''))
      );
    end if;

    v_from := v_to;
  end loop;

  update public.orders set version = version + 1 where id = o.id
  returning version into o.version;

  return jsonb_build_object('id', o.id, 'status', v_from, 'version', o.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- edit_order(p jsonb): replace items (old ones kept, marked is_cancelled),
-- new totals, version check. Preparing orders: manager+ and flagged for the kitchen.
-- p: { restaurant_id, order_id, expected_version, actor_user_id, items[], subtotal,
--      delivery_fee, discount, tax, service_charge, total, order_type, payment_method,
--      notes, table_number, address?: {...} }
-- ---------------------------------------------------------------------------
create or replace function public.edit_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_actor uuid := (p ->> 'actor_user_id')::uuid;
  v_role public.member_role;
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_addr jsonb := p -> 'address';
begin
  select * into o from public.orders
  where id = (p ->> 'order_id')::uuid and restaurant_id = (p ->> 'restaurant_id')::uuid
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.version <> (p ->> 'expected_version')::integer then
    raise exception 'VERSION_CONFLICT';
  end if;
  if o.status not in ('awaiting_acceptance', 'accepted', 'preparing') then
    raise exception 'NOT_EDITABLE';
  end if;
  v_role := private.member_role_of(v_actor, o.restaurant_id);
  if v_role is null or v_role not in ('owner', 'manager', 'staff')
     or (o.status = 'preparing' and v_role not in ('owner', 'manager')) then
    raise exception 'ROLE_NOT_ALLOWED';
  end if;
  if jsonb_array_length(coalesce(p -> 'items', '[]')) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  select jsonb_build_object(
    'total', o.total, 'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'discount', o.discount,
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'name', i.item_name, 'size', i.size_name, 'quantity', i.quantity, 'line_total', i.line_total
    ) order by i.created_at), '[]'::jsonb)
  ) into v_before
  from public.order_items i
  where i.order_id = o.id and not i.is_cancelled;

  update public.order_items set is_cancelled = true where order_id = o.id and not is_cancelled;

  for v_item in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.order_items (
      restaurant_id, order_id, item_id, variant_id, item_name, size_name, quantity,
      unit_price, line_total, removals, notes, snapshot
    )
    values (
      o.restaurant_id, o.id, (v_item ->> 'item_id')::uuid, nullif(v_item ->> 'variant_id', '')::uuid,
      v_item ->> 'item_name', nullif(v_item ->> 'size_name', ''), (v_item ->> 'quantity')::integer,
      (v_item ->> 'unit_price')::integer, (v_item ->> 'line_total')::integer,
      array(select jsonb_array_elements_text(coalesce(v_item -> 'removals', '[]'))),
      nullif(v_item ->> 'notes', ''), v_item -> 'snapshot'
    )
    returning id into v_item_id;

    insert into public.order_item_modifiers
      (restaurant_id, order_item_id, option_id, group_name, option_name, price_delta)
    select o.restaurant_id, v_item_id, nullif(m ->> 'option_id', '')::uuid, m ->> 'group_name',
      m ->> 'option_name', (m ->> 'price_delta')::integer
    from jsonb_array_elements(coalesce(v_item -> 'modifiers', '[]')) m;
  end loop;

  update public.orders set
    subtotal = (p ->> 'subtotal')::integer,
    delivery_fee = coalesce((p ->> 'delivery_fee')::integer, 0),
    discount = coalesce((p ->> 'discount')::integer, 0),
    tax = coalesce((p ->> 'tax')::integer, 0),
    service_charge = coalesce((p ->> 'service_charge')::integer, 0),
    total = (p ->> 'total')::integer,
    order_type = coalesce((p ->> 'order_type')::public.order_type, order_type),
    payment_method = coalesce((p ->> 'payment_method')::public.payment_method, payment_method),
    notes = nullif(p ->> 'notes', ''),
    table_number = nullif(p ->> 'table_number', ''),
    address_text = case when v_addr is null then address_text else nullif(btrim(v_addr ->> 'address_text'), '') end,
    area = case when v_addr is null then area else nullif(v_addr ->> 'area', '') end,
    landmark = case when v_addr is null then landmark else nullif(v_addr ->> 'landmark', '') end,
    version = version + 1
  where id = o.id
  returning version into o.version;

  v_after := jsonb_build_object(
    'total', (p ->> 'total')::integer, 'subtotal', (p ->> 'subtotal')::integer,
    'delivery_fee', coalesce((p ->> 'delivery_fee')::integer, 0), 'discount', coalesce((p ->> 'discount')::integer, 0),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', x ->> 'item_name', 'size', x ->> 'size_name', 'quantity', (x ->> 'quantity')::integer,
      'line_total', (x ->> 'line_total')::integer)), '[]'::jsonb)
      from jsonb_array_elements(p -> 'items') x)
  );

  insert into public.order_events
    (restaurant_id, order_id, event_type, from_status, to_status, actor_type, actor_user_id, data)
  values (
    o.restaurant_id, o.id, 'edited', o.status, o.status, 'staff', v_actor,
    jsonb_build_object('before', v_before, 'after', v_after, 'kitchen_alert', o.status = 'preparing')
  );

  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, old_data, new_data)
  values (o.restaurant_id, v_actor, 'order.edited', 'order', o.id::text, v_before, v_after);

  return jsonb_build_object('id', o.id, 'version', o.version, 'kitchen_alert', o.status = 'preparing');
end;
$$;

-- ---------------------------------------------------------------------------
-- set_order_hold
-- ---------------------------------------------------------------------------
create or replace function public.set_order_hold(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_expected_version integer,
  p_hold boolean,
  p_reason text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.version <> p_expected_version then
    raise exception 'VERSION_CONFLICT';
  end if;
  if o.status in ('delivered', 'completed', 'cancelled', 'failed') then
    raise exception 'NOT_EDITABLE';
  end if;
  if p_hold and nullif(btrim(p_reason), '') is null then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.orders set
    is_on_hold = p_hold,
    hold_reason = case when p_hold then btrim(p_reason) else null end,
    version = version + 1
  where id = o.id
  returning version into o.version;

  insert into public.order_events
    (restaurant_id, order_id, event_type, from_status, to_status, actor_type, actor_user_id, data)
  values (
    o.restaurant_id, o.id, case when p_hold then 'held' else 'unheld' end, o.status, o.status,
    'staff', p_actor_user_id,
    case when p_hold then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end
  );
  return jsonb_build_object('id', o.id, 'version', o.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment: cash received / transfer verified. Never automatic.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_method public.payment_method,
  p_amount integer,
  p_reference text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders
  where id = p_order_id and restaurant_id = p_restaurant_id
  for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if o.status in ('cancelled', 'failed') then
    raise exception 'NOT_EDITABLE';
  end if;
  if o.payment_status = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;

  insert into public.payments (restaurant_id, order_id, method, amount, status, reference, verified_by, verified_at)
  values (o.restaurant_id, o.id, p_method, p_amount, 'paid', nullif(btrim(p_reference), ''), p_actor_user_id, now());

  update public.orders set payment_status = 'paid', payment_method = p_method, version = version + 1
  where id = o.id
  returning version into o.version;

  insert into public.order_events
    (restaurant_id, order_id, event_type, from_status, to_status, actor_type, actor_user_id, data)
  values (
    o.restaurant_id, o.id, 'payment_updated', o.status, o.status, 'staff', p_actor_user_id,
    jsonb_build_object('payment_status', 'paid', 'method', p_method, 'amount', p_amount,
      'reference', nullif(btrim(p_reference), ''))
  );
  return jsonb_build_object('id', o.id, 'version', o.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute: service role ONLY
-- ---------------------------------------------------------------------------
revoke execute on function public.create_order(jsonb) from public, anon, authenticated;
revoke execute on function public.transition_order_status(uuid, uuid, integer, public.order_status[], public.actor_type, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.edit_order(jsonb) from public, anon, authenticated;
revoke execute on function public.set_order_hold(uuid, uuid, integer, boolean, text, uuid) from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, uuid, public.payment_method, integer, text, uuid) from public, anon, authenticated;

grant execute on function public.create_order(jsonb) to service_role;
grant execute on function public.transition_order_status(uuid, uuid, integer, public.order_status[], public.actor_type, uuid, text, text) to service_role;
grant execute on function public.edit_order(jsonb) to service_role;
grant execute on function public.set_order_hold(uuid, uuid, integer, boolean, text, uuid) to service_role;
grant execute on function public.record_payment(uuid, uuid, public.payment_method, integer, text, uuid) to service_role;

-- private.member_role_of is also used by the RPCs above (service role).
revoke execute on function private.member_role_of(uuid, uuid) from public, anon;
grant execute on function private.member_role_of(uuid, uuid) to authenticated, service_role;
