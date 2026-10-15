-- The salesperson's order number is the shared business identity for PI and warehouse.
-- Case and surrounding whitespace must not allow a second saved order.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create unique index sales_orders_customer_order_number_unique
  on public.sales_orders (lower(btrim(warehouse_reference_number)))
  where warehouse_reference_number is not null;

-- A recalled PI retains its original stock-order row. Keep that row's
-- business reference aligned when the salesperson edits the draft number.
create function public.sync_draft_stock_customer_order_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.confirmation_method = 'DIRECT_PI' and new.status = 'DRAFT'
    and new.warehouse_reference_number is distinct from old.warehouse_reference_number then
    update public.stock_orders set warehouse_reference_number = new.warehouse_reference_number,
      updated_at = now()
      where sales_order_id = new.id and status = 'DRAFT';
  end if;
  return new;
end $$;
revoke all on function public.sync_draft_stock_customer_order_number() from public, anon, authenticated;
create trigger sync_draft_stock_customer_order_number
  after update of warehouse_reference_number on public.sales_orders
  for each row execute function public.sync_draft_stock_customer_order_number();

create unique index stock_orders_customer_order_number_unique
  on public.stock_orders (lower(btrim(warehouse_reference_number)))
  where warehouse_reference_number is not null;

commit;
