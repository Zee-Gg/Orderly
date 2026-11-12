-- Phase 8: customer menu page (/m/[slug]). Customers build a cart on the page,
-- the server saves it as a cart draft with a short code, and the WhatsApp bot
-- loads that code into the chat. Orders are still ONLY created by the bot's
-- confirm flow. No personal data is stored in drafts.

-- ---------------------------------------------------------------------------
-- cart_drafts: written and read by server code only (service role)
-- ---------------------------------------------------------------------------
create table public.cart_drafts (
  id uuid primary key default gen_random_uuid(),
  -- 4–5 characters, no look-alikes (no O/0/I/1), at least one letter and one digit.
  code text not null check (code ~ '^[A-HJ-NP-Z2-9]{4,5}$' and code ~ '[2-9]' and code ~ '[A-HJ-NP-Z]'),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  order_type text check (order_type in ('delivery', 'pickup')),
  -- [{ item_id, variant_id, option_ids, removals, quantity, notes }] — choices only, never prices.
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 30),
  language text not null default 'english' check (language in ('english', 'urdu')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  used_at timestamptz,
  used_by_customer_id uuid,
  session_id uuid,                     -- the bot session that loaded it (conversion stats)
  created_ip_hash text check (char_length(created_ip_hash) <= 128),
  unique (restaurant_id, code),
  check (expires_at > created_at),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (used_by_customer_id, restaurant_id) references public.customers (id, restaurant_id) on delete set null (used_by_customer_id),
  foreign key (session_id) references public.bot_sessions (id) on delete set null
);
create index cart_drafts_restaurant_idx on public.cart_drafts (restaurant_id, created_at desc);
create index cart_drafts_ip_idx on public.cart_drafts (created_ip_hash, created_at desc) where created_ip_hash is not null;
create index cart_drafts_branch_idx on public.cart_drafts (branch_id);
create index cart_drafts_customer_idx on public.cart_drafts (used_by_customer_id) where used_by_customer_id is not null;
create index cart_drafts_session_idx on public.cart_drafts (session_id) where session_id is not null;

alter table public.cart_drafts enable row level security;
revoke all on public.cart_drafts from anon, authenticated;
grant all on public.cart_drafts to service_role;
-- Owners/managers may read their own drafts for stats (never the IP hash or the lines).
grant select (id, restaurant_id, branch_id, order_type, created_at, expires_at, used_at, session_id) on public.cart_drafts to authenticated;
create policy "cart_drafts: owner/manager read" on public.cart_drafts for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') or (select private.is_super_admin()));

-- A bot session remembers the draft it loaded, and a code waiting for "Replace / Add".
alter table public.bot_sessions
  add column cart_draft_id uuid references public.cart_drafts (id) on delete set null,
  add column pending_cart_code text check (pending_cart_code ~ '^[A-HJ-NP-Z2-9]{4,5}$');
create index bot_sessions_cart_draft_idx on public.bot_sessions (cart_draft_id) where cart_draft_id is not null;

-- ---------------------------------------------------------------------------
-- menu_page_views: one counter per branch per day (no personal data)
-- ---------------------------------------------------------------------------
create table public.menu_page_views (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  day date not null,
  views integer not null default 0 check (views >= 0),
  primary key (restaurant_id, branch_id, day),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);
create index menu_page_views_branch_idx on public.menu_page_views (branch_id);

alter table public.menu_page_views enable row level security;
revoke all on public.menu_page_views from anon, authenticated;
grant all on public.menu_page_views to service_role;
grant select on public.menu_page_views to authenticated;
create policy "menu_page_views: owner/manager read" on public.menu_page_views for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') or (select private.is_super_admin()));

-- +1 view for today (restaurant time zone). Server only.
create or replace function public.record_menu_page_view(p_restaurant_id uuid, p_branch_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.menu_page_views (restaurant_id, branch_id, day, views)
  select r.id, b.id, (now() at time zone coalesce(r.timezone, 'Asia/Karachi'))::date, 1
    from public.restaurants r
    join public.branches b on b.restaurant_id = r.id and b.id = p_branch_id and b.is_active
   where r.id = p_restaurant_id and r.status in ('trial', 'active')
  on conflict (restaurant_id, branch_id, day) do update set views = public.menu_page_views.views + 1;
$$;
revoke all on function public.record_menu_page_view(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_menu_page_view(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Public page info (anyone): restaurant, branches, WhatsApp number, offers,
-- bestseller ids. Only trial/active restaurants. Prices are NOT here: the page
-- takes them from the pricing engine (getBranchMenu).
-- ---------------------------------------------------------------------------
create or replace function public.get_public_menu_info(p_slug text, p_branch_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select id, name, slug, logo_url, timezone
      from public.restaurants
     where slug = lower(btrim(p_slug)) and status in ('trial', 'active')
  ),
  br as (
    select b.id, b.name, b.area, b.address, b.is_open, b.opening_hours, b.default_delivery_fee, b.minimum_order,
           b.default_prep_minutes, b.delivery_minutes, b.created_at
      from public.branches b join r on r.id = b.restaurant_id
     where b.is_active
  ),
  wa as (
    select a.display_phone_number, a.branch_id
      from public.whatsapp_accounts a join r on r.id = a.restaurant_id
     where a.is_active
     limit 1
  ),
  chosen as (
    select coalesce(
      (select id from br where id = p_branch_id),
      (select br.id from br join wa on wa.branch_id = br.id),
      (select id from br order by created_at limit 1)
    ) as id
  ),
  tagged as (
    select i.id, 0 as rank, i.sort_order::bigint as qty
      from public.menu_items i join r on r.id = i.restaurant_id
     where i.archived_at is null and i.is_active and 'bestseller' = any (i.tags)
  ),
  sold as (
    select oi.item_id as id, 1 as rank, sum(oi.quantity)::bigint as qty
      from public.order_items oi
      join public.orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
      join r on r.id = o.restaurant_id
     where o.branch_id = (select id from chosen)
       and o.created_at >= now() - interval '30 days'
       and o.status not in ('cancelled', 'failed', 'pending_confirmation')
       and not oi.is_cancelled
     group by oi.item_id
  ),
  best as (
    select id from (
      select distinct on (id) id, rank, qty from (select * from tagged union all select * from sold) x
       order by id, rank
    ) y
    order by rank, case when rank = 0 then qty else -qty end
    limit 5
  )
  select case when not exists (select 1 from r) then null else jsonb_build_object(
    'restaurant', (select to_jsonb(r) from r),
    'branches', coalesce((select jsonb_agg(to_jsonb(br) - 'created_at' order by br.created_at) from br), '[]'::jsonb),
    'branch_id', (select id from chosen),
    'whatsapp_number', (select display_phone_number from wa),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'branch_id', o.branch_id, 'title', o.title, 'title_ur', o.title_ur, 'description', o.description,
        'menu_item_id', o.menu_item_id, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'days_of_week', o.days_of_week,
        'start_time', o.start_time, 'end_time', o.end_time
      ) order by o.sort_order, o.created_at)
        from public.offers o join r on r.id = o.restaurant_id
       where o.is_active and (o.ends_at is null or o.ends_at > now())
    ), '[]'::jsonb),
    'bestseller_ids', coalesce((select jsonb_agg(id) from best), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.get_public_menu_info(text, uuid) from public;
grant execute on function public.get_public_menu_info(text, uuid) to anon, authenticated, service_role;
