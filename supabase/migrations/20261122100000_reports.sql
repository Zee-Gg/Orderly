-- Phase 11: reports. Read-only RPCs that aggregate in the database.
--
-- SALES = orders with status delivered or completed. Cancelled and failed
-- orders are counted separately and never in sales. "pending_confirmation"
-- (bot drafts never confirmed) is ignored everywhere.
--
-- Every report RPC:
--   * is SECURITY INVOKER: RLS on orders/order_items/... still applies, so a
--     branch-limited manager only ever sees their branch;
--   * starts with private.report_scope(), which allows owners/managers only
--     (and super admin), "all branches" (p_branch_id null) for owners only,
--     and returns the restaurant's time zone;
--   * takes local dates p_from..p_to (inclusive, restaurant time zone).

-- ---------------------------------------------------------------------------
-- Guard + helpers (private schema: not exposed through the API)
-- ---------------------------------------------------------------------------
create or replace function private.report_scope(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_admin boolean := private.is_super_admin();
begin
  if not (v_admin or private.has_role(p_restaurant_id, '{owner,manager}')) then
    raise exception 'Reports are for owners and managers' using errcode = '42501';
  end if;
  if p_branch_id is null then
    if not (v_admin or private.has_role(p_restaurant_id, '{owner}')) then
      raise exception 'Only the owner can see all branches together' using errcode = '42501';
    end if;
  else
    if not exists (select 1 from public.branches b where b.id = p_branch_id and b.restaurant_id = p_restaurant_id) then
      raise exception 'Unknown branch' using errcode = '22023';
    end if;
    if not (v_admin or private.can_access_branch(p_branch_id)) then
      raise exception 'No access to this branch' using errcode = '42501';
    end if;
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'Pick a date range of up to 400 days' using errcode = '22023';
  end if;
  select r.timezone into v_tz from public.restaurants r where r.id = p_restaurant_id;
  return coalesce(nullif(v_tz, ''), 'Asia/Karachi');
end;
$$;

-- Masked phone for reports/exports: +923001234567 -> 0300-***4567.
create or replace function private.mask_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_phone is null or length(p_phone) < 8 then null
    when p_phone like '+92%' and length(p_phone) = 13 then '0' || substr(p_phone, 4, 3) || '-***' || right(p_phone, 4)
    else left(p_phone, 4) || '***' || right(p_phone, 4)
  end;
$$;

-- Where an order came from, in report words:
-- menu_page (cart from /m/[slug] or web), bot (WhatsApp, placed by the AI),
-- whatsapp_staff (WhatsApp chat, typed by staff), phone, walk_in.
-- Invoker: reads bot_sessions under the caller's RLS.
create or replace function private.report_channel(p_source public.order_source, p_created_by uuid, p_order_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_source = 'web' then 'menu_page'
    when p_source = 'whatsapp' and p_created_by is null then
      case when exists (
        select 1 from public.bot_sessions s where s.order_id = p_order_id and s.cart_draft_id is not null
      ) then 'menu_page' else 'bot' end
    when p_source = 'whatsapp' then 'whatsapp_staff'
    else p_source::text
  end;
$$;

revoke execute on function private.report_scope(uuid, uuid, date, date) from public, anon;
revoke execute on function private.mask_phone(text) from public, anon;
revoke execute on function private.report_channel(public.order_source, uuid, uuid) from public, anon;
grant execute on function private.report_scope(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function private.mask_phone(text) to authenticated, service_role;
grant execute on function private.report_channel(public.order_source, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Overview: totals, splits, cancellations, speed, customers (one round trip)
-- ---------------------------------------------------------------------------
create or replace function public.report_overview(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
  v_start timestamptz := p_from::timestamp at time zone v_tz;
  v_end timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_result jsonb;
begin
  with o as (
    select o.id, o.status, o.order_type, o.source, o.created_by, o.payment_method, o.total, o.customer_id,
           o.created_at, o.accepted_at, o.ready_at, o.dispatched_at, o.delivered_at,
           o.cancel_reason, o.delivery_failed_reason, b.late_order_minutes
    from public.orders o
    join public.branches b on b.id = o.branch_id
    where o.restaurant_id = p_restaurant_id
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and o.created_at >= v_start and o.created_at < v_end
      and o.status <> 'pending_confirmation'
  ),
  sales as (
    select * from o where status in ('delivered', 'completed')
  ),
  cust as (
    select s.customer_id, count(*) as n
    from sales s where s.customer_id is not null
    group by s.customer_id
  )
  select jsonb_build_object(
    'sales', coalesce((select sum(total) from sales), 0),
    'orders', (select count(*) from sales),
    'received', (select count(*) from o),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'failed', (select count(*) from o where status = 'failed'),
    'open', (select count(*) from o where status not in ('delivered', 'completed', 'cancelled', 'failed')),
    'by_type', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'orders', n, 'sales', t) order by n desc), '[]'::jsonb)
      from (select order_type::text as k, count(*) as n, sum(total) as t from sales group by 1) x
    ),
    'by_payment', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'orders', n, 'sales', t) order by n desc), '[]'::jsonb)
      from (select payment_method::text as k, count(*) as n, sum(total) as t from sales group by 1) x
    ),
    'by_channel', (
      select coalesce(jsonb_agg(jsonb_build_object('key', k, 'orders', n, 'sales', t) order by n desc), '[]'::jsonb)
      from (
        select private.report_channel(source, created_by, id) as k, count(*) as n, sum(total) as t
        from sales group by 1
      ) x
    ),
    'cancel_reasons', (
      select coalesce(jsonb_agg(jsonb_build_object('status', st, 'reason', r, 'count', n) order by n desc), '[]'::jsonb)
      from (
        select status::text as st,
               coalesce(nullif(delivery_failed_reason, ''), nullif(cancel_reason, ''), 'unknown') as r,
               count(*) as n
        from o where status in ('cancelled', 'failed')
        group by 1, 2
      ) x
    ),
    'prep_minutes', (
      select round(avg(extract(epoch from ready_at - accepted_at) / 60)::numeric, 1)
      from sales where accepted_at is not null and ready_at is not null and ready_at >= accepted_at
    ),
    'delivery_minutes', (
      select round(avg(extract(epoch from delivered_at - dispatched_at) / 60)::numeric, 1)
      from sales where order_type = 'delivery' and dispatched_at is not null and delivered_at is not null
        and delivered_at >= dispatched_at
    ),
    -- Late = finished later than the branch's "late order" minutes after it came in
    -- (the same minutes the orders board uses for its late warning).
    'late', (
      select count(*) from sales
      where (case when order_type = 'delivery' then delivered_at else ready_at end)
            > created_at + make_interval(mins => late_order_minutes)
    ),
    'customers', (
      select jsonb_build_object(
        'total', count(*),
        'new', count(*) filter (where not exists (
          select 1 from public.orders p
          where p.customer_id = cust.customer_id
            and p.restaurant_id = p_restaurant_id
            and p.created_at < v_start
            and p.status in ('delivered', 'completed')
        )),
        'repeat', count(*) filter (where n >= 2)
      )
      from cust
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales per local day (every day in the range, zeros included)
-- ---------------------------------------------------------------------------
create or replace function public.report_daily(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns table (day date, sales bigint, orders bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
begin
  return query
  with s as (
    select (o.created_at at time zone v_tz)::date as d, sum(o.total)::bigint as t, count(*)::bigint as n
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and o.created_at >= (p_from::timestamp at time zone v_tz)
      and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
      and o.status in ('delivered', 'completed')
    group by 1
  )
  select g.d::date, coalesce(s.t, 0)::bigint, coalesce(s.n, 0)::bigint
  from generate_series(p_from, p_to, interval '1 day') as g(d)
  left join s on s.d = g.d::date
  order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sales orders per hour of the day (0–23, local time)
-- ---------------------------------------------------------------------------
create or replace function public.report_hours(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns table (hour integer, orders bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
begin
  return query
  with s as (
    select extract(hour from o.created_at at time zone v_tz)::integer as h, count(*)::bigint as n
    from public.orders o
    where o.restaurant_id = p_restaurant_id
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and o.created_at >= (p_from::timestamp at time zone v_tz)
      and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
      and o.status in ('delivered', 'completed')
    group by 1
  )
  select g.h, coalesce(s.n, 0)::bigint
  from generate_series(0, 23) as g(h)
  left join s on s.h = g.h
  order by 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Items: top sellers (by quantity) and the slowest active menu items
-- ---------------------------------------------------------------------------
create or replace function public.report_items(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
  v_start timestamptz := p_from::timestamp at time zone v_tz;
  v_end timestamptz := (p_to + 1)::timestamp at time zone v_tz;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 500);
  v_result jsonb;
begin
  with sold as (
    select i.item_id,
           (array_agg(i.item_name order by i.created_at desc))[1] as name,
           sum(i.quantity)::bigint as qty,
           sum(i.line_total)::bigint as revenue
    from public.order_items i
    join public.orders o on o.id = i.order_id
    where o.restaurant_id = p_restaurant_id
      and (p_branch_id is null or o.branch_id = p_branch_id)
      and o.created_at >= v_start and o.created_at < v_end
      and o.status in ('delivered', 'completed')
      and not i.is_cancelled
    group by i.item_id
  )
  select jsonb_build_object(
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'name', name, 'qty', qty, 'revenue', revenue)
                                order by qty desc, revenue desc), '[]'::jsonb)
      from (select * from sold order by qty desc, revenue desc limit v_limit) t
    ),
    -- Active, not archived items that existed for the whole period, fewest sold first.
    'slow', (
      select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'name', name, 'qty', qty) order by qty, name), '[]'::jsonb)
      from (
        select m.id, m.name, coalesce(s.qty, 0) as qty
        from public.menu_items m
        left join sold s on s.item_id = m.id
        where m.restaurant_id = p_restaurant_id
          and m.archived_at is null
          and m.is_active
          and m.created_at < v_start
        order by coalesce(s.qty, 0), m.name
        limit 5
      ) t
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Riders: deliveries, average delivery time, failed, cash collected
-- ---------------------------------------------------------------------------
create or replace function public.report_riders(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns table (rider_id uuid, name text, deliveries bigint, avg_minutes numeric, failed bigint, cash_collected bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
begin
  return query
  select o.rider_id,
         coalesce(max(r.name), 'Rider') as name,
         count(*) filter (where o.status in ('delivered', 'completed'))::bigint,
         round(avg(extract(epoch from o.delivered_at - o.dispatched_at) / 60)
               filter (where o.delivered_at is not null and o.dispatched_at is not null
                       and o.delivered_at >= o.dispatched_at)::numeric, 1),
         count(*) filter (where o.status = 'failed')::bigint,
         coalesce(sum(o.cod_collected_amount), 0)::bigint
  from public.orders o
  left join public.rider_profiles r on r.id = o.rider_id
  where o.restaurant_id = p_restaurant_id
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and o.created_at >= (p_from::timestamp at time zone v_tz)
    and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
    and o.rider_id is not null
    and o.status in ('delivered', 'completed', 'failed')
  group by o.rider_id
  order by 3 desc, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- Top customers by spend (masked phone only — never the full number)
-- ---------------------------------------------------------------------------
create or replace function public.report_top_customers(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns table (customer_id uuid, name text, phone_masked text, orders bigint, spent bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
begin
  return query
  select o.customer_id,
         coalesce(max(c.name), max(o.customer_name)),
         private.mask_phone(coalesce(max(c.phone), max(o.customer_phone))),
         count(*)::bigint,
         sum(o.total)::bigint
  from public.orders o
  left join public.customers c on c.id = o.customer_id
  where o.restaurant_id = p_restaurant_id
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and o.created_at >= (p_from::timestamp at time zone v_tz)
    and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
    and o.status in ('delivered', 'completed')
    and o.customer_id is not null
  group by o.customer_id
  order by 5 desc
  limit 10;
end;
$$;

-- ---------------------------------------------------------------------------
-- WhatsApp bot + menu page funnel
-- ---------------------------------------------------------------------------
create or replace function public.report_bot(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
  v_start timestamptz := p_from::timestamp at time zone v_tz;
  v_end timestamptz := (p_to + 1)::timestamp at time zone v_tz;
begin
  return jsonb_build_object(
    'conversations', (
      select count(*) from public.bot_sessions s
      where s.restaurant_id = p_restaurant_id
        and (p_branch_id is null or s.branch_id = p_branch_id)
        and s.conversation_id is not null
        and s.created_at >= v_start and s.created_at < v_end
    ),
    'handoffs', (
      select count(*) from public.bot_sessions s
      where s.restaurant_id = p_restaurant_id
        and (p_branch_id is null or s.branch_id = p_branch_id)
        and s.conversation_id is not null
        and (s.status = 'handed_off' or s.handoff_reason is not null)
        and s.created_at >= v_start and s.created_at < v_end
    ),
    -- Every order the bot placed (any status except never-confirmed drafts).
    'bot_orders', (
      select count(*) from public.orders o
      where o.restaurant_id = p_restaurant_id
        and (p_branch_id is null or o.branch_id = p_branch_id)
        and o.source = 'whatsapp' and o.created_by is null
        and o.status <> 'pending_confirmation'
        and o.created_at >= v_start and o.created_at < v_end
    ),
    'bot_sales_orders', (
      select count(*) from public.orders o
      where o.restaurant_id = p_restaurant_id
        and (p_branch_id is null or o.branch_id = p_branch_id)
        and o.source = 'whatsapp' and o.created_by is null
        and o.status in ('delivered', 'completed')
        and o.created_at >= v_start and o.created_at < v_end
    ),
    'menu_views', (
      select coalesce(sum(v.views), 0) from public.menu_page_views v
      where v.restaurant_id = p_restaurant_id
        and (p_branch_id is null or v.branch_id = p_branch_id)
        and v.day between p_from and p_to
    ),
    'carts_sent', (
      select count(*) from public.cart_drafts d
      where d.restaurant_id = p_restaurant_id
        and (p_branch_id is null or d.branch_id = p_branch_id)
        and d.created_at >= v_start and d.created_at < v_end
    ),
    'cart_orders', (
      select count(*) from public.bot_sessions s
      join public.orders o on o.id = s.order_id
      where s.restaurant_id = p_restaurant_id
        and (p_branch_id is null or s.branch_id = p_branch_id)
        and s.cart_draft_id is not null
        and o.status <> 'pending_confirmation'
        and o.created_at >= v_start and o.created_at < v_end
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Branch comparison (owners: all branches only)
-- ---------------------------------------------------------------------------
create or replace function public.report_branches(p_restaurant_id uuid, p_from date, p_to date)
returns table (branch_id uuid, name text, sales bigint, orders bigint, received bigint, cancelled bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, null, p_from, p_to);
begin
  return query
  select b.id, b.name,
         coalesce(sum(o.total) filter (where o.status in ('delivered', 'completed')), 0)::bigint,
         count(o.id) filter (where o.status in ('delivered', 'completed'))::bigint,
         count(o.id)::bigint,
         count(o.id) filter (where o.status = 'cancelled')::bigint
  from public.branches b
  left join public.orders o
    on o.branch_id = b.id
   and o.created_at >= (p_from::timestamp at time zone v_tz)
   and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
   and o.status <> 'pending_confirmation'
  where b.restaurant_id = p_restaurant_id
    and b.is_active
  group by b.id, b.name
  order by 3 desc, 2;
end;
$$;

-- ---------------------------------------------------------------------------
-- CSV export: every order in the period (all statuses), masked phone
-- ---------------------------------------------------------------------------
create or replace function public.report_orders_export(p_restaurant_id uuid, p_branch_id uuid, p_from date, p_to date)
returns table (
  order_number integer, created_at timestamptz, branch_name text, customer_name text, phone_masked text,
  order_type text, channel text, items text, subtotal integer, delivery_fee integer, discount integer,
  total integer, payment_method text, payment_status text, status text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := private.report_scope(p_restaurant_id, p_branch_id, p_from, p_to);
begin
  return query
  select o.order_number, o.created_at, b.name, o.customer_name, private.mask_phone(o.customer_phone),
         o.order_type::text, private.report_channel(o.source, o.created_by, o.id),
         (
           select string_agg(i.quantity || ' x ' || i.item_name || coalesce(' (' || i.size_name || ')', ''), '; ' order by i.created_at)
           from public.order_items i where i.order_id = o.id and not i.is_cancelled
         ),
         o.subtotal, o.delivery_fee, o.discount, o.total,
         o.payment_method::text, o.payment_status::text, o.status::text
  from public.orders o
  join public.branches b on b.id = o.branch_id
  where o.restaurant_id = p_restaurant_id
    and (p_branch_id is null or o.branch_id = p_branch_id)
    and o.created_at >= (p_from::timestamp at time zone v_tz)
    and o.created_at < ((p_to + 1)::timestamp at time zone v_tz)
    and o.status <> 'pending_confirmation'
  order by o.created_at
  limit 20000;
end;
$$;

-- Grants: signed-in users may call them (the guard + RLS decide what they see).
revoke execute on function public.report_overview(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_daily(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_hours(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_items(uuid, uuid, date, date, integer) from public, anon;
revoke execute on function public.report_riders(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_top_customers(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_bot(uuid, uuid, date, date) from public, anon;
revoke execute on function public.report_branches(uuid, date, date) from public, anon;
revoke execute on function public.report_orders_export(uuid, uuid, date, date) from public, anon;
grant execute on function public.report_overview(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_daily(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_hours(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_items(uuid, uuid, date, date, integer) to authenticated, service_role;
grant execute on function public.report_riders(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_top_customers(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_bot(uuid, uuid, date, date) to authenticated, service_role;
grant execute on function public.report_branches(uuid, date, date) to authenticated, service_role;
grant execute on function public.report_orders_export(uuid, uuid, date, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Indexes for the date-range scans
-- ---------------------------------------------------------------------------
create index if not exists orders_branch_created_idx on public.orders (branch_id, created_at);
create index if not exists orders_rider_created_idx on public.orders (rider_id, created_at) where rider_id is not null;
create index if not exists bot_sessions_restaurant_created_idx on public.bot_sessions (restaurant_id, created_at);
