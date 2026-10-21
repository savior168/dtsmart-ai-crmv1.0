-- A caller cannot alter either saved customer identity snapshot after creation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

drop trigger if exists sales_orders_snapshot_customer_tax_number on public.sales_orders;
create trigger sales_orders_snapshot_customer_tax_number
before insert or update of customer_id, customer_tax_number_snapshot, customer_name_snapshot
on public.sales_orders
for each row execute function public.snapshot_pi_customer_tax_number();

commit;
