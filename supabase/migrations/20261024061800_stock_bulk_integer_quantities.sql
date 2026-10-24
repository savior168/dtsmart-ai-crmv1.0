begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- stock_order_items.quantity is numeric(12,2) for legacy schema compatibility,
-- while the receiving workflow enforces whole units. Normalize it before
-- placing it in JSON consumed by record_stock_progress(integer).
create or replace function public.complete_stock_items_batch(
  p_stock_order_id uuid, p_stage text, p_item_ids uuid[],
  p_expected_updated_at timestamptz
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  line public.stock_order_items;
  receive_changes jsonb := '[]'::jsonb;
  prepare_changes jsonb := '[]'::jsonb;
  item_count integer := 0;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库备货更新权限';
  end if;
  if p_stage is null or p_stage not in ('RECEIVED','READY_TO_SHIP') or p_item_ids is null
    or cardinality(p_item_ids) < 1 or cardinality(p_item_ids) > 500
    or exists (select 1 from unnest(p_item_ids) as x(id) where id is null)
    or (select count(distinct id) from unnest(p_item_ids) as x(id)) <> cardinality(p_item_ids) then
    raise exception '请选择1至500项不重复的有效产品';
  end if;
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已更新，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP') then
    raise exception '当前备货单不能批量更新正常备货进度';
  end if;
  for line in select * from public.stock_order_items
    where stock_order_id = p_stock_order_id and id = any(p_item_ids)
    order by line_number for update loop
    item_count := item_count + 1;
    if line.received_quantity < line.quantity then
      receive_changes := receive_changes || jsonb_build_array(jsonb_build_object(
        'item_id',line.id,'quantity',line.quantity::integer,
        'supplier_code',coalesce(line.warehouse_supplier_code,'')));
    end if;
    if p_stage = 'READY_TO_SHIP' and line.prepared_quantity < line.quantity then
      prepare_changes := prepare_changes || jsonb_build_array(jsonb_build_object(
        'item_id',line.id,'quantity',line.quantity::integer));
    end if;
  end loop;
  if item_count <> cardinality(p_item_ids) then
    raise exception '所选产品不属于当前备货单，请刷新后重试';
  end if;
  if jsonb_array_length(receive_changes) = 0 and jsonb_array_length(prepare_changes) = 0 then
    raise exception '所选产品已达到该阶段，无需重复更新';
  end if;
  if jsonb_array_length(receive_changes) > 0 then
    target := public.record_stock_progress(p_stock_order_id,'RECEIVE',receive_changes,
      target.updated_at,'仓库批量确认选中产品已回齐');
  end if;
  if jsonb_array_length(prepare_changes) > 0 then
    target := public.record_stock_progress(p_stock_order_id,'PREPARE',prepare_changes,
      target.updated_at,'仓库批量确认选中产品已完成理货、待发货');
  end if;
  return target;
end $$;

revoke all on function public.complete_stock_items_batch(uuid,text,uuid[],timestamptz) from public, anon;
grant execute on function public.complete_stock_items_batch(uuid,text,uuid[],timestamptz) to authenticated;
commit;
