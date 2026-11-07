-- Orders: customers, orders, items, events (timeline), payments.
-- Clients can READ (RLS); every WRITE goes through server-only RPCs
-- (next migration) called with the service role after permission checks.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.order_status as enum (
  'pending_confirmation', 'awaiting_acceptance', 'accepted', 'preparing', 'ready',
  'out_for_delivery', 'delivered', 'completed', 'cancelled', 'failed'
);
create type public.order_type as enum ('delivery', 'pickup', 'dine_in');
create type public.order_source as enum ('whatsapp', 'phone', 'walk_in', 'web');
create type public.payment_method as enum ('cod', 'card_on_delivery', 'bank_transfer', 'online_link');
create type public.payment_status as enum ('unpaid', 'pending_verification', 'paid', 'refunded', 'partially_refunded');
create type public.order_event_type as enum (
  'created', 'status_changed', 'edited', 'held', 'unheld', 'cancelled', 'payment_updated', 'note_added', 'printed'
);
create type public.actor_type as enum ('staff', 'customer', 'bot', 'system');

-- ---------------------------------------------------------------------------
-- Branch order settings
-- ---------------------------------------------------------------------------
alter table public.branches
  add column accept_alert_minutes integer not null default 3 check (accept_alert_minutes between 1 and 60),
  add column default_prep_minutes integer not null default 20 check (default_prep_minutes between 1 and 240),
  add column auto_accept_orders boolean not null default false,
  add column late_order_minutes integer not null default 30 check (late_order_minutes between 5 and 480),
  -- false: staff-created orders start "accepted"; true: they wait in "New".
  add column staff_orders_need_acceptance boolean not null default false;

grant update (accept_alert_minutes, default_prep_minutes, auto_accept_orders, late_order_minutes,
  staff_orders_need_acceptance) on public.branches to authenticated;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'), -- E.164
  name text check (char_length(name) <= 120),
  whatsapp_id text check (char_length(whatsapp_id) <= 64),
  notes text check (char_length(notes) <= 2000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  is_blocked boolean not null default false,
  blocked_reason text check (char_length(blocked_reason) <= 300),
  total_orders integer not null default 0,
  total_spent bigint not null default 0,
  cancelled_count integer not null default 0,
  refused_count integer not null default 0,
  last_order_at timestamptz,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, phone),
  unique (id, restaurant_id)
);
create index customers_recent_idx on public.customers (restaurant_id, last_order_at desc nulls last);
create index customers_name_idx on public.customers (restaurant_id, lower(name));
create trigger customers_set_updated_at before update on public.customers
  for each row execute function private.set_updated_at();

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id uuid not null,
  label text check (char_length(label) <= 40),
  address_text text not null check (char_length(btrim(address_text)) between 1 and 500),
  area text check (char_length(area) <= 80),
  landmark text check (char_length(landmark) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id) on delete cascade
);
create index customer_addresses_customer_idx on public.customer_addresses (customer_id);
create index customer_addresses_restaurant_idx on public.customer_addresses (restaurant_id);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table public.order_counters (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  last_number integer not null default 1000
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  order_number integer not null,
  customer_id uuid,
  customer_name text check (char_length(customer_name) <= 120),
  customer_phone text check (char_length(customer_phone) <= 20),
  order_type public.order_type not null,
  source public.order_source not null,
  status public.order_status not null,
  is_on_hold boolean not null default false,
  hold_reason text check (char_length(hold_reason) <= 300),
  payment_method public.payment_method not null default 'cod',
  payment_status public.payment_status not null default 'unpaid',
  subtotal integer not null check (subtotal >= 0),
  delivery_fee integer not null default 0 check (delivery_fee >= 0),
  discount integer not null default 0 check (discount >= 0),
  tax integer not null default 0 check (tax >= 0),
  service_charge integer not null default 0 check (service_charge >= 0),
  total integer not null check (total >= 0),
  address_text text check (char_length(address_text) <= 500),
  area text check (char_length(area) <= 80),
  landmark text check (char_length(landmark) <= 200),
  latitude double precision,
  longitude double precision,
  table_number text check (char_length(table_number) <= 20),
  notes text check (char_length(notes) <= 1000),
  scheduled_for timestamptz,
  expected_ready_at timestamptz,
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 60),
  cancel_note text check (char_length(cancel_note) <= 300),
  cancelled_by uuid references auth.users (id) on delete set null,
  rider_id uuid, -- FK added with riders (Phase 9)
  version integer not null default 1,
  idempotency_key text check (char_length(idempotency_key) <= 100),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, order_number),
  unique (restaurant_id, idempotency_key),
  unique (id, restaurant_id),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id) on delete set null (customer_id),
  -- Money can never be inconsistent, whoever writes the row.
  constraint orders_total_matches
    check (total = subtotal + delivery_fee + tax + service_charge - discount),
  constraint orders_discount_limit check (discount <= subtotal)
);
create index orders_board_idx on public.orders (restaurant_id, branch_id, status, created_at);
create index orders_recent_idx on public.orders (restaurant_id, created_at desc);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_branch_idx on public.orders (branch_id);
create trigger orders_set_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null,
  -- Plain ids (no FK): the snapshot is the source of truth for past orders.
  item_id uuid not null,
  variant_id uuid,
  item_name text not null check (char_length(item_name) <= 80),
  size_name text check (char_length(size_name) <= 40),
  quantity integer not null check (quantity between 1 and 99),
  unit_price integer not null check (unit_price >= 0),
  line_total integer not null check (line_total >= 0),
  removals text[] not null default '{}',
  notes text check (char_length(notes) <= 300),
  snapshot jsonb not null,
  is_cancelled boolean not null default false, -- replaced by an edit
  created_at timestamptz not null default now(),
  unique (id, restaurant_id),
  foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id) on delete cascade,
  constraint order_items_line_total check (line_total = unit_price * quantity)
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_restaurant_idx on public.order_items (restaurant_id);

create table public.order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_item_id uuid not null,
  option_id uuid,
  group_name text not null check (char_length(group_name) <= 60),
  option_name text not null check (char_length(option_name) <= 60),
  price_delta integer not null check (price_delta >= 0),
  foreign key (order_item_id, restaurant_id) references public.order_items (id, restaurant_id) on delete cascade
);
create index order_item_modifiers_item_idx on public.order_item_modifiers (order_item_id);
create index order_item_modifiers_restaurant_idx on public.order_item_modifiers (restaurant_id);

create table public.order_events (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null,
  event_type public.order_event_type not null,
  from_status public.order_status,
  to_status public.order_status,
  actor_type public.actor_type not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  -- Never put customer phone/address in here: kitchen users can read events.
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id) on delete cascade
);
create index order_events_order_idx on public.order_events (order_id, created_at);
create index order_events_restaurant_idx on public.order_events (restaurant_id, created_at desc);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null,
  method public.payment_method not null,
  amount integer not null check (amount > 0),
  status public.payment_status not null,
  reference text check (char_length(reference) <= 100),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id) on delete cascade
);
create index payments_order_idx on public.payments (order_id);
create index payments_restaurant_idx on public.payments (restaurant_id);

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- Front of house (owner/manager/staff) with access to the order's branch.
create or replace function private.can_read_order(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and private.has_role(o.restaurant_id, '{owner,manager,staff}')
      and private.can_access_branch(o.branch_id)
  );
$$;

-- Front of house OR kitchen with branch access (items, extras, timeline).
create or replace function private.can_read_order_kitchen(p_order_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and private.has_role(o.restaurant_id, '{owner,manager,staff,kitchen}')
      and private.can_access_branch(o.branch_id)
  );
$$;

create or replace function private.can_read_order_item(p_order_item_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.order_items i
    where i.id = p_order_item_id and private.can_read_order_kitchen(i.order_id)
  );
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Grants: read-only for signed-in users. No insert/update on orders,
-- items, payments or counters — only server RPCs write them.
-- ---------------------------------------------------------------------------
revoke all on public.customers, public.customer_addresses, public.order_counters, public.orders,
  public.order_items, public.order_item_modifiers, public.order_events, public.payments
  from anon, authenticated;
grant all on public.customers, public.customer_addresses, public.order_counters, public.orders,
  public.order_items, public.order_item_modifiers, public.order_events, public.payments
  to service_role;

grant select on public.customers, public.customer_addresses, public.orders, public.order_items,
  public.order_item_modifiers, public.order_events, public.payments to authenticated;
-- Staff can edit notes and tags directly; stats and blocking are server-only.
grant update (name, notes, tags, marketing_opt_in) on public.customers to authenticated;

alter table public.customers enable row level security;
alter table public.customer_addresses enable row level security;
alter table public.order_counters enable row level security; -- no policies: server only
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_events enable row level security;
alter table public.payments enable row level security;

create policy "customers: front of house read" on public.customers for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));
create policy "customers: front of house edit notes/tags" on public.customers for update to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}'))
  with check (private.has_role(restaurant_id, '{owner,manager,staff}'));

create policy "customer_addresses: front of house read" on public.customer_addresses for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));

-- Kitchen has NO row access to orders (phone/address). It uses kitchen_orders.
create policy "orders: front of house with branch access read" on public.orders for select to authenticated
  using (
    (private.has_role(restaurant_id, '{owner,manager,staff}') and private.can_access_branch(branch_id))
    or (select private.is_super_admin())
  );

create policy "order_items: readable with the order (incl. kitchen)" on public.order_items for select to authenticated
  using (private.can_read_order_kitchen(order_id) or (select private.is_super_admin()));

create policy "order_item_modifiers: readable with the order (incl. kitchen)" on public.order_item_modifiers
  for select to authenticated
  using (private.can_read_order_item(order_item_id) or (select private.is_super_admin()));

create policy "order_events: readable with the order (incl. kitchen)" on public.order_events for select to authenticated
  using (private.can_read_order_kitchen(order_id) or (select private.is_super_admin()));

create policy "payments: front of house read" on public.payments for select to authenticated
  using (private.can_read_order(order_id) or (select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Kitchen view: order fields WITHOUT phone/address/money details.
-- Owned by postgres (bypasses orders RLS); the WHERE clause is the guard.
-- ---------------------------------------------------------------------------
create view public.kitchen_orders with (security_barrier = true) as
select
  o.id, o.restaurant_id, o.branch_id, o.order_number, o.order_type, o.source, o.status,
  o.is_on_hold, o.customer_name, o.table_number, o.notes, o.scheduled_for, o.expected_ready_at,
  o.accepted_at, o.preparing_at, o.ready_at, o.version, o.created_at, o.updated_at
from public.orders o
where private.has_role(o.restaurant_id, '{owner,manager,staff,kitchen}')
  and private.can_access_branch(o.branch_id);

revoke all on public.kitchen_orders from anon, authenticated;
grant select on public.kitchen_orders to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes respects RLS)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.orders, public.order_events;
