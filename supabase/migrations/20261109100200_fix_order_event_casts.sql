-- Fix: CASE expressions produced text for the order_events.event_type enum
-- column, so status changes and holds failed. Same functions, explicit casts.

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
      o.restaurant_id, o.id, (case when v_to = 'cancelled' then 'cancelled' else 'status_changed' end)::public.order_event_type,
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
    o.restaurant_id, o.id, (case when p_hold then 'held' else 'unheld' end)::public.order_event_type, o.status, o.status,
    'staff', p_actor_user_id,
    case when p_hold then jsonb_build_object('reason', btrim(p_reason)) else '{}'::jsonb end
  );
  return jsonb_build_object('id', o.id, 'version', o.version);
end;
$$;
