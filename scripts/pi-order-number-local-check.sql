do $$
declare sales_id uuid := '00000000-0000-0000-0000-000000000101';
begin
  update public.sales_orders set warehouse_reference_number='D-TEST-1',
    confirmation_method='DIRECT_PI' where id=sales_id;
  begin
    insert into public.sales_orders(id,status,warehouse_reference_number,confirmation_method)
    values ('00000000-0000-0000-0000-000000000102','DRAFT',' d-test-1 ','DIRECT_PI');
    raise exception 'duplicate sales order number was accepted';
  exception when unique_violation then null;
  end;
  update public.stock_orders set status='DRAFT' where sales_order_id=sales_id;
  update public.sales_orders set status='DRAFT',warehouse_reference_number='D-TEST-2'
    where id=sales_id;
  if (select warehouse_reference_number from public.stock_orders where sales_order_id=sales_id)<>'D-TEST-2' then
    raise exception 'recalled stock reference not synchronized';
  end if;
  insert into public.sales_orders(id,status,warehouse_reference_number,confirmation_method)
  values ('00000000-0000-0000-0000-000000000102','DRAFT','D-TEST-1','DIRECT_PI');
  begin
    insert into public.stock_orders(id,sales_order_id,status,updated_at,warehouse_reference_number)
    values ('00000000-0000-0000-0000-000000000202',
      '00000000-0000-0000-0000-000000000102','WAITING',now(),' d-test-2 ');
    raise exception 'duplicate stock order number was accepted';
  exception when unique_violation then null;
  end;
end $$;
select 'customer order number uniqueness checks passed' as result;
