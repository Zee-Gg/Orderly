-- Phase 9: timeline entries for riders (own migration: new enum values must be
-- committed before functions use them).
alter type public.order_event_type add value if not exists 'rider_assigned';
alter type public.order_event_type add value if not exists 'rider_unassigned';
alter type public.order_event_type add value if not exists 'cash_collected';
