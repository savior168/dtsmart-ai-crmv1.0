-- PI and stock list/detail reads filter out cancelled amendment rows. The
-- authenticated role needs SELECT on this non-financial filter column even
-- when it is not included in the result projection. Existing row RLS remains.
grant select (pi_amendment_cancelled_at)
  on public.stock_order_items to authenticated;
