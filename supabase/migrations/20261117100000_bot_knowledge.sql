-- Phase 7C: what the bot knows besides the menu: menu images/PDF, offers,
-- FAQs, location and restaurant info. Owner/manager edit; all members read.
-- The bot reads with the service role, always scoped by restaurant_id.

-- ---------------------------------------------------------------------------
-- Settings on existing tables
-- ---------------------------------------------------------------------------
alter table public.restaurants
  add column mention_offer_on_greeting boolean not null default true,
  add column dine_in_available boolean not null default true,
  add column payment_methods text[] not null default '{cod,card_on_delivery}'
    check (payment_methods <@ array['cod', 'card_on_delivery']::text[] and cardinality(payment_methods) >= 1);
grant update (mention_offer_on_greeting, dine_in_available, payment_methods) on public.restaurants to authenticated;

alter table public.branches
  add column google_maps_url text check (char_length(google_maps_url) <= 500),
  -- Rough delivery time on top of the kitchen's default prep time.
  add column delivery_minutes integer not null default 30 check (delivery_minutes between 0 and 600);
grant insert (google_maps_url, delivery_minutes) on public.branches to authenticated;
grant update (google_maps_url, delivery_minutes) on public.branches to authenticated;

-- ---------------------------------------------------------------------------
-- menu_media: menu images / PDF the bot sends
-- ---------------------------------------------------------------------------
create table public.menu_media (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid,                       -- null = all branches
  type text not null check (type in ('image', 'pdf')),
  storage_path text not null check (char_length(storage_path) <= 300),
  file_name text check (char_length(file_name) <= 200),
  size_bytes integer check (size_bytes > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade
);
create index menu_media_restaurant_idx on public.menu_media (restaurant_id, sort_order);
create index menu_media_branch_idx on public.menu_media (branch_id) where branch_id is not null;
create trigger menu_media_set_updated_at before update on public.menu_media
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- offers: always linked to a menu item (price from the pricing engine)
-- ---------------------------------------------------------------------------
create table public.offers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id uuid,                       -- null = all branches
  title text not null check (char_length(title) between 2 and 120),
  title_ur text check (char_length(title_ur) <= 120),
  description text check (char_length(description) <= 500),
  menu_item_id uuid not null,
  image_path text check (char_length(image_path) <= 300),  -- bot-media path; else the item's photo
  starts_at timestamptz not null default now(),
  ends_at timestamptz,                  -- null = no end
  days_of_week smallint[] check (days_of_week <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]), -- ISO: 1 = Monday … 7 = Sunday; null = every day
  start_time time,                      -- null = all day
  end_time time,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check ((start_time is null) = (end_time is null)),
  foreign key (branch_id, restaurant_id) references public.branches (id, restaurant_id) on delete cascade,
  foreign key (menu_item_id, restaurant_id) references public.menu_items (id, restaurant_id)
);
create index offers_restaurant_idx on public.offers (restaurant_id, sort_order);
create index offers_branch_idx on public.offers (branch_id) where branch_id is not null;
create index offers_item_idx on public.offers (menu_item_id);
create trigger offers_set_updated_at before update on public.offers
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- restaurant_faqs
-- ---------------------------------------------------------------------------
create table public.restaurant_faqs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  question text not null check (char_length(question) between 2 and 200),
  answer text not null default '' check (char_length(answer) <= 1000),
  answer_ur text check (char_length(answer_ur) <= 1000),
  keywords text[] not null default '{}' check (cardinality(keywords) <= 30),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index restaurant_faqs_restaurant_idx on public.restaurant_faqs (restaurant_id, sort_order);
create trigger restaurant_faqs_set_updated_at before update on public.restaurant_faqs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Security: members read; owner/manager write (column grants)
-- ---------------------------------------------------------------------------
revoke all on public.menu_media, public.offers, public.restaurant_faqs from anon, authenticated;
grant all on public.menu_media, public.offers, public.restaurant_faqs to service_role;
grant select, delete on public.menu_media, public.offers, public.restaurant_faqs to authenticated;
grant insert (restaurant_id, branch_id, type, storage_path, file_name, size_bytes, sort_order, is_active)
  on public.menu_media to authenticated;
grant update (branch_id, sort_order, is_active) on public.menu_media to authenticated;
grant insert (restaurant_id, branch_id, title, title_ur, description, menu_item_id, image_path, starts_at, ends_at,
  days_of_week, start_time, end_time, is_active, sort_order) on public.offers to authenticated;
grant update (branch_id, title, title_ur, description, menu_item_id, image_path, starts_at, ends_at,
  days_of_week, start_time, end_time, is_active, sort_order) on public.offers to authenticated;
grant insert (restaurant_id, question, answer, answer_ur, keywords, is_active, sort_order) on public.restaurant_faqs to authenticated;
grant update (question, answer, answer_ur, keywords, is_active, sort_order) on public.restaurant_faqs to authenticated;

alter table public.menu_media enable row level security;
alter table public.offers enable row level security;
alter table public.restaurant_faqs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['menu_media', 'offers', 'restaurant_faqs'] loop
    execute format('create policy "%1$s: members read" on public.%1$I for select to authenticated
      using (private.is_member(restaurant_id) or (select private.is_super_admin()))', t);
    execute format('create policy "%1$s: owner/manager insert" on public.%1$I for insert to authenticated
      with check (private.has_role(restaurant_id, ''{owner,manager}''))', t);
    execute format('create policy "%1$s: owner/manager update" on public.%1$I for update to authenticated
      using (private.has_role(restaurant_id, ''{owner,manager}''))
      with check (private.has_role(restaurant_id, ''{owner,manager}''))', t);
    execute format('create policy "%1$s: owner/manager delete" on public.%1$I for delete to authenticated
      using (private.has_role(restaurant_id, ''{owner,manager}''))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: public "bot-media" (WhatsApp fetches media by public URL)
-- {restaurant_id}/menu/…, {restaurant_id}/offers/…, {restaurant_id}/photos/… (JPEG copies of item photos)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bot-media', 'bot-media', true, 20971520, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "bot-media: owner/manager read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'bot-media' and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}'));
create policy "bot-media: owner/manager upload to own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'bot-media' and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}'));
create policy "bot-media: owner/manager replace in own folder" on storage.objects for update to authenticated
  using (bucket_id = 'bot-media' and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}'))
  with check (bucket_id = 'bot-media' and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}'));
create policy "bot-media: owner/manager delete in own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'bot-media' and private.has_role(private.uuid_or_null((storage.foldername(name))[1]), '{owner,manager}'));

-- ---------------------------------------------------------------------------
-- Bestsellers: top items by quantity at a branch (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.bot_bestsellers(p_restaurant_id uuid, p_branch_id uuid, p_since timestamptz, p_limit integer default 10)
returns table (item_id uuid, quantity bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select oi.item_id, sum(oi.quantity)::bigint as quantity
    from public.order_items oi
    join public.orders o on o.id = oi.order_id and o.restaurant_id = oi.restaurant_id
   where o.restaurant_id = p_restaurant_id
     and o.branch_id = p_branch_id
     and o.created_at >= p_since
     and o.status not in ('cancelled', 'failed', 'pending_confirmation')
     and not oi.is_cancelled
   group by oi.item_id
   order by quantity desc
   limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.bot_bestsellers(uuid, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.bot_bestsellers(uuid, uuid, timestamptz, integer) to service_role;
