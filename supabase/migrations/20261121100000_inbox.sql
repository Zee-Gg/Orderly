-- Phase 10: full WhatsApp inbox — staff replies, take over / hand back,
-- needs-staff queue, unread counts, assignment, tags, internal notes, quick
-- replies, auto-resolve. Front of house only (owner/manager/staff): kitchen
-- and riders have no access. Conversations/messages are written by the server.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations
  add column assigned_to uuid references auth.users (id) on delete set null,
  add column needs_staff boolean not null default false,
  add column needs_staff_since timestamptz,
  add column unread_count integer not null default 0 check (unread_count >= 0),
  add column resolved_at timestamptz,
  add column tags text[] not null default '{}' check (cardinality(tags) <= 10);
create index whatsapp_conversations_assigned_idx on public.whatsapp_conversations (assigned_to) where assigned_to is not null;
create index whatsapp_conversations_needs_staff_idx on public.whatsapp_conversations (restaurant_id, needs_staff_since) where needs_staff;

-- Chats the bot already handed off (7A-2) are "Needs staff".
update public.whatsapp_conversations
   set needs_staff = true, needs_staff_since = handed_off_at
 where not bot_enabled and handed_off_at is not null;

-- ---------------------------------------------------------------------------
-- Messages: who sent it
-- ---------------------------------------------------------------------------
alter table public.whatsapp_messages
  add column sender_type text not null default 'customer' check (sender_type in ('customer', 'bot', 'staff', 'system')),
  add column sent_by_user_id uuid references auth.users (id) on delete set null;
create index whatsapp_messages_sent_by_idx on public.whatsapp_messages (sent_by_user_id) where sent_by_user_id is not null;
update public.whatsapp_messages
   set sender_type = case when direction = 'inbound' then 'customer' when order_id is not null then 'system' else 'bot' end;

-- ---------------------------------------------------------------------------
-- Restaurant settings
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column auto_resolve_hours integer not null default 6 check (auto_resolve_hours between 1 and 72),
  add column needs_staff_alert_minutes integer not null default 3 check (needs_staff_alert_minutes between 1 and 60);
grant update (auto_resolve_hours, needs_staff_alert_minutes) on public.restaurants to authenticated;

-- ---------------------------------------------------------------------------
-- Internal notes on a conversation (never sent to the customer)
-- ---------------------------------------------------------------------------
create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  conversation_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, restaurant_id) references public.whatsapp_conversations (id, restaurant_id) on delete cascade
);
create index conversation_notes_conversation_idx on public.conversation_notes (conversation_id, created_at);
create index conversation_notes_restaurant_idx on public.conversation_notes (restaurant_id);
create index conversation_notes_user_idx on public.conversation_notes (user_id);

alter table public.conversation_notes enable row level security;
revoke all on public.conversation_notes from anon, authenticated;
grant all on public.conversation_notes to service_role;
grant select on public.conversation_notes to authenticated;
grant insert (restaurant_id, conversation_id, user_id, body) on public.conversation_notes to authenticated;
create policy "conversation_notes: front of house read" on public.conversation_notes for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));
create policy "conversation_notes: front of house add own" on public.conversation_notes for insert to authenticated
  with check (private.has_role(restaurant_id, '{owner,manager,staff}') and user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Quick replies ("/time", "/sorry", …)
-- ---------------------------------------------------------------------------
create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  shortcut text not null check (shortcut ~ '^/[a-z0-9_-]{1,30}$'),
  text text not null check (char_length(btrim(text)) between 1 and 1000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, shortcut)
);
create index quick_replies_restaurant_idx on public.quick_replies (restaurant_id, sort_order);
create trigger quick_replies_set_updated_at before update on public.quick_replies
  for each row execute function private.set_updated_at();

alter table public.quick_replies enable row level security;
revoke all on public.quick_replies from anon, authenticated;
grant all on public.quick_replies to service_role;
grant select, delete on public.quick_replies to authenticated;
grant insert (restaurant_id, shortcut, text, sort_order) on public.quick_replies to authenticated;
grant update (shortcut, text, sort_order) on public.quick_replies to authenticated;
create policy "quick_replies: front of house read" on public.quick_replies for select to authenticated
  using (private.has_role(restaurant_id, '{owner,manager,staff}') or (select private.is_super_admin()));
create policy "quick_replies: owner/manager insert" on public.quick_replies for insert to authenticated
  with check (private.has_role(restaurant_id, '{owner,manager}'));
create policy "quick_replies: owner/manager update" on public.quick_replies for update to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}'))
  with check (private.has_role(restaurant_id, '{owner,manager}'));
create policy "quick_replies: owner/manager delete" on public.quick_replies for delete to authenticated
  using (private.has_role(restaurant_id, '{owner,manager}'));

-- Six useful defaults (Roman Urdu + English) for every restaurant, old and new.
create or replace function private.seed_quick_replies(p_restaurant_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.quick_replies (restaurant_id, shortcut, text, sort_order)
  values
    (p_restaurant_id, '/time', 'Aap ka order taqreeban 30–40 minute mein pohanch jayega. Your order will arrive in about 30–40 minutes.', 0),
    (p_restaurant_id, '/sorry', 'Der ke liye maazrat 🙏 Hum jaldi kar rahe hain. Sorry for the delay — we are on it.', 1),
    (p_restaurant_id, '/menu', 'Yeh raha hamara menu 📋 Here is our menu.', 2),
    (p_restaurant_id, '/location', 'Hamari location yeh hai 📍 Here is our location.', 3),
    (p_restaurant_id, '/thanks', 'Shukriya! Phir zaroor order karein 😊 Thank you, hope to serve you again!', 4),
    (p_restaurant_id, '/call', 'Hum aap ko thori dair mein call karte hain 📞 We will call you shortly.', 5)
  on conflict (restaurant_id, shortcut) do nothing;
$$;

create or replace function private.seed_quick_replies_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.seed_quick_replies(new.id);
  return new;
end;
$$;
create trigger restaurants_seed_quick_replies after insert on public.restaurants
  for each row execute function private.seed_quick_replies_trigger();
select private.seed_quick_replies(id) from public.restaurants;

-- ---------------------------------------------------------------------------
-- Inbound: unread +1, reopen resolved chats (bot handles them), and
-- auto-resolve a forgotten takeover before the bot decides whether to reply.
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
  v_hours integer;
  c public.whatsapp_conversations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('wa_msg:' || p_wa_message_id, 0));

  select m.conversation_id, m.id into v_conversation, v_message
  from public.whatsapp_messages m where m.wa_message_id = p_wa_message_id;
  if found then
    select wc.customer_id, wc.bot_enabled into v_customer, v_bot
    from public.whatsapp_conversations wc where wc.id = v_conversation;
    return query select v_conversation, v_customer, v_message, true, coalesce(v_bot, false);
    return;
  end if;

  if p_phone is not null then
    insert into public.customers as cu (restaurant_id, phone, name, whatsapp_id)
    values (p_restaurant_id, p_phone, v_name, p_wa_id)
    on conflict (restaurant_id, phone) do update
      set name = coalesce(cu.name, excluded.name),
          whatsapp_id = coalesce(cu.whatsapp_id, excluded.whatsapp_id)
    returning cu.id into v_customer;
  end if;

  select auto_resolve_hours into v_hours from public.restaurants where id = p_restaurant_id;
  select * into c from public.whatsapp_conversations where restaurant_id = p_restaurant_id and wa_id = p_wa_id for update;

  if found then
    -- A staff-handled chat nobody touched for auto_resolve_hours: resolve it so
    -- the bot answers this new message (a forgotten takeover never strands a customer).
    if c.status = 'open' and not c.bot_enabled and c.last_message_at is not null
       and c.last_message_at < p_sent_at - make_interval(hours => coalesce(v_hours, 6)) then
      update public.whatsapp_conversations
         set status = 'resolved', resolved_at = now(), needs_staff = false, needs_staff_since = null,
             bot_enabled = true, handoff_reason = null, handed_off_at = null
       where id = c.id;
      insert into public.whatsapp_messages (restaurant_id, conversation_id, direction, type, body, status, sender_type)
      values (p_restaurant_id, c.id, 'outbound', 'text',
              format('Auto-resolved after %s hours without messages — bot is back on', coalesce(v_hours, 6)), 'sent', 'system');
      c.status := 'resolved';
    end if;
    -- A resolved chat reopens with a new message, and the bot handles it.
    update public.whatsapp_conversations wc set
      customer_id = coalesce(wc.customer_id, v_customer),
      last_customer_message_at = greatest(wc.last_customer_message_at, p_sent_at),
      last_message_at = greatest(wc.last_message_at, p_sent_at),
      last_message_preview = case when wc.last_message_at is null or p_sent_at >= wc.last_message_at then v_preview else wc.last_message_preview end,
      unread_count = wc.unread_count + 1,
      status = 'open',
      resolved_at = null,
      bot_enabled = case when c.status = 'resolved' then true else wc.bot_enabled end,
      needs_staff = case when c.status = 'resolved' then false else wc.needs_staff end
    where wc.id = c.id
    returning wc.id, wc.bot_enabled into v_conversation, v_bot;
  else
    insert into public.whatsapp_conversations
      (restaurant_id, customer_id, wa_id, last_customer_message_at, last_message_at, last_message_preview, unread_count)
    values (p_restaurant_id, v_customer, p_wa_id, p_sent_at, p_sent_at, v_preview, 1)
    returning id, whatsapp_conversations.bot_enabled into v_conversation, v_bot;
  end if;

  insert into public.whatsapp_messages
    (restaurant_id, conversation_id, wa_message_id, direction, type, body, media_id, raw, status, created_at, sender_type)
  values
    (p_restaurant_id, v_conversation, p_wa_message_id, 'inbound', p_type, left(p_body, 4096),
     p_media_id, p_raw, 'received', p_sent_at, 'customer')
  returning id into v_message;

  return query select v_conversation, v_customer, v_message, false, v_bot;
end;
$$;
revoke execute on function public.whatsapp_record_inbound(uuid, text, text, text, text, public.wa_message_type, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.whatsapp_record_inbound(uuid, text, text, text, text, public.wa_message_type, text, text, jsonb, timestamptz)
  to service_role;

-- Sweep: staff-handled chats quiet for auto_resolve_hours → resolved, bot on.
create or replace function public.inbox_auto_resolve(p_restaurant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hours integer;
  v_ids uuid[];
begin
  select auto_resolve_hours into v_hours from public.restaurants where id = p_restaurant_id;
  with gone as (
    update public.whatsapp_conversations
       set status = 'resolved', resolved_at = now(), needs_staff = false, needs_staff_since = null,
           bot_enabled = true, handoff_reason = null, handed_off_at = null
     where restaurant_id = p_restaurant_id and status = 'open' and not bot_enabled
       and last_message_at < now() - make_interval(hours => coalesce(v_hours, 6))
    returning id
  )
  select array_agg(id) into v_ids from gone;
  if v_ids is not null then
    insert into public.whatsapp_messages (restaurant_id, conversation_id, direction, type, body, status, sender_type)
    select p_restaurant_id, unnest(v_ids), 'outbound', 'text',
           format('Auto-resolved after %s hours without messages — bot is back on', coalesce(v_hours, 6)), 'sent', 'system';
  end if;
  return coalesce(cardinality(v_ids), 0);
end;
$$;
revoke execute on function public.inbox_auto_resolve(uuid) from public, anon, authenticated;
grant execute on function public.inbox_auto_resolve(uuid) to service_role;

alter publication supabase_realtime add table public.conversation_notes;
