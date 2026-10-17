begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

revoke all on public.stock_orders_with_pi_preparer from public, anon;
grant select on public.stock_orders_with_pi_preparer to authenticated;

commit;
