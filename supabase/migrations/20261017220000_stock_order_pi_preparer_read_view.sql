-- Stock orders have no independent PI preparer. Expose that immutable PI
-- identity for list filtering while keeping both underlying tables' RLS.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create view public.stock_orders_with_pi_preparer
  with (security_invoker = true) as
select stock.*, pi.prepared_by as pi_prepared_by
from public.stock_orders stock
left join public.sales_orders pi on pi.id = stock.sales_order_id;

revoke all on public.stock_orders_with_pi_preparer from public, anon;
grant select on public.stock_orders_with_pi_preparer to authenticated;

commit;
