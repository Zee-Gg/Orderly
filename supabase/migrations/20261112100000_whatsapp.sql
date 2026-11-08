-- Phase 6A: WhatsApp connection + receiving messages.
-- Webhooks write with the service role (admin client) and always scope by the
-- restaurant resolved from phone_number_id. Browsers only READ, through RLS.

create type public.wa_direction as enum ('inbound', 'outbound');
create type public.wa_message_type as enum
  ('text', 'image', 'audio', 'document', 'location', 'interactive', 'button', 'unknown');
create type public.wa_message_status as enum
  ('received', 'sent', 'delivered', 'read', 'failed', 'skipped');
create type public.wa_conversation_status as enum ('open', 'resolved');

-- ---------------------------------------------------------------------------
-- Accounts: one WhatsApp number per restaurant (for now).
-- ---------------------------------------------------------------------------
create table public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  -- Default branch for incoming orders.
  branch_id uuid,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,30}$'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,30}$'),
  display_phone_number text not null check (char_length(display_phone_number) between 5 and 30),
  -- AES-256-GCM (TOKEN_ENCRYPTION_KEY). Never granted to browsers.
  access_token_encrypted text not null,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete set null (branch_id)
);
create index whatsapp_accounts_branch_idx on public.whatsapp_accounts (branch_id);
create trigger whatsapp_accounts_set_updated_at before update on public.whatsapp_accounts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Conversations: one per customer WhatsApp number per restaurant.
-- ---------------------------------------------------------------------------
create table public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id uuid,
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  -- 24-hour customer service window starts here.
  last_customer_message_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text check (char_length(last_message_preview) <= 200),
  -- Temporary greeting (until the AI bot) is sent at most once per 6 hours.
  last_auto_reply_at timestamptz,
  status public.wa_conversation_status not null default 'open',
  bot_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, wa_id),
  unique (id, restaurant_id),
  foreign key (customer_id, restaurant_id) references public.customers (id, restaurant_id) on delete set null (customer_id)
);
create index whatsapp_conversations_recent_idx
  on public.whatsapp_conversations (restaurant_id, last_message_at desc nulls last);
create index whatsapp_conversations_customer_idx on public.whatsapp_conversations (customer_id);
create trigger whatsapp_conversations_set_updated_at before update on public.whatsapp_conversations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  conversation_id uuid not null,
  -- Meta's id. Unique = webhook retries can't save a message twice.
  -- Null for outbound messages that were never accepted (skipped/failed).
  wa_message_id text unique check (char_length(wa_message_id) <= 200),
  direction public.wa_direction not null,
  type public.wa_message_type not null default 'text',
  body text check (char_length(body) <= 4096),
  media_id text check (char_length(media_id) <= 200),
  media_url text check (char_length(media_url) <= 500),
  raw jsonb,
  status public.wa_message_status not null,
  error text check (char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (conversation_id, restaurant_id)
    references public.whatsapp_conversations (id, restaurant_id) on delete cascade
);
create index whatsapp_messages_conversation_idx on public.whatsapp_messages (conversation_id, created_at);
create index whatsapp_messages_restaurant_idx on public.whatsapp_messages (restaurant_id, created_at desc);
create trigger whatsapp_messages_set_updated_at before update on public.whatsapp_messages
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Raw webhook log (platform level: the restaurant is unknown until parsed).
-- ---------------------------------------------------------------------------
create table public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  raw jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text check (char_length(error) <= 2000)
);
create index whatsapp_webhook_events_received_idx on public.whatsapp_webhook_events (received_at desc);

-- ---------------------------------------------------------------------------
-- Grants: browsers read only. The token column is never granted.
-- ---------------------------------------------------------------------------
revoke all on public.whatsapp_accounts, public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_webhook_events from anon, authenticated;
grant all on public.whatsapp_accounts, public.whatsapp_conversations, public.whatsapp_messages,
  public.whatsapp_webhook_events to service_role;

grant select (id, restaurant_id, branch_id, phone_number_id, waba_id, display_phone_number,
  is_active, connected_at, created_at, updated_at) on public.whatsapp_accounts to authenticated;
grant select on public.whatsapp_conversations, public.whatsapp_messages, public.whatsapp_webhook_events
  to authenticated;

alter table public.whatsapp_accounts enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;

create policy "whatsapp_accounts: management reads status" on public.whatsapp_accounts
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}') or (select private.is_super_admin()));

create policy "whatsapp_conversations: front of house read" on public.whatsapp_conversations
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));

create policy "whatsapp_messages: front of house read" on public.whatsapp_messages
  for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));

create policy "whatsapp_webhook_events: super admin read" on public.whatsapp_webhook_events
  for select to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- RPC: save one inbound message atomically (customer + conversation + message).
-- A per-message advisory lock makes concurrent Meta retries safe.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_record_inbound(
  p_restaurant_id uuid,
  p_wa_id text,
  p_phone text,
  p_profile_name text,
  p_wa_message_id text,
  p_type public.wa_message_type,
  p_body text,
  p_media_id text,
  p_raw jsonb,
  p_sent_at timestamptz
)
returns table (
  conversation_id uuid,
  customer_id uuid,
  message_id uuid,
  duplicate boolean,
  bot_enabled boolean
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_customer uuid;
  v_conversation uuid;
  v_bot boolean;
  v_message uuid;
  v_preview text := left(coalesce(nullif(p_body, ''), '[' || p_type::text || ']'), 200);
  v_name text := nullif(left(btrim(coalesce(p_profile_name, '')), 120), '');
begin
  perform pg_advisory_xact_lock(hashtextextended('wa_msg:' || p_wa_message_id, 0));

  select m.conversation_id, m.id into v_conversation, v_message
  from public.whatsapp_messages m where m.wa_message_id = p_wa_message_id;
  if found then
    select c.customer_id, c.bot_enabled into v_customer, v_bot
    from public.whatsapp_conversations c where c.id = v_conversation;
    return query select v_conversation, v_customer, v_message, true, coalesce(v_bot, false);
    return;
  end if;

  if p_phone is not null then
    insert into public.customers as c (restaurant_id, phone, name, whatsapp_id)
    values (p_restaurant_id, p_phone, v_name, p_wa_id)
    on conflict (restaurant_id, phone) do update
      set name = coalesce(c.name, excluded.name),
          whatsapp_id = coalesce(c.whatsapp_id, excluded.whatsapp_id)
    returning c.id into v_customer;
  end if;

  insert into public.whatsapp_conversations as c
    (restaurant_id, customer_id, wa_id, last_customer_message_at, last_message_at, last_message_preview)
  values (p_restaurant_id, v_customer, p_wa_id, p_sent_at, p_sent_at, v_preview)
  on conflict (restaurant_id, wa_id) do update
    set customer_id = coalesce(c.customer_id, excluded.customer_id),
        last_customer_message_at = greatest(c.last_customer_message_at, excluded.last_customer_message_at),
        last_message_at = greatest(c.last_message_at, excluded.last_message_at),
        last_message_preview = case
          when c.last_message_at is null or excluded.last_message_at >= c.last_message_at
          then excluded.last_message_preview else c.last_message_preview end,
        status = 'open'
  returning c.id, c.bot_enabled into v_conversation, v_bot;

  insert into public.whatsapp_messages
    (restaurant_id, conversation_id, wa_message_id, direction, type, body, media_id, raw, status, created_at)
  values
    (p_restaurant_id, v_conversation, p_wa_message_id, 'inbound', p_type, left(p_body, 4096),
     p_media_id, p_raw, 'received', p_sent_at)
  returning id into v_message;

  return query select v_conversation, v_customer, v_message, false, v_bot;
end;
$$;

-- RPC: claim the right to send the temporary greeting (once per cooldown).
-- Returns true for exactly one caller, even with concurrent messages.
create or replace function public.whatsapp_claim_auto_reply(
  p_conversation_id uuid,
  p_cooldown interval default interval '6 hours'
)
returns boolean
language sql security definer set search_path = ''
as $$
  with claimed as (
    update public.whatsapp_conversations c
    set last_auto_reply_at = now()
    where c.id = p_conversation_id
      and c.bot_enabled
      and (c.last_auto_reply_at is null or c.last_auto_reply_at < now() - p_cooldown)
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.whatsapp_record_inbound(uuid, text, text, text, text, public.wa_message_type, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.whatsapp_claim_auto_reply(uuid, interval) from public, anon, authenticated;
grant execute on function public.whatsapp_record_inbound(uuid, text, text, text, text, public.wa_message_type, text, text, jsonb, timestamptz)
  to service_role;
grant execute on function public.whatsapp_claim_auto_reply(uuid, interval) to service_role;

-- Realtime for the inbox (postgres_changes respects RLS).
alter publication supabase_realtime add table public.whatsapp_conversations, public.whatsapp_messages;
