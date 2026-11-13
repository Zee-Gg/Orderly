-- Phase 12: platform admin, plans + subscriptions (manual payments), platform
-- settings, rate limits, scheduled jobs (pg_cron), customer data deletion.
--
-- restaurants.status stays THE access switch the rest of the app already
-- checks (menu page, bot, dashboard). It is now driven by the subscription:
--   subscription trial            → restaurants.status 'trial'
--   subscription active/past_due  → 'active'   (past_due = banner, still works)
--   subscription suspended/cancelled → 'suspended'
-- Nothing is ever deleted when a restaurant is suspended.

-- ---------------------------------------------------------------------------
-- Plans (platform-wide, readable by everyone for the pricing section)
-- ---------------------------------------------------------------------------
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 40),
  description text check (char_length(description) <= 300),
  monthly_price integer not null check (monthly_price >= 0), -- paisa
  max_branches integer not null default 1 check (max_branches between 1 and 1000),
  max_orders_per_month integer check (max_orders_per_month > 0),             -- null = unlimited
  max_bot_conversations_per_month integer check (max_bot_conversations_per_month > 0), -- null = unlimited
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger plans_set_updated_at before update on public.plans
  for each row execute function private.set_updated_at();

alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;
grant all on public.plans to service_role;
grant select on public.plans to anon, authenticated;
create policy "plans: everyone reads active plans" on public.plans for select to anon, authenticated
  using (is_active or (select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Platform settings (one row)
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  id boolean primary key default true check (id),
  default_trial_days integer not null default 14 check (default_trial_days between 0 and 365),
  grace_period_days integer not null default 5 check (grace_period_days between 0 and 60),
  payment_instructions text check (char_length(payment_instructions) <= 2000),
  sales_whatsapp text check (sales_whatsapp ~ '^[0-9]{8,15}$'), -- digits only, e.g. 923001234567
  support_phone text check (char_length(support_phone) <= 30),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict do nothing;
create trigger platform_settings_set_updated_at before update on public.platform_settings
  for each row execute function private.set_updated_at();

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
grant all on public.platform_settings to service_role;
-- Signed-in users (owners) read how to pay; the public only sees the sales number.
grant select on public.platform_settings to authenticated;
grant select (sales_whatsapp, support_phone) on public.platform_settings to anon;
create policy "platform_settings: readable" on public.platform_settings for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Subscriptions + payments
-- ---------------------------------------------------------------------------
create table public.restaurant_subscriptions (
  restaurant_id uuid primary key references public.restaurants (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  past_due_since timestamptz,
  suspended_at timestamptz,
  notes text check (char_length(notes) <= 1000), -- super admin only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restaurant_subscriptions_plan_idx on public.restaurant_subscriptions (plan_id);
create index restaurant_subscriptions_status_idx on public.restaurant_subscriptions (status);
create trigger restaurant_subscriptions_set_updated_at before update on public.restaurant_subscriptions
  for each row execute function private.set_updated_at();

alter table public.restaurant_subscriptions enable row level security;
revoke all on public.restaurant_subscriptions from anon, authenticated;
grant all on public.restaurant_subscriptions to service_role;
grant select (restaurant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end,
  past_due_since, suspended_at, created_at, updated_at) on public.restaurant_subscriptions to authenticated;
create policy "restaurant_subscriptions: owner reads" on public.restaurant_subscriptions for select to authenticated
  using (private.has_role(restaurant_id, '{owner}') or (select private.is_super_admin()));

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  plan_id uuid references public.plans (id) on delete set null,
  amount integer not null check (amount > 0), -- paisa
  method text not null check (method in ('bank_transfer', 'jazzcash', 'easypaisa', 'cash')),
  reference text check (char_length(reference) <= 100),
  notes text check (char_length(notes) <= 500),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  receipt_number integer generated always as identity,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index subscription_payments_restaurant_idx on public.subscription_payments (restaurant_id, created_at desc);
create index subscription_payments_plan_idx on public.subscription_payments (plan_id);
create index subscription_payments_recorded_by_idx on public.subscription_payments (recorded_by);

alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;
grant all on public.subscription_payments to service_role;
grant select (id, restaurant_id, plan_id, amount, method, reference, period_start, period_end, receipt_number, created_at)
  on public.subscription_payments to authenticated;
create policy "subscription_payments: owner reads" on public.subscription_payments for select to authenticated
  using (private.has_role(restaurant_id, '{owner}') or (select private.is_super_admin()));

-- Subscription status → restaurants.status (+ trial end), so every existing check keeps working.
create or replace function private.sync_restaurant_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.restaurants r
     set status = case new.status
                    when 'trial' then 'trial'::public.restaurant_status
                    when 'active' then 'active'::public.restaurant_status
                    when 'past_due' then 'active'::public.restaurant_status
                    else 'suspended'::public.restaurant_status
                  end,
         trial_ends_at = new.trial_ends_at
   where r.id = new.restaurant_id;
  return new;
end;
$$;
create trigger restaurant_subscriptions_sync_status
  after insert or update of status, trial_ends_at on public.restaurant_subscriptions
  for each row execute function private.sync_restaurant_status();

-- Every new restaurant gets a trial subscription (default plan = first active plan).
create or replace function private.create_trial_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_plan uuid;
begin
  select default_trial_days into v_days from public.platform_settings where id;
  select p.id into v_plan from public.plans p where p.is_active order by p.sort_order, p.monthly_price limit 1;
  insert into public.restaurant_subscriptions (restaurant_id, plan_id, status, trial_ends_at)
  values (new.id, v_plan, 'trial', now() + make_interval(days => coalesce(v_days, 14)))
  on conflict (restaurant_id) do nothing;
  return new;
end;
$$;
create trigger restaurants_create_trial_subscription
  after insert on public.restaurants
  for each row execute function private.create_trial_subscription();

-- Existing restaurants: keep their current state.
insert into public.restaurant_subscriptions (restaurant_id, status, trial_ends_at, current_period_start, current_period_end)
select r.id,
       case r.status when 'trial' then 'trial' when 'active' then 'active' else 'suspended' end,
       coalesce(r.trial_ends_at, r.created_at + interval '14 days'),
       case when r.status = 'active' then now() end,
       case when r.status = 'active' then now() + interval '1 month' end
from public.restaurants r
on conflict (restaurant_id) do nothing;

-- Record a manual payment: +1 month from the current period end (or from now
-- if the restaurant was suspended / long overdue), status → active.
create or replace function public.admin_record_subscription_payment(
  p_restaurant_id uuid,
  p_amount integer,
  p_method text,
  p_reference text,
  p_notes text,
  p_recorded_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.restaurant_subscriptions;
  v_grace integer;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
begin
  select * into s from public.restaurant_subscriptions where restaurant_id = p_restaurant_id for update;
  if not found then
    raise exception 'No subscription for this restaurant' using errcode = 'P0002';
  end if;
  select grace_period_days into v_grace from public.platform_settings where id;
  v_start := coalesce(s.current_period_end, now());
  if s.status in ('trial', 'suspended', 'cancelled') or v_start < now() - make_interval(days => coalesce(v_grace, 5)) then
    v_start := now();
  end if;
  v_end := v_start + interval '1 month';

  insert into public.subscription_payments (restaurant_id, plan_id, amount, method, reference, notes, period_start, period_end, recorded_by)
  values (p_restaurant_id, s.plan_id, p_amount, p_method, nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''), v_start, v_end, p_recorded_by)
  returning id into v_id;

  update public.restaurant_subscriptions
     set status = 'active',
         current_period_start = v_start,
         current_period_end = v_end,
         past_due_since = null,
         suspended_at = null
   where restaurant_id = p_restaurant_id;
  return v_id;
end;
$$;
revoke execute on function public.admin_record_subscription_payment(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_subscription_payment(uuid, integer, text, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Super admin: per-restaurant usage this month (limits + list page)
-- ---------------------------------------------------------------------------
create or replace function public.admin_restaurant_usage(p_month_start timestamptz)
returns table (
  restaurant_id uuid,
  branches bigint,
  orders_this_month bigint,
  bot_conversations_this_month bigint,
  last_order_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         (select count(*) from public.branches b where b.restaurant_id = r.id and b.is_active),
         (select count(*) from public.orders o where o.restaurant_id = r.id and o.created_at >= p_month_start
            and o.status <> 'pending_confirmation'),
         (select count(*) from public.bot_sessions s where s.restaurant_id = r.id and s.created_at >= p_month_start
            and s.conversation_id is not null),
         (select max(o.created_at) from public.orders o where o.restaurant_id = r.id and o.status <> 'pending_confirmation')
  from public.restaurants r;
$$;
revoke execute on function public.admin_restaurant_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_restaurant_usage(timestamptz) to service_role;

-- Owner: this month's usage for their own restaurant (limit warnings).
create or replace function public.restaurant_usage(p_restaurant_id uuid, p_month_start timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.has_role(p_restaurant_id, '{owner,manager}') or private.is_super_admin()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'branches', (select count(*) from public.branches b where b.restaurant_id = p_restaurant_id and b.is_active),
    'orders', (select count(*) from public.orders o where o.restaurant_id = p_restaurant_id
                 and o.created_at >= p_month_start and o.status <> 'pending_confirmation'),
    'bot_conversations', (select count(*) from public.bot_sessions s where s.restaurant_id = p_restaurant_id
                 and s.created_at >= p_month_start and s.conversation_id is not null)
  );
end;
$$;
revoke execute on function public.restaurant_usage(uuid, timestamptz) from public, anon;
grant execute on function public.restaurant_usage(uuid, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Super admin creates a restaurant for a client (owner login made by the app)
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_restaurant(
  p_owner_id uuid,
  p_name text,
  p_slug text,
  p_city text,
  p_phone text,
  p_branch_name text,
  p_plan_id uuid,
  p_trial_days integer,
  p_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text := lower(btrim(p_slug));
  v_restaurant_id uuid;
  v_branch_id uuid;
begin
  if private.is_reserved_slug(v_slug) then
    raise exception 'This link is reserved. Please choose another.' using errcode = 'P0001';
  end if;

  insert into public.restaurants (name, slug, city, phone, created_by)
  values (btrim(p_name), v_slug, nullif(btrim(p_city), ''), nullif(btrim(p_phone), ''), p_created_by)
  returning id into v_restaurant_id;

  insert into public.branches (restaurant_id, name, city, phone, is_open)
  values (v_restaurant_id, btrim(p_branch_name), nullif(btrim(p_city), ''), nullif(btrim(p_phone), ''), false)
  returning id into v_branch_id;

  insert into public.memberships (user_id, restaurant_id, branch_id, role)
  values (p_owner_id, v_restaurant_id, null, 'owner');

  update public.restaurant_subscriptions
     set plan_id = coalesce(p_plan_id, plan_id),
         trial_ends_at = now() + make_interval(days => greatest(coalesce(p_trial_days, 14), 0))
   where restaurant_id = v_restaurant_id;

  insert into public.audit_logs (restaurant_id, user_id, action, entity_type, entity_id, new_data)
  values (v_restaurant_id, p_created_by, 'restaurant.created', 'restaurant', v_restaurant_id::text,
          jsonb_build_object('name', btrim(p_name), 'slug', v_slug, 'first_branch_id', v_branch_id,
                             'owner_id', p_owner_id, 'created_by_super_admin', true));
  return v_restaurant_id;
end;
$$;
revoke execute on function public.admin_create_restaurant(uuid, text, text, text, text, text, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.admin_create_restaurant(uuid, text, text, text, text, text, uuid, integer, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Suspended restaurants: the bot answers each chat ONCE, then stays quiet.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations add column suspended_notice_at timestamptz;

-- ---------------------------------------------------------------------------
-- Rate limits (fixed window counters; keys are HMAC hashes, never raw IPs)
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
create index rate_limits_window_idx on public.rate_limits (window_start);
alter table public.rate_limits enable row level security; -- no policies: server only
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- +1 hit; true while the key is within p_max hits per p_window_seconds.
create or replace function public.rate_limit_hit(p_key text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = rl.count + 1
  returning count into v_count;
  return v_count <= p_max;
end;
$$;
revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Scheduled jobs: last run per job (shown on /admin/health)
-- ---------------------------------------------------------------------------
create table public.job_runs (
  job text primary key check (char_length(job) <= 60),
  last_run_at timestamptz not null default now(),
  last_ok boolean not null default true,
  last_result jsonb not null default '{}'::jsonb,
  last_error text check (char_length(last_error) <= 2000),
  run_count bigint not null default 0
);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;
grant all on public.job_runs to service_role;
grant select on public.job_runs to authenticated;
create policy "job_runs: super admin reads" on public.job_runs for select to authenticated
  using ((select private.is_super_admin()));

create or replace function private.record_job(p_job text, p_ok boolean, p_result jsonb, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.job_runs as j (job, last_run_at, last_ok, last_result, last_error, run_count)
  values (p_job, now(), p_ok, coalesce(p_result, '{}'::jsonb), left(p_error, 2000), 1)
  on conflict (job) do update
    set last_run_at = now(), last_ok = excluded.last_ok, last_result = excluded.last_result,
        last_error = excluded.last_error, run_count = j.run_count + 1;
$$;

-- Job 1: auto-resolve quiet staff chats in every restaurant (Phase 10 rule).
create or replace function private.job_inbox_auto_resolve()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  r record;
begin
  for r in
    select distinct c.restaurant_id from public.whatsapp_conversations c
    where c.status = 'open' and not c.bot_enabled
  loop
    v_total := v_total + public.inbox_auto_resolve(r.restaurant_id);
  end loop;
  perform private.record_job('inbox_auto_resolve', true, jsonb_build_object('resolved', v_total), null);
exception when others then
  perform private.record_job('inbox_auto_resolve', false, '{}'::jsonb, sqlerrm);
end;
$$;

-- Job 2: bot sessions idle for 2 hours → abandoned (same rule as runBotTurn).
create or replace function private.job_abandon_bot_sessions()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.bot_sessions
     set status = 'abandoned'
   where status in ('active', 'awaiting_confirmation')
     and last_activity_at < now() - interval '2 hours';
  get diagnostics v_n = row_count;
  perform private.record_job('abandon_bot_sessions', true, jsonb_build_object('abandoned', v_n), null);
exception when others then
  perform private.record_job('abandon_bot_sessions', false, '{}'::jsonb, sqlerrm);
end;
$$;

-- Job 3: cart drafts. Forget the IP hash after 2 days; delete never-used
-- expired drafts after 90 days (used ones stay: they link to orders/stats).
-- Also drops old rate-limit counters.
create or replace function private.job_cleanup_cart_drafts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
  v_scrubbed integer;
begin
  update public.cart_drafts set created_ip_hash = null
   where created_ip_hash is not null and created_at < now() - interval '2 days';
  get diagnostics v_scrubbed = row_count;
  delete from public.cart_drafts where used_at is null and expires_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  delete from public.rate_limits where window_start < now() - interval '2 days';
  perform private.record_job('cleanup_cart_drafts', true, jsonb_build_object('deleted', v_deleted, 'scrubbed', v_scrubbed), null);
exception when others then
  perform private.record_job('cleanup_cart_drafts', false, '{}'::jsonb, sqlerrm);
end;
$$;

-- Job 4: trials/periods ended → past_due; past_due longer than the grace period → suspended.
create or replace function private.job_subscription_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace integer;
  v_trial integer;
  v_period integer;
  v_suspended integer;
begin
  select grace_period_days into v_grace from public.platform_settings where id;
  update public.restaurant_subscriptions
     set status = 'past_due', past_due_since = trial_ends_at
   where status = 'trial' and trial_ends_at is not null and trial_ends_at < now();
  get diagnostics v_trial = row_count;
  update public.restaurant_subscriptions
     set status = 'past_due', past_due_since = current_period_end
   where status = 'active' and current_period_end is not null and current_period_end < now();
  get diagnostics v_period = row_count;
  update public.restaurant_subscriptions
     set status = 'suspended', suspended_at = now()
   where status = 'past_due' and coalesce(past_due_since, now()) < now() - make_interval(days => coalesce(v_grace, 5));
  get diagnostics v_suspended = row_count;
  perform private.record_job('subscription_sweep', true,
    jsonb_build_object('trial_ended', v_trial, 'period_ended', v_period, 'suspended', v_suspended), null);
exception when others then
  perform private.record_job('subscription_sweep', false, '{}'::jsonb, sqlerrm);
end;
$$;

-- All jobs at once: the /api/cron/maintenance backup (Vercel Cron) calls this.
create or replace function public.run_maintenance_jobs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.job_inbox_auto_resolve();
  perform private.job_abandon_bot_sessions();
  perform private.job_cleanup_cart_drafts();
  perform private.job_subscription_sweep();
  return (select jsonb_object_agg(job, jsonb_build_object('ok', last_ok, 'at', last_run_at, 'result', last_result))
          from public.job_runs);
end;
$$;
revoke execute on function public.run_maintenance_jobs() from public, anon, authenticated;
grant execute on function public.run_maintenance_jobs() to service_role;

revoke execute on function private.record_job(text, boolean, jsonb, text) from public, anon, authenticated;
revoke execute on function private.job_inbox_auto_resolve() from public, anon, authenticated;
revoke execute on function private.job_abandon_bot_sessions() from public, anon, authenticated;
revoke execute on function private.job_cleanup_cart_drafts() from public, anon, authenticated;
revoke execute on function private.job_subscription_sweep() from public, anon, authenticated;
revoke execute on function private.sync_restaurant_status() from public, anon, authenticated;
revoke execute on function private.create_trial_subscription() from public, anon, authenticated;

-- pg_cron schedules (UTC). Re-running this file updates them by name.
create extension if not exists pg_cron;
select cron.schedule('orderly-inbox-auto-resolve', '*/15 * * * *', $$select private.job_inbox_auto_resolve()$$);
select cron.schedule('orderly-abandon-bot-sessions', '*/30 * * * *', $$select private.job_abandon_bot_sessions()$$);
select cron.schedule('orderly-cleanup-cart-drafts', '30 21 * * *', $$select private.job_cleanup_cart_drafts()$$); -- 2:30 AM PKT
select cron.schedule('orderly-subscription-sweep', '5 * * * *', $$select private.job_subscription_sweep()$$);

-- ---------------------------------------------------------------------------
-- Customer data deletion (privacy). Server only; the app checks permission,
-- deletes the media files from Storage and writes audit_logs.
-- Orders stay (totals for reports) but lose every personal detail.
-- ---------------------------------------------------------------------------
create or replace function public.delete_customer_data(p_restaurant_id uuid, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_wa text;
  v_conversations uuid[];
  v_media text[];
  v_orders integer;
begin
  select phone into v_phone from public.customers where id = p_customer_id and restaurant_id = p_restaurant_id;
  if v_phone is null then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;
  v_wa := ltrim(v_phone, '+');

  select coalesce(array_agg(c.id), '{}') into v_conversations
  from public.whatsapp_conversations c
  where c.restaurant_id = p_restaurant_id and (c.customer_id = p_customer_id or c.wa_id = v_wa);

  select coalesce(array_agg(m.media_url) filter (where m.media_url is not null), '{}') into v_media
  from public.whatsapp_messages m where m.conversation_id = any (v_conversations);

  -- Orders: keep money, drop identity.
  update public.orders
     set customer_id = null, customer_name = 'Deleted customer', customer_phone = null,
         address_text = null, area = null, landmark = null, latitude = null, longitude = null,
         notes = null, table_number = null
   where restaurant_id = p_restaurant_id
     and (customer_id = p_customer_id or customer_phone = v_phone);
  get diagnostics v_orders = row_count;

  -- Bot sessions + AI logs: drop chat text and addresses.
  update public.ai_logs set input_text = null, reply_text = null
   where restaurant_id = p_restaurant_id
     and session_id in (select s.id from public.bot_sessions s where s.restaurant_id = p_restaurant_id
                          and (s.customer_id = p_customer_id or s.conversation_id = any (v_conversations)));
  update public.bot_sessions
     set customer_id = null, transcript = '[]'::jsonb, delivery_address_text = null, delivery_area = null,
         delivery_landmark = null, latitude = null, longitude = null, delivery_zone = null
   where restaurant_id = p_restaurant_id
     and (customer_id = p_customer_id or conversation_id = any (v_conversations));

  -- Chats (messages, transcripts, notes cascade with the conversation).
  delete from public.whatsapp_conversations where id = any (v_conversations);
  -- Raw webhook logs that contain this number.
  delete from public.whatsapp_webhook_events e
   where e.raw::text like '%' || v_wa || '%'
     and exists (select 1 from public.whatsapp_accounts a
                  where a.restaurant_id = p_restaurant_id and e.raw::text like '%' || a.phone_number_id || '%');

  delete from public.customer_addresses where customer_id = p_customer_id;
  delete from public.customers where id = p_customer_id;

  return jsonb_build_object('orders_anonymized', v_orders, 'conversations_deleted', cardinality(v_conversations), 'media_paths', to_jsonb(v_media));
end;
$$;
revoke execute on function public.delete_customer_data(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_customer_data(uuid, uuid) to service_role;
