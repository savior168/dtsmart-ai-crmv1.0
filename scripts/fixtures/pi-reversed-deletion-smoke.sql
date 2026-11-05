-- Run after pi-amendment-smoke.sql in an isolated database, after the
-- concurrency fixture if that fixture is also being exercised.
insert into public.suppliers(system_code,main_products,settlement_cycle)
values('TEST-RETURN','LCD','CASH');
set test.actor_id='88888888-8888-4888-8888-888888888882';
select public.record_supplier_receipt(
  '99999999-9999-4999-8999-999999999993',
  (select id from public.stock_order_items where stock_order_id='99999999-9999-4999-8999-999999999993' and line_number=4),
  (select id from public.suppliers where system_code='TEST-RETURN'),
  'TEST-RETURN-NOTE',current_date,1,50,
  (select updated_at from public.stock_orders where id='99999999-9999-4999-8999-999999999993'),
  'Test receipt');
select public.reverse_supplier_receipt(
  '99999999-9999-4999-8999-999999999993',
  (select a.id from public.supplier_receipt_allocations a
    join public.stock_order_items i on i.id=a.stock_order_item_id
    where i.stock_order_id='99999999-9999-4999-8999-999999999993'
      and i.line_number=4 and a.correction_of is null),
  1,(select updated_at from public.stock_orders where id='99999999-9999-4999-8999-999999999993'),
  'Supplier took the item back');
set test.actor_id='88888888-8888-4888-8888-888888888881';
select (public.request_direct_pi_amendment(
  '99999999-9999-4999-8999-999999999992',
  (select pi_revision from public.sales_orders where id='99999999-9999-4999-8999-999999999992'),
  (select jsonb_agg(to_jsonb(i) order by i.line_number) from public.sales_order_items i
    where i.sales_order_id='99999999-9999-4999-8999-999999999992'
      and i.line_number<>4 and i.pi_amendment_cancelled_at is null),
  'Customer cancelled returned item')).id as request_id \gset
set test.actor_id='88888888-8888-4888-8888-888888888882';
select public.decide_direct_pi_amendment(:'request_id',true,'Physical return checked');
do $$
declare
  stock_line public.stock_order_items;
  sales_line public.sales_order_items;
  allocation_count integer;
  net_due numeric;
begin
  select * into stock_line from public.stock_order_items
    where stock_order_id='99999999-9999-4999-8999-999999999993' and line_number=4;
  select * into sales_line from public.sales_order_items
    where sales_order_id='99999999-9999-4999-8999-999999999992' and line_number=4;
  select count(*),coalesce(sum(amount_cny),0) into allocation_count,net_due
    from public.supplier_receipt_allocations where stock_order_item_id=stock_line.id;
  if stock_line.id is null or stock_line.quantity<>0 or stock_line.pi_amendment_cancelled_at is null
    or sales_line.id is null or sales_line.quantity<>0 or sales_line.pi_amendment_cancelled_at is null
    or allocation_count<>2 or net_due<>0 then
    raise exception 'Cancelled PI line did not retain the reversed delivery-note history';
  end if;
  if (select count(*) from public.quote_items
    where pi_amendment_cancelled_at is not null and quantity=0)=0 then
    raise exception 'Cancelled quote snapshot was not retained';
  end if;
end $$;
