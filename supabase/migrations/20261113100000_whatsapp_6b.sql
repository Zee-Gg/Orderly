-- Phase 6B: order status messages, media storage.
-- No WhatsApp templates: every outbound message is sent only inside the
-- 24-hour customer window (enforced in src/lib/whatsapp/send.ts).

-- 1. Which order status messages a restaurant sends (owner edits, like printing settings).
alter table public.restaurants
  add column whatsapp_status_messages jsonb not null
    default '{"accepted": true, "preparing": true, "ready": true, "out_for_delivery": true, "delivered": true, "cancelled": true}'
    check (jsonb_typeof(whatsapp_status_messages) = 'object');

grant update (whatsapp_status_messages) on public.restaurants to authenticated;

-- 2. Messages: link status messages to their order, and keep media details.
alter table public.whatsapp_messages
  add column order_id uuid,
  add column media_mime_type text check (char_length(media_mime_type) <= 100),
  add column media_size integer check (media_size >= 0),
  add constraint whatsapp_messages_order_fk
    foreign key (order_id, restaurant_id) references public.orders (id, restaurant_id) on delete set null (order_id);

create index whatsapp_messages_order_idx on public.whatsapp_messages (order_id) where order_id is not null;

-- 3. Private bucket for customer media: {restaurant_id}/{message_id}.{ext}
--    Only the server (service role) uploads. Front of house can read their
--    restaurant's folder (the inbox makes 1-hour signed URLs with the user's client).
insert into storage.buckets (id, name, public, file_size_limit)
values ('whatsapp-media', 'whatsapp-media', false, 16777216)
on conflict (id) do nothing;

create policy "whatsapp-media: front of house read own folder"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'whatsapp-media'
    and (
      private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager,staff}')
      or (select private.is_super_admin())
    )
  );
