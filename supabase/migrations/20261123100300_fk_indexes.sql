-- Phase 12 performance advisor: index the single-column foreign keys the app
-- looks up (settlements, zones, bot vs staff orders, messages per order,
-- user references used when an account is removed). Composite
-- (id, restaurant_id) foreign keys already have an index on the id column.
create index if not exists orders_settlement_idx on public.orders (settlement_id) where settlement_id is not null;
create index if not exists orders_delivery_zone_idx on public.orders (delivery_zone_id) where delivery_zone_id is not null;
create index if not exists orders_created_by_idx on public.orders (created_by) where created_by is not null;
create index if not exists orders_cancelled_by_idx on public.orders (cancelled_by) where cancelled_by is not null;
create index if not exists order_events_actor_idx on public.order_events (actor_user_id) where actor_user_id is not null;
create index if not exists payments_verified_by_idx on public.payments (verified_by) where verified_by is not null;
create index if not exists whatsapp_messages_order_idx on public.whatsapp_messages (order_id) where order_id is not null;
