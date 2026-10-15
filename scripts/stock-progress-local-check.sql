select set_config('app.test_uid','00000000-0000-0000-0000-000000000001',false);
do $$
declare sid uuid := '00000000-0000-0000-0000-000000000201';
  first_id uuid := '00000000-0000-0000-0000-000000000301';
  second_id uuid := '00000000-0000-0000-0000-000000000302';
  version timestamptz; result public.stock_orders;
begin
  select updated_at into version from public.stock_orders where id=sid;
  result:=public.record_stock_progress(sid,'START',jsonb_build_array(jsonb_build_object('item_id',first_id)),version);
  if result.status<>'PREPARING' then raise exception 'START failed'; end if;
  version:=result.updated_at;
  begin
    perform public.record_stock_progress(sid,'SHIP','[]'::jsonb,version,'Carrier handoff');
    raise exception 'premature SHIP was allowed';
  exception when others then
    if sqlerrm='premature SHIP was allowed' then raise; end if;
  end;
  result:=public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(jsonb_build_object('item_id',first_id,'quantity',10,'supplier_code','S-01')),version);
  if (select received_quantity from public.stock_order_items where id=first_id)<>10 then raise exception 'partial receipt failed'; end if;
  if not exists (select 1 from public.stock_order_events where stock_order_id=sid
    and note like '%第1项（IPH 17 Pro）：累计回货0→10/20件，供应商编码更新为S-01%') then
    raise exception 'human-readable receipt history missing product, quantity, or supplier code';
  end if;
  version:=result.updated_at;
  result:=public.record_stock_progress(sid,'PREPARE',jsonb_build_array(jsonb_build_object('item_id',first_id,'quantity',5)),version);
  if (select prepared_quantity from public.stock_order_items where id=first_id)<>5 then raise exception 'partial preparation failed'; end if;
  version:=result.updated_at;
  begin
    perform public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(jsonb_build_object('item_id',first_id,'quantity',21,'supplier_code','S-01')),version);
    raise exception 'over-receipt was allowed';
  exception when others then
    if sqlerrm='over-receipt was allowed' then raise; end if;
  end;
  result:=public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(jsonb_build_object('item_id',first_id,'quantity',20,'supplier_code','S-01')),version);
  version:=result.updated_at;
  result:=public.record_stock_progress(sid,'PREPARE',jsonb_build_array(jsonb_build_object('item_id',first_id,'quantity',20)),version);
  version:=result.updated_at;
  result:=public.record_stock_progress(sid,'RECEIVE',jsonb_build_array(jsonb_build_object('item_id',second_id,'quantity',10,'supplier_code','S-02')),version);
  version:=result.updated_at;
  result:=public.record_stock_progress(sid,'PREPARE',jsonb_build_array(jsonb_build_object('item_id',second_id,'quantity',10)),version);
  if result.status<>'READY_TO_SHIP' then raise exception 'ready stage failed'; end if;
  version:=result.updated_at;
  result:=public.record_stock_progress(sid,'SHIP','[]'::jsonb,version,'Carrier handoff at 12:00');
  if result.status<>'SHIPPED' or (select sum(shipped_quantity) from public.stock_order_items where stock_order_id=sid)<>30 then
    raise exception 'whole shipment failed';
  end if;
  if (select status from public.sales_orders where id=result.sales_order_id)<>'SHIPPED' then raise exception 'PI status not synchronized'; end if;
end $$;
select 'stock progress local SQL checks passed' as result;
do $$
declare version timestamptz;
begin
  select updated_at into version from public.stock_orders
    where id='00000000-0000-0000-0000-000000000201';
  perform set_config('app.test_uid','00000000-0000-0000-0000-000000000002',false);
  begin
    perform public.record_stock_progress('00000000-0000-0000-0000-000000000201',
      'SHIP','[]'::jsonb,version,'unauthorized attempt');
    raise exception 'sales user was allowed to update warehouse progress';
  exception when others then
    if sqlerrm <> '无仓库备货更新权限' then raise; end if;
  end;
  perform set_config('app.test_uid','00000000-0000-0000-0000-000000000001',false);
end$$;
do $$begin
  begin
    perform public.save_stock_receiving_details('00000000-0000-0000-0000-000000000201','[]'::jsonb,now());
    raise exception 'legacy receipt API was not retired';
  exception when others then
    if sqlerrm <> '备货页面已更新，请刷新页面后继续操作' then raise; end if;
  end;
  begin
    perform public.update_stock_item_stages('00000000-0000-0000-0000-000000000201','[]'::jsonb,now(),null,null,null,null);
    raise exception 'legacy stage API was not retired';
  exception when others then
    if sqlerrm <> '备货页面已更新，请刷新页面后继续操作' then raise; end if;
  end;
end$$;
