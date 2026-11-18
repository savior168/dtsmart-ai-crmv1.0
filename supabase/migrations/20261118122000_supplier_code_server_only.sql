begin;
set local lock_timeout = '5s';

-- Table-wide SELECT was revoked in 202610220004; remove the remaining
-- column grant so browser clients cannot query procurement identifiers.
revoke select (warehouse_supplier_code)
  on public.stock_order_items from authenticated, anon, public;

commit;
