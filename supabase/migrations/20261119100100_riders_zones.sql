-- Phase 9: riders, delivery zones, cash settlement. Riders log in with phone +
-- PIN (auth account created by the server). A rider reads ONLY the orders
-- assigned to them (active, or delivered/failed today) and changes them only
-- through server actions + the state machine (transition_order_status).

-- ---------------------------------------------------------------------------
-- Settings on existing tables
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column share_rider_phone_with_customer boolean not null default false;
grant update (share_rider_phone_with_customer) on public.restaurants to authenticated;

alter table public.branches
  add column max_delivery_radius_km numeric(5, 1) check (max_delivery_radius_km > 0 and max_delivery_radius_km <= 100),
  add column unlisted_area_policy text not null default 'default_fee' check (unlisted_area_policy in ('reject', 'default_fee'));
grant insert (max_delivery_radius_km, unlisted_area_policy) on public.branches to authenticated;
grant update (max_delivery_radius_km, unlisted_area_policy) on public.branches to authenticated;

-- ---------------------------------------------------------------------------
-- rider_profiles
-- ---------------------------------------------------------------------------
create table public.rider_profiles (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'), -- E.164; one rider login per phone
  is_online boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  unique (user_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);
create index rider_profiles_restaurant_idx on public.rider_profiles (restaurant_id, branch_id);
create index rider_profiles_branch_idx on public.rider_profiles (branch_id);
create trigger rider_profiles_set_updated_at before update on public.rider_profiles
  for each row execute function private.set_updated_at();

alter table public.rider_profiles enable row level security;
revoke all on public.rider_profiles from anon, authenticated;
grant all on public.rider_profiles to service_role;
grant select on public.rider_profiles to authenticated;
grant update (is_online) on public.rider_profiles to authenticated; -- riders: their own toggle only
create policy "rider_profiles: front of house read" on public.rider_profiles for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));
create policy "rider_profiles: rider reads self" on public.rider_profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "rider_profiles: rider sets own online" on public.rider_profiles for update to authenticated
  using (user_id = (select auth.uid()) and is_active)
  with check (user_id = (select auth.uid()) and is_active);

-- ---------------------------------------------------------------------------
-- delivery_zones (soft delete: is_active; orders reference them)
-- ---------------------------------------------------------------------------
create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  aliases text[] not null default '{}' check (cardinality(aliases) <= 30),
  delivery_fee integer not null default 0 check (delivery_fee >= 0 and delivery_fee <= 10000000),
  minimum_order integer not null default 0 check (minimum_order >= 0 and minimum_order <= 100000000),
  estimated_minutes integer check (estimated_minutes between 1 and 600),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);
create index delivery_zones_branch_idx on public.delivery_zones (branch_id, sort_order);
create index delivery_zones_restaurant_idx on public.delivery_zones (restaurant_id);
create trigger delivery_zones_set_updated_at before update on public.delivery_zones
  for each row execute function private.set_updated_at();

alter table public.delivery_zones enable row level security;
revoke all on public.delivery_zones from anon, authenticated;
grant all on public.delivery_zones to service_role;
grant select on public.delivery_zones to authenticated;
grant insert (restaurant_id, branch_id, name, aliases, delivery_fee, minimum_order, estimated_minutes, is_active, sort_order)
  on public.delivery_zones to authenticated;
grant update (name, aliases, delivery_fee, minimum_order, estimated_minutes, is_active, sort_order)
  on public.delivery_zones to authenticated;
create policy "delivery_zones: front of house read" on public.delivery_zones for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));
create policy "delivery_zones: owner/manager insert" on public.delivery_zones for insert to authenticated
  with check (private.has_role(restaurant_id, '{owner,manager}') and private.can_access_branch(branch_id));
create policy "delivery_zones: owner/manager update" on public.delivery_zones for update to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') and private.can_access_branch(branch_id))
  with check (private.has_role(restaurant_id, '{owner,manager}') and private.can_access_branch(branch_id));

-- ---------------------------------------------------------------------------
-- rider_settlements (cash handed in by a rider)
-- ---------------------------------------------------------------------------
create table public.rider_settlements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  rider_id uuid not null,
  amount integer not null check (amount >= 0),          -- what the manager received
  expected_amount integer not null check (expected_amount >= 0), -- cash the orders said
  order_ids uuid[] not null check (cardinality(order_ids) >= 1),
  settled_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 300),
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (rider_id, restaurant_id) references public.rider_profiles (id, restaurant_id) on delete cascade
);
create index rider_settlements_rider_idx on public.rider_settlements (rider_id, created_at desc);
create index rider_settlements_restaurant_idx on public.rider_settlements (restaurant_id, created_at desc);
create index rider_settlements_branch_idx on public.rider_settlements (branch_id);
create index rider_settlements_settled_by_idx on public.rider_settlements (settled_by);

alter table public.rider_settlements enable row level security;
revoke all on public.rider_settlements from anon, authenticated;
grant all on public.rider_settlements to service_role;
grant select on public.rider_settlements to authenticated;
create policy "rider_settlements: owner/manager read" on public.rider_settlements for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') or (select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- orders: rider, zone, cash
-- ---------------------------------------------------------------------------
alter table public.orders
  add column assigned_at timestamptz,
  add column delivery_zone_id uuid,
  add column cod_collected_amount integer check (cod_collected_amount >= 0),
  add column cod_collected_at timestamptz,
  add column delivery_failed_reason text check (char_length(delivery_failed_reason) <= 60),
  add column settlement_id uuid,
  add constraint orders_rider_fk foreign key (rider_id, restaurant_id)
    references public.rider_profiles (id, restaurant_id) on delete set null (rider_id),
  add constraint orders_delivery_zone_fk foreign key (delivery_zone_id, restaurant_id)
    references public.delivery_zones (id, restaurant_id) on delete set null (delivery_zone_id),
  add constraint orders_settlement_fk foreign key (settlement_id, restaurant_id)
    references public.rider_settlements (id, restaurant_id) on delete set null (settlement_id);
create index orders_rider_idx on public.orders (rider_id, status) where rider_id is not null;
create index orders_delivery_zone_idx on public.orders (delivery_zone_id) where delivery_zone_id is not null;
create index orders_settlement_idx on public.orders (settlement_id) where settlement_id is not null;

-- The chat remembers the matched zone (fee + minimum used in the summary).
alter table public.bot_sessions add column delivery_zone jsonb check (delivery_zone is null or jsonb_typeof(delivery_zone) = 'object');

-- ---------------------------------------------------------------------------
-- What a rider may read: their own active orders, or delivered/failed today
-- ---------------------------------------------------------------------------
create or replace function private.rider_can_see(
  p_rider_id uuid, p_restaurant_id uuid, p_status public.order_status, p_delivered_at timestamptz, p_failed_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.rider_profiles rp
      join public.restaurants r on r.id = rp.restaurant_id
     where rp.id = p_rider_id
       and rp.restaurant_id = p_restaurant_id
       and rp.user_id = (select auth.uid())
       and rp.is_active
       and (
         p_status in ('ready', 'out_for_delivery')
         or (p_status in ('delivered', 'completed', 'failed')
             and coalesce(p_delivered_at, p_failed_at) >= (date_trunc('day', now() at time zone coalesce(r.timezone, 'Asia/Karachi')) at time zone coalesce(r.timezone, 'Asia/Karachi')))
       )
  );
$$;

create or replace function private.rider_can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
     where o.id = p_order_id and o.rider_id is not null
       and private.rider_can_see(o.rider_id, o.restaurant_id, o.status, o.delivered_at, o.failed_at)
  );
$$;

create policy "orders: assigned rider reads own deliveries" on public.orders for select to authenticated
  using (rider_id is not null and private.rider_can_see(rider_id, restaurant_id, status, delivered_at, failed_at));
create policy "order_items: assigned rider reads" on public.order_items for select to authenticated
  using (private.rider_can_read_order(order_id));
create policy "order_item_modifiers: assigned rider reads" on public.order_item_modifiers for select to authenticated
  using (exists (select 1 from public.order_items i where i.id = order_item_id and private.rider_can_read_order(i.order_id)));

-- ---------------------------------------------------------------------------
-- Status changes: riders only ready → out_for_delivery → delivered | failed,
-- on orders assigned to them. Mirrors src/lib/orders/status.ts.
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
      -- Riders: only their own orders, only pick up → delivered / failed.
      if v_role = 'rider' then
        if not ((v_from = 'ready' and v_to = 'out_for_delivery')
                or (v_from = 'out_for_delivery' and v_to in ('delivered', 'failed'))) then
          raise exception 'ROLE_NOT_ALLOWED';
        end if;
        if o.rider_id is null or not exists (
          select 1 from public.rider_profiles rp
           where rp.id = o.rider_id and rp.user_id = p_actor_user_id and rp.is_active
        ) then
          raise exception 'ROLE_NOT_ALLOWED';
        end if;
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
      delivery_failed_reason = case when v_to = 'failed' then p_reason else delivery_failed_reason end,
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

-- ---------------------------------------------------------------------------
-- Assign / unassign a rider (delivery orders that aren't finished yet)
-- ---------------------------------------------------------------------------
create or replace function public.assign_order_rider(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_rider_id uuid,              -- null = unassign
  p_expected_version integer,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_rider public.rider_profiles%rowtype;
  v_old_name text;
begin
  select * into o from public.orders where id = p_order_id and restaurant_id = p_restaurant_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.version <> p_expected_version then raise exception 'VERSION_CONFLICT'; end if;
  if o.order_type <> 'delivery' or o.status not in ('accepted', 'preparing', 'ready', 'out_for_delivery') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  if p_rider_id is not null then
    select * into v_rider from public.rider_profiles
     where id = p_rider_id and restaurant_id = p_restaurant_id and branch_id = o.branch_id and is_active;
    if not found then raise exception 'RIDER_NOT_FOUND'; end if;
  end if;
  if o.rider_id is not distinct from p_rider_id then
    return jsonb_build_object('id', o.id, 'version', o.version, 'changed', false);
  end if;
  select name into v_old_name from public.rider_profiles where id = o.rider_id;

  update public.orders set
    rider_id = p_rider_id,
    assigned_at = case when p_rider_id is null then null else now() end,
    version = version + 1
  where id = o.id
  returning version into o.version;

  insert into public.order_events (restaurant_id, order_id, event_type, actor_type, actor_user_id, data)
  values (
    o.restaurant_id, o.id,
    (case when p_rider_id is null then 'rider_unassigned' else 'rider_assigned' end)::public.order_event_type,
    'staff', p_actor_user_id,
    jsonb_strip_nulls(jsonb_build_object('rider_id', p_rider_id, 'rider_name', v_rider.name, 'previous_rider_name', v_old_name))
  );
  return jsonb_build_object('id', o.id, 'version', o.version, 'changed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cash collected by the rider on a delivered COD order
-- ---------------------------------------------------------------------------
create or replace function public.record_cod_collection(
  p_restaurant_id uuid,
  p_order_id uuid,
  p_amount integer,
  p_note text,
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
  select * into o from public.orders where id = p_order_id and restaurant_id = p_restaurant_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if o.status <> 'delivered' then raise exception 'INVALID_TRANSITION'; end if;
  if o.settlement_id is not null then raise exception 'ALREADY_SETTLED'; end if;
  if p_amount < 0 or p_amount > 100000000 then raise exception 'INVALID_AMOUNT'; end if;
  if p_amount <> o.total and nullif(btrim(p_note), '') is null then raise exception 'REASON_REQUIRED'; end if;

  update public.orders set
    cod_collected_amount = p_amount,
    cod_collected_at = now(),
    payment_status = case when p_amount >= o.total then 'paid'::public.payment_status else payment_status end,
    version = version + 1
  where id = o.id
  returning version into o.version;

  insert into public.order_events (restaurant_id, order_id, event_type, actor_type, actor_user_id, data)
  values (o.restaurant_id, o.id, 'cash_collected'::public.order_event_type, 'staff', p_actor_user_id,
          jsonb_strip_nulls(jsonb_build_object('amount', p_amount, 'expected', o.total, 'note', nullif(btrim(p_note), ''))));
  return jsonb_build_object('id', o.id, 'version', o.version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settle a rider's cash: links the orders, records what was received
-- ---------------------------------------------------------------------------
create or replace function public.settle_rider_cash(
  p_restaurant_id uuid,
  p_rider_id uuid,
  p_order_ids uuid[],
  p_amount integer,
  p_settled_by uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rider public.rider_profiles%rowtype;
  v_count integer;
  v_expected bigint;
  v_id uuid;
begin
  select * into v_rider from public.rider_profiles where id = p_rider_id and restaurant_id = p_restaurant_id;
  if not found then raise exception 'RIDER_NOT_FOUND'; end if;
  if coalesce(cardinality(p_order_ids), 0) = 0 then raise exception 'NOTHING_TO_SETTLE'; end if;
  if p_amount < 0 then raise exception 'INVALID_AMOUNT'; end if;

  perform 1 from public.orders where id = any (p_order_ids) and restaurant_id = p_restaurant_id for update;
  select count(*), coalesce(sum(cod_collected_amount), 0) into v_count, v_expected
    from public.orders
   where id = any (p_order_ids) and restaurant_id = p_restaurant_id and rider_id = p_rider_id
     and cod_collected_at is not null and settlement_id is null;
  if v_count <> cardinality(p_order_ids) then raise exception 'ALREADY_SETTLED'; end if;
  if p_amount <> v_expected and nullif(btrim(p_notes), '') is null then raise exception 'REASON_REQUIRED'; end if;

  insert into public.rider_settlements (restaurant_id, branch_id, rider_id, amount, expected_amount, order_ids, settled_by, notes)
  values (p_restaurant_id, v_rider.branch_id, p_rider_id, p_amount, v_expected, p_order_ids, p_settled_by, nullif(btrim(p_notes), ''))
  returning id into v_id;
  update public.orders set settlement_id = v_id where id = any (p_order_ids) and restaurant_id = p_restaurant_id;
  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, new_data)
  values (p_restaurant_id, p_settled_by, 'rider.cash_settled', 'rider', p_rider_id::text,
          jsonb_build_object('amount', p_amount, 'expected', v_expected, 'orders', cardinality(p_order_ids)));
  return jsonb_build_object('id', v_id, 'amount', p_amount, 'expected', v_expected);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rider PIN login: 5 failures → locked 15 minutes (server only)
-- ---------------------------------------------------------------------------
create table public.rider_login_attempts (
  phone text primary key check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.rider_login_attempts enable row level security; -- no policies: server only
revoke all on public.rider_login_attempts from anon, authenticated;
grant all on public.rider_login_attempts to service_role;

create or replace function public.rider_login_failed(p_phone text, p_max integer default 5, p_lock_minutes integer default 15)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_until timestamptz;
begin
  insert into public.rider_login_attempts (phone, failed_count, updated_at)
  values (p_phone, 1, now())
  on conflict (phone) do update set
    -- A finished lock starts a fresh count.
    failed_count = case when public.rider_login_attempts.locked_until is not null and public.rider_login_attempts.locked_until <= now()
                        then 1 else public.rider_login_attempts.failed_count + 1 end,
    locked_until = case when public.rider_login_attempts.locked_until is not null and public.rider_login_attempts.locked_until <= now()
                        then null else public.rider_login_attempts.locked_until end,
    updated_at = now()
  returning failed_count, locked_until into v_count, v_until;
  if v_count >= p_max and (v_until is null or v_until <= now()) then
    update public.rider_login_attempts set locked_until = now() + make_interval(mins => p_lock_minutes)
     where phone = p_phone returning locked_until into v_until;
  end if;
  return jsonb_build_object('failed_count', v_count, 'locked_until', v_until);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.assign_order_rider(uuid, uuid, uuid, integer, uuid)',
    'public.record_cod_collection(uuid, uuid, integer, text, uuid)',
    'public.settle_rider_cash(uuid, uuid, uuid[], integer, uuid, text)',
    'public.rider_login_failed(text, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

alter publication supabase_realtime add table public.rider_profiles;
