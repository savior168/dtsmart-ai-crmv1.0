-- Run after stock-progress-local-fixture, quantity-progress, and the new shipment migration.
do $$begin
  if has_table_privilege('authenticated','public.stock_order_shipments','INSERT')
    or has_table_privilege('authenticated','public.stock_order_shipments','UPDATE')
    or has_table_privilege('authenticated','public.stock_order_shipments','DELETE')
    or has_table_privilege('anon','public.stock_order_shipments','SELECT')
    or not has_table_privilege('authenticated','public.stock_order_shipments','SELECT') then
    raise exception 'shipment audit table grants are unsafe';
  end if;
end $$;
insert into public.sales_orders(id,status,updated_at) values
  ('00000000-0000-0000-0000-000000000111','WAITING_STOCK',now());
insert into public.stock_orders(id,sales_order_id,sales_user_id,status,updated_at,warehouse_reference_number,order_number)
values ('00000000-0000-0000-0000-000000000211','00000000-0000-0000-0000-000000000111',
  '00000000-0000-0000-0000-000000000002','WAITING',now(),'D-SHIP-1','PI-SHIP-1');
insert into public.stock_order_items(id,stock_order_id,line_number,item_name,model,quantity) values
  ('00000000-0000-0000-0000-000000000311','00000000-0000-0000-0000-000000000211',1,'LCD','A',20),
  ('00000000-0000-0000-0000-000000000312','00000000-0000-0000-0000-000000000211',2,'LCD','B',10),
  ('00000000-0000-0000-0000-000000000313','00000000-0000-0000-0000-000000000211',3,'LCD','C',5);
select set_config('app.test_uid','00000000-0000-0000-0000-000000000001',false);

do $$
declare sid uuid:='00000000-0000-0000-0000-000000000211';
  first_id uuid:='00000000-0000-0000-0000-000000000311';
  second_id uuid:='00000000-0000-0000-0000-000000000312';
  third_id uuid:='00000000-0000-0000-0000-000000000313';
  version timestamptz; result public.stock_orders;
begin
  select updated_at into version from public.stock_orders where id=sid;
  result:=public.record_stock_progress(sid,'START',jsonb_build_array(
    jsonb_build_object('item_id',first_id),jsonb_build_object('item_id',second_id)),version);
  result:=public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(
    jsonb_build_object('item_id',first_id,'quantity',20,'supplier_code','A'),
    jsonb_build_object('item_id',second_id,'quantity',10,'supplier_code','B')),result.updated_at);
  result:=public.record_stock_progress(sid,'PREPARE',jsonb_build_array(
    jsonb_build_object('item_id',first_id,'quantity',20),
    jsonb_build_object('item_id',second_id,'quantity',10)),result.updated_at);
  perform set_config('app.test_uid','00000000-0000-0000-0000-000000000002',true);
  begin
    perform public.record_stock_shipment(sid,array[first_id],result.updated_at,'Unauthorized',0,0,0);
    raise exception 'sales user shipped a stock line';
  exception when others then
    if sqlerrm='sales user shipped a stock line' then raise; end if;
  end;
  perform set_config('app.test_uid','00000000-0000-0000-0000-000000000001',true);
  begin
    perform public.record_stock_shipment(sid,array[first_id],result.updated_at,'Carrier A',null,0,0);
    raise exception 'missing fee was accepted';
  exception when others then
    if sqlerrm='missing fee was accepted' then raise; end if;
  end;
  begin
    perform public.record_stock_shipment(sid,array[first_id,first_id],result.updated_at,'Carrier A',0,0,0);
    raise exception 'duplicate selected line was accepted';
  exception when others then
    if sqlerrm='duplicate selected line was accepted' then raise; end if;
  end;
  begin
    perform public.record_stock_shipment(sid,array[first_id],result.updated_at-'1 second'::interval,'Carrier A',0,0,0);
    raise exception 'stale version was accepted';
  exception when others then
    if sqlerrm='stale version was accepted' then raise; end if;
  end;
  result:=public.record_stock_shipment(sid,array[first_id],result.updated_at,
    'Carrier A, tracking T-001',2.50,0,1.20);
  if result.status<>'PREPARING' then raise exception 'partial shipment parent stage wrong: %',result.status; end if;
  if (select shipped_quantity from public.stock_order_items where id=first_id)<>20
    or (select shipped_quantity from public.stock_order_items where id=second_id)<>0 then
    raise exception 'shipment did not affect exactly selected complete lines';
  end if;
  if (select count(*) from public.stock_order_shipments where stock_order_id=sid)<>1 then
    raise exception 'partial shipment audit missing';
  end if;
  if (select packaging_cost_cny from public.stock_order_expenses where stock_order_id=sid)<>2.50 then
    raise exception 'partial shipment expense missing';
  end if;
  begin
    perform public.record_stock_shipment(sid,array[first_id],result.updated_at,'Duplicate',0,0,0);
    raise exception 'second shipment of same line was accepted';
  exception when others then
    if sqlerrm='second shipment of same line was accepted' then raise; end if;
  end;
  result:=public.record_stock_progress(sid,'START',jsonb_build_array(jsonb_build_object('item_id',third_id)),result.updated_at);
  result:=public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(
    jsonb_build_object('item_id',third_id,'quantity',5,'supplier_code','C')),result.updated_at);
  result:=public.record_stock_progress(sid,'PREPARE',jsonb_build_array(
    jsonb_build_object('item_id',third_id,'quantity',5)),result.updated_at);
  if result.status<>'READY_TO_SHIP' then raise exception 'remaining line ready stage wrong'; end if;
  begin
    perform public.record_stock_progress(sid,'SHIP','[]'::jsonb,result.updated_at,'Old cost-free handoff');
    raise exception 'old cost-free shipping RPC was accepted';
  exception when others then
    if sqlerrm='old cost-free shipping RPC was accepted' then raise; end if;
  end;
  result:=public.record_stock_shipment(sid,array[second_id,third_id],result.updated_at,
    'Carrier B, tracking T-002',0,1,3);
  if result.status<>'SHIPPED' or
    (select status from public.sales_orders where id=result.sales_order_id)<>'SHIPPED' then
    raise exception 'full shipment did not synchronize both documents';
  end if;
  if (select count(*) from public.stock_order_shipments where stock_order_id=sid)<>2 then
    raise exception 'two shipment records were not retained';
  end if;
  if not exists(select 1 from public.stock_order_expenses where stock_order_id=sid
    and packaging_cost_cny=2.50 and procurement_expenses_cny=1
    and shipping_expenses_cny=4.20) then
    raise exception 'shipment costs did not aggregate correctly';
  end if;
  if (select count(*) from public.stock_order_items where stock_order_id=sid
    and shipped_quantity=quantity and preparation_status='SHIPPED')<>3 then
    raise exception 'final product line statuses are inconsistent';
  end if;
  begin
    update public.stock_order_items set preparation_status='READY_TO_SHIP' where id=first_id;
    raise exception 'shipped line stage was allowed to regress';
  exception when others then
    if sqlerrm='shipped line stage was allowed to regress' then raise; end if;
  end;
end $$;

select 'partial/full stock shipments, mandatory CNY expenses, old RPC guard and PI sync passed' as result;
