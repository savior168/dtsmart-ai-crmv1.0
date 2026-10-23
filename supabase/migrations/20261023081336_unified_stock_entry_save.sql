begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- One transaction for procurement details and positive physical progress.
-- Corrections that reduce a saved quantity remain in the separate audited workflow.
create function public.save_stock_entry_details(
  p_stock_order_id uuid,
  p_expected_updated_at timestamptz,
  p_items jsonb,
  p_note text default null
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  entry record;
  saved public.stock_order_items;
  procurement_items jsonb := '[]'::jsonb;
  receive_changes jsonb := '[]'::jsonb;
  prepare_changes jsonb := '[]'::jsonb;
  line_count integer;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role <> 'WAREHOUSE'
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无采购与备货更新权限';
  end if;
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已由其他人更新，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','SHORTAGE') then
    raise exception '当前备货状态不允许保存采购与进度';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 500 then
    raise exception '采购与进度明细格式不正确';
  end if;
  if char_length(coalesce(p_note,'')) > 1000 then raise exception '说明不能超过1000字'; end if;
  select count(*) into line_count from public.stock_order_items where stock_order_id = target.id;
  if jsonb_array_length(p_items) <> line_count
    or (select count(distinct x.item_id) from jsonb_to_recordset(p_items) as x(item_id uuid)) <> line_count
    or exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid)
      where not exists (select 1 from public.stock_order_items i where i.id = x.item_id and i.stock_order_id = target.id)) then
    raise exception '提交的产品明细与备货单不一致';
  end if;
  for entry in select * from jsonb_to_recordset(p_items) as x(
    item_id uuid, procurement_cost numeric, warehouse_note text,
    warehouse_supplier_code text, received_quantity integer, prepared_quantity integer
  ) loop
    select * into saved from public.stock_order_items
      where id = entry.item_id and stock_order_id = target.id for update;
    if entry.procurement_cost is not null and (entry.procurement_cost < 0
      or entry.procurement_cost > 999999999999.99
      or entry.procurement_cost <> round(entry.procurement_cost, 2)) then
      raise exception '第%项采购价须为非负金额，最多两位小数', saved.line_number;
    end if;
    if char_length(coalesce(entry.warehouse_note,'')) > 1000
      or char_length(coalesce(entry.warehouse_supplier_code,'')) > 100 then
      raise exception '第%项仓库备注或供应商编码过长', saved.line_number;
    end if;
    if entry.received_quantity is null or entry.prepared_quantity is null
      or entry.received_quantity < saved.received_quantity
      or entry.prepared_quantity < saved.prepared_quantity then
      raise exception '第%项减少已保存数量须走更正进度并填写原因', saved.line_number;
    end if;
    if entry.received_quantity > saved.quantity
      or entry.prepared_quantity > entry.received_quantity then
      raise exception '第%项数量须满足已理货数≤已回货数≤订购数', saved.line_number;
    end if;
    if nullif(trim(coalesce(entry.warehouse_supplier_code,'')), '') is not null
      and entry.procurement_cost is null then
      raise exception '第%项填写供应商编码前须填写采购价', saved.line_number;
    end if;
    procurement_items := procurement_items || jsonb_build_array(jsonb_build_object(
      'line_number', saved.line_number,
      'procurement_cost', entry.procurement_cost,
      'warehouse_note', entry.warehouse_note
    ));
    if entry.received_quantity <> saved.received_quantity
      or nullif(trim(coalesce(entry.warehouse_supplier_code,'')), '') is distinct from saved.warehouse_supplier_code then
      receive_changes := receive_changes || jsonb_build_array(jsonb_build_object(
        'item_id', saved.id, 'quantity', entry.received_quantity,
        'supplier_code', coalesce(entry.warehouse_supplier_code, '')
      ));
    end if;
    if entry.prepared_quantity <> saved.prepared_quantity then
      prepare_changes := prepare_changes || jsonb_build_array(jsonb_build_object(
        'item_id', saved.id, 'quantity', entry.prepared_quantity
      ));
    end if;
  end loop;
  if target.status = 'SHORTAGE'
    and (jsonb_array_length(receive_changes) > 0 or jsonb_array_length(prepare_changes) > 0) then
    raise exception '缺货异常状态下不能修改进度，请先恢复采购';
  end if;
  target := public.save_stock_order_procurement_costs(p_stock_order_id, procurement_items);
  if jsonb_array_length(receive_changes) > 0 then
    target := public.record_stock_progress(p_stock_order_id, 'RECEIVE', receive_changes, target.updated_at, p_note);
  end if;
  if jsonb_array_length(prepare_changes) > 0 then
    target := public.record_stock_progress(p_stock_order_id, 'PREPARE', prepare_changes, target.updated_at, p_note);
  end if;
  return target;
end $$;

revoke all on function public.save_stock_entry_details(uuid,timestamptz,jsonb,text) from public, anon;
grant execute on function public.save_stock_entry_details(uuid,timestamptz,jsonb,text) to authenticated;
commit;
