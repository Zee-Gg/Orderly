-- Kitchen screen needs to know when an order it was cooking gets cancelled.
-- Same view, two columns appended (still no phone, address or money).

create or replace view public.kitchen_orders with (security_barrier = true) as
select
  o.id, o.restaurant_id, o.branch_id, o.order_number, o.order_type, o.source, o.status,
  o.is_on_hold, o.customer_name, o.table_number, o.notes, o.scheduled_for, o.expected_ready_at,
  o.accepted_at, o.preparing_at, o.ready_at, o.version, o.created_at, o.updated_at,
  o.cancelled_at, o.hold_reason
from public.orders o
where private.has_role(o.restaurant_id, '{owner,manager,staff,kitchen}')
  and private.can_access_branch(o.branch_id);

revoke all on public.kitchen_orders from anon, authenticated;
grant select on public.kitchen_orders to authenticated;
