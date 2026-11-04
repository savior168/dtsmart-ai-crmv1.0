-- Install the two existing production stock guards on the isolated fixture.
-- The migration replaces their functions; testing only the functions without
-- the triggers would miss a 0/0 cancelled-line shipment rejection.
create trigger require_costed_stock_shipment_before_update
before update of shipped_quantity, preparation_status on public.stock_order_items
for each row execute function public.require_costed_stock_shipment();

create trigger sync_stock_item_status_from_order
after update of status on public.stock_orders
for each row execute function public.sync_stock_item_status_from_order();
