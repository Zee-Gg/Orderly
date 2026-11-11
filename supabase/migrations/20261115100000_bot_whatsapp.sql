-- Phase 7A-2: the AI bot answers WhatsApp messages.
-- Batching, one turn at a time per chat, flood limit, handoff to staff,
-- corrections from staff edits, AI budget per restaurant.

-- ---------------------------------------------------------------------------
-- Messages: which inbound messages the bot has already handled (batching)
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages add column bot_handled_at timestamptz;
create index whatsapp_messages_bot_pending_idx on public.whatsapp_messages (conversation_id, created_at)
  where direction = 'inbound' and bot_handled_at is null;

-- ---------------------------------------------------------------------------
-- Conversations: lock, flood mute, handoff
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column bot_lock_until timestamptz,   -- one bot turn at a time (expires so it can't get stuck)
  add column bot_muted_until timestamptz,  -- flood limit (>10 messages a minute)
  add column handoff_reason text check (char_length(handoff_reason) <= 300),
  add column handed_off_at timestamptz;    -- bot_enabled = false + this = "Needs staff"

/** True for exactly one caller until the lock expires or is released. */
create or replace function public.bot_claim_conversation(p_conversation_id uuid, p_ttl_seconds integer default 60)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.whatsapp_conversations
     set bot_lock_until = now() + make_interval(secs => greatest(1, least(p_ttl_seconds, 300)))
   where id = p_conversation_id
     and (bot_lock_until is null or bot_lock_until < now())
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.bot_claim_conversation(uuid, integer) from public, anon, authenticated;
grant execute on function public.bot_claim_conversation(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- AI cost: budget per restaurant (super admin sets it; owners can't)
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column ai_monthly_budget_usd numeric(10, 2) check (ai_monthly_budget_usd >= 0); -- null = no limit

alter table public.ai_logs drop constraint ai_logs_error_type_check;
alter table public.ai_logs add constraint ai_logs_error_type_check
  check (error_type in ('rate_limit', 'timeout', 'error', 'flood', 'budget'));

/**
 * AI usage since a moment, per restaurant (or one restaurant).
 * Service role only (/admin/ai-usage, budget checks).
 */
create or replace function public.ai_usage_summary(p_since timestamptz, p_restaurant_id uuid default null)
returns table (
  restaurant_id uuid,
  conversations bigint,
  bot_orders bigint,
  input_tokens bigint,
  output_tokens bigint,
  cost numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with logs as (
    select l.restaurant_id,
           count(distinct l.session_id) as conversations,
           coalesce(sum(l.input_tokens), 0)::bigint as input_tokens,
           coalesce(sum(l.output_tokens), 0)::bigint as output_tokens,
           coalesce(sum(l.estimated_cost), 0) as cost
      from public.ai_logs l
     where l.created_at >= p_since
       and (p_restaurant_id is null or l.restaurant_id = p_restaurant_id)
     group by l.restaurant_id
  ), orders as (
    select s.restaurant_id, count(*) as bot_orders
      from public.bot_sessions s
     where s.order_id is not null
       and s.updated_at >= p_since
       and (p_restaurant_id is null or s.restaurant_id = p_restaurant_id)
     group by s.restaurant_id
  )
  select coalesce(l.restaurant_id, o.restaurant_id),
         coalesce(l.conversations, 0),
         coalesce(o.bot_orders, 0),
         coalesce(l.input_tokens, 0),
         coalesce(l.output_tokens, 0),
         coalesce(l.cost, 0)
    from logs l
    full join orders o on o.restaurant_id = l.restaurant_id;
$$;

revoke all on function public.ai_usage_summary(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_summary(timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- ai_corrections: staff fixed a bot order before accepting it
-- (exported as new eval cases: scripts/export-ai-corrections.ts)
-- ---------------------------------------------------------------------------
create table public.ai_corrections (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  order_id uuid not null,
  session_id uuid references public.bot_sessions (id) on delete set null,
  before jsonb not null,
  after jsonb not null,
  edited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id) on delete cascade
);

create index ai_corrections_restaurant_idx on public.ai_corrections (restaurant_id, created_at desc);
create index ai_corrections_order_idx on public.ai_corrections (order_id);
create index ai_corrections_session_idx on public.ai_corrections (session_id) where session_id is not null;
create index ai_corrections_edited_by_idx on public.ai_corrections (edited_by) where edited_by is not null;

revoke all on public.ai_corrections from anon, authenticated;
grant all on public.ai_corrections to service_role;
grant select on public.ai_corrections to authenticated;

alter table public.ai_corrections enable row level security;

create policy "ai_corrections: management and super admin read" on public.ai_corrections
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') or (select private.is_super_admin()));
