begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Customer-facing PI now uses the original quality and description text.
-- Keep existing English columns and values for reversibility, but remove the
-- approval gate and disable the obsolete write API.
drop trigger if exists require_direct_pi_customer_english on public.sales_orders;
revoke execute on function public.save_direct_pi_customer_text(uuid, integer, jsonb) from authenticated;

commit;
