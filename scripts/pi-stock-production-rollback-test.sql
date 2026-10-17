-- Execute the entire file as one SQL request. Every fixture is rolled back.
begin;

insert into auth.users(id,email,raw_user_meta_data) values
  ('90000000-0000-4000-8000-000000000111','codex-sales-rollback-20261017@example.invalid','{}'),
  ('90000000-0000-4000-8000-000000000112','codex-warehouse-rollback-20261017@example.invalid','{}');
update public.users set status='ACTIVE',role='SALES'
  where id='90000000-0000-4000-8000-000000000111';
update public.users set status='ACTIVE',role='WAREHOUSE'
  where id='90000000-0000-4000-8000-000000000112';
insert into public.profiles(id,name,email,phone) values
  ('90000000-0000-4000-8000-000000000111','Rollback Sales','codex-sales-rollback-20261017@example.invalid','+86 13800000001');
insert into public.customers(id,company_name,country,status,pool_status,created_by,owner_id,owner_user_id,assigned_via,
  phone,email,manual_grade,shipping_address)
values('90000000-0000-4000-8000-000000000211','CODEX-ROLLBACK-STOCK-CUSTOMER-20261017','GB','CLAIMED','CLAIMED',
  '90000000-0000-4000-8000-000000000111','90000000-0000-4000-8000-000000000111',
  '90000000-0000-4000-8000-000000000111','PRIVATE_CREATE',
  '+44 123456780','codex-buyer-rollback-20261017@example.invalid','A','Rollback shipping address');
insert into public.pi_payment_accounts(id,label,currency,instructions,payment_channel)
values('90000000-0000-4000-8000-000000000311','CODEX-ROLLBACK-STOCK-ACCOUNT-20261017','USD','Rollback bank details','T/T Bank Transfer');

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000111',true);

do $$
declare
  pi public.sales_orders;
  stock public.stock_orders;
  first_line uuid;
  second_line uuid;
  rejected boolean;
begin
  pi := public.create_direct_pi_order_with_fees(
    '90000000-0000-4000-8000-000000000211','CODEX-ROLLBACK-STOCK-20261017','USD',0.1,0,
    'T/T Bank Transfer','90000000-0000-4000-8000-000000000311',current_date+30,current_date+14,
    'Rollback Buyer','+44 123456780','codex-buyer-rollback-20261017@example.invalid','Rollback shipping address',
    'Rollback stocking requirement',
    '[{"item_name":"LCD","brand":"IPH","model":"Rollback 1","quality":"OLED","description_zh":"测试屏幕1","quantity":2,"unit_price_cny":50,"unit_price_payment":5,"unit_price_source":"CNY","estimated_unit_cost_cny":30},
      {"item_name":"LCD","brand":"IPH","model":"Rollback 2","quality":"OLED","description_zh":"测试屏幕2","quantity":1,"unit_price_cny":60,"unit_price_payment":6,"unit_price_source":"CNY","estimated_unit_cost_cny":40}]'::jsonb,
    '{"last_balance":{"source":"CNY","amount":"0"},"discount":{"source":"CNY","amount":"0"},"other":{"source":"CNY","amount":"0"},"paypal_rate_percent":"0"}'::jsonb,
    '90000000-0000-4000-8000-000000000111');
  if pi.status <> 'DRAFT' or pi.delivery_address <> 'Rollback shipping address' then
    raise exception 'PI draft or delivery address mismatch';
  end if;
  pi := public.submit_direct_pi_order(pi.id,pi.pi_revision);
  select * into stock from public.stock_orders where sales_order_id=pi.id;
  if pi.status <> 'WAITING_STOCK' or stock.status <> 'WAITING' then
    raise exception 'PI to stock handoff mismatch';
  end if;
  select id into first_line from public.stock_order_items where stock_order_id=stock.id and line_number=1;
  select id into second_line from public.stock_order_items where stock_order_id=stock.id and line_number=2;
  if first_line is null or second_line is null then raise exception 'Stock lines missing'; end if;

  perform set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000112',true);
  rejected := false;
  begin
    perform public.record_stock_shipment(stock.id,array[first_line],
      (select updated_at from public.stock_orders where id=stock.id),'Premature shipment',1,0,0);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Unprepared line shipment was accepted'; end if;

  perform public.record_stock_progress(stock.id,'START',
    jsonb_build_array(jsonb_build_object('item_id',first_line),jsonb_build_object('item_id',second_line)),
    (select updated_at from public.stock_orders where id=stock.id),null);
  perform public.record_stock_progress(stock.id,'RECEIVE',
    jsonb_build_array(jsonb_build_object('item_id',first_line,'quantity',2,'supplier_code','ROLLBACK-1')),
    (select updated_at from public.stock_orders where id=stock.id),null);
  perform public.record_stock_progress(stock.id,'PREPARE',
    jsonb_build_array(jsonb_build_object('item_id',first_line,'quantity',2)),
    (select updated_at from public.stock_orders where id=stock.id),null);

  rejected := false;
  begin
    perform public.record_stock_shipment(stock.id,array[first_line],
      (select updated_at from public.stock_orders where id=stock.id),'Missing fees',null,0,0);
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Shipment without all three costs was accepted'; end if;

  perform public.record_stock_shipment(stock.id,array[first_line],
    (select updated_at from public.stock_orders where id=stock.id),'First complete product line',1,0,2);
  select * into stock from public.stock_orders where id=stock.id;
  if stock.status='SHIPPED'
    or (select status from public.customers where id=pi.customer_id) <> 'CLAIMED'
    or (select shipped_quantity from public.stock_order_items where id=first_line) <> 2
    or (select shipped_quantity from public.stock_order_items where id=second_line) <> 0 then
    raise exception 'Partial shipment state or customer stage mismatch';
  end if;

  perform public.record_stock_progress(stock.id,'RECEIVE',
    jsonb_build_array(jsonb_build_object('item_id',second_line,'quantity',1,'supplier_code','ROLLBACK-2')),
    (select updated_at from public.stock_orders where id=stock.id),null);
  perform public.record_stock_progress(stock.id,'PREPARE',
    jsonb_build_array(jsonb_build_object('item_id',second_line,'quantity',1)),
    (select updated_at from public.stock_orders where id=stock.id),null);
  perform public.record_stock_shipment(stock.id,array[second_line],
    (select updated_at from public.stock_orders where id=stock.id),'Final complete product line',0,0,0);
  select * into stock from public.stock_orders where id=stock.id;
  if stock.status <> 'SHIPPED'
    or (select status from public.sales_orders where id=pi.id) <> 'SHIPPED'
    or (select status from public.customers where id=pi.customer_id) <> 'DEAL'
    or (select count(*) from public.stock_order_shipments where stock_order_id=stock.id) <> 2 then
    raise exception 'Full shipment or first-PI customer promotion mismatch';
  end if;
  if not exists(select 1 from public.stock_order_expenses where stock_order_id=stock.id
    and packaging_cost_cny=1 and procurement_expenses_cny=0 and shipping_expenses_cny=2) then
    raise exception 'Cumulative shipment costs mismatch';
  end if;
end $$;

rollback;
