-- New branches can be created with their delivery fee and minimum order
-- (20261114100000_bot.sql only granted update on these columns).
grant insert (default_delivery_fee, minimum_order) on public.branches to authenticated;
