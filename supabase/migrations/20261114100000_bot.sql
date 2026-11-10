-- Phase 7A-1: AI order bot engine (sessions, AI logs) + simple delivery settings.
-- Only the server (service role) writes bot data. Prices always come from the
-- pricing engine; the bot never stores or invents prices of its own.

-- ---------------------------------------------------------------------------
-- Settings on existing tables
-- ---------------------------------------------------------------------------

alter table public.customers
  add column preferred_language text check (preferred_language in ('roman_urdu', 'english', 'urdu'));

-- Temporary simple delivery setup (proper delivery zones come in Phase 9).
alter table public.branches
  add column default_delivery_fee integer not null default 0 check (default_delivery_fee between 0 and 10000000),
  add column minimum_order integer not null default 0 check (minimum_order between 0 and 100000000);
grant update (default_delivery_fee, minimum_order) on public.branches to authenticated;

alter table public.restaurants
  add column bot_enabled boolean not null default true,
  add column high_value_cod_threshold integer not null default 500000 check (high_value_cod_threshold >= 0);
grant update (bot_enabled, high_value_cod_threshold) on public.restaurants to authenticated;

-- "New customer, high value — call to confirm." Set by the server only.
alter table public.orders
  add column risk_flag text check (char_length(risk_flag) <= 200);

-- ---------------------------------------------------------------------------
-- bot_sessions: one ordering conversation with the bot
-- ---------------------------------------------------------------------------

create table public.bot_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid not null,
  conversation_id uuid,           -- null for playground sessions
  customer_id uuid,
  status text not null default 'active'
    check (status in ('active', 'awaiting_confirmation', 'completed', 'abandoned', 'handed_off')),
  stage text not null default 'collecting_items'
    check (stage in ('collecting_items', 'choosing_order_type', 'collecting_address', 'choosing_payment',
                     'collecting_name', 'awaiting_confirmation', 'done')),
  -- Lines validated by the pricing engine, each with a line_id (see src/lib/bot/cart.ts).
  cart jsonb not null default '[]'::jsonb check (jsonb_typeof(cart) = 'array'),
  order_type text check (order_type in ('delivery', 'pickup')),
  delivery_address_text text check (char_length(delivery_address_text) <= 500),
  delivery_area text check (char_length(delivery_area) <= 80),
  delivery_landmark text check (char_length(delivery_landmark) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  payment_method text check (payment_method in ('cod', 'card_on_delivery')),
  language text not null default 'roman_urdu' check (language in ('roman_urdu', 'english', 'urdu')),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  summary_hash text check (char_length(summary_hash) <= 128),
  order_id uuid,
  handoff_reason text check (char_length(handoff_reason) <= 300),
  -- Recent customer/bot messages (text only), for sessions without a WhatsApp chat.
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id),
  foreign key (conversation_id, restaurant_id) references public.whatsapp_conversations (id, restaurant_id)
    on delete set null (conversation_id),
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id)
    on delete set null (customer_id),
  foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id)
    on delete set null (order_id)
);

create index bot_sessions_restaurant_idx on public.bot_sessions (restaurant_id, last_activity_at desc);
create index bot_sessions_branch_idx on public.bot_sessions (branch_id);
create index bot_sessions_customer_idx on public.bot_sessions (customer_id) where customer_id is not null;
create index bot_sessions_order_idx on public.bot_sessions (order_id) where order_id is not null;
-- At most one open session per WhatsApp chat.
create unique index bot_sessions_one_open_per_conversation on public.bot_sessions (conversation_id)
  where conversation_id is not null and status in ('active', 'awaiting_confirmation');

create trigger bot_sessions_set_updated_at before update on public.bot_sessions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- ai_logs: every bot turn (tokens, cost, latency, errors)
-- ---------------------------------------------------------------------------

create table public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id uuid references public.bot_sessions (id) on delete set null,
  input_text text check (char_length(input_text) <= 4000),
  tool_calls jsonb not null default '[]'::jsonb,
  reply_text text check (char_length(reply_text) <= 4000),
  provider text check (char_length(provider) <= 40),
  model text check (char_length(model) <= 100),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,   -- USD, from the rates in src/lib/bot/config.ts
  latency_ms integer not null default 0,
  -- rate_limit is logged separately so free-tier limits are easy to count.
  error_type text check (error_type in ('rate_limit', 'timeout', 'error')),
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now()
);

create index ai_logs_restaurant_idx on public.ai_logs (restaurant_id, created_at desc);
create index ai_logs_session_idx on public.ai_logs (session_id) where session_id is not null;
create index ai_logs_errors_idx on public.ai_logs (error_type, created_at desc) where error_type is not null;

-- ---------------------------------------------------------------------------
-- Security: read-only for people, written only by the server
-- ---------------------------------------------------------------------------

revoke all on public.bot_sessions, public.ai_logs from anon, authenticated;
grant all on public.bot_sessions, public.ai_logs to service_role;
grant select on public.bot_sessions, public.ai_logs to authenticated;

alter table public.bot_sessions enable row level security;
alter table public.ai_logs enable row level security;

create policy "bot_sessions: front of house read" on public.bot_sessions
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));

create policy "ai_logs: owner and super admin read" on public.ai_logs
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner}') or (select private.is_super_admin()));
