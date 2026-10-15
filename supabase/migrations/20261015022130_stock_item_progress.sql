-- Warehouse stages are recorded per product. The parent status is the earliest
-- unfinished line; received quantity remains a separate physical measure.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.stock_order_items add column preparation_status text not null default 'WAITING';
alter table public.stock_order_items add constraint stock_item_preparation_status_check
  check (preparation_status in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED'));
update public.stock_order_items i set preparation_status=s.status
from public.stock_orders s where s.id=i.stock_order_id
  and s.status in ('PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED');

-- Existing aggregate update RPCs still work for historical callers. A new
-- per-line transition marks its parent update so this compatibility trigger
-- does not accidentally flatten all individual line stages.
create function public.sync_stock_item_status_from_order()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status
    and current_setting('app.stock_item_transition',true) is distinct from '1'
    and new.status in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED') then
    update public.stock_order_items set preparation_status=new.status where stock_order_id=new.id;
  end if;
  return new;
end $$;
create trigger sync_stock_item_status_from_order
after update of status on public.stock_orders for each row
execute function public.sync_stock_item_status_from_order();

create function public.prevent_receipt_regression_after_stage()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.preparation_status in ('RECEIVED','SORTING','READY_TO_SHIP','SHIPPED')
    and new.received_quantity is distinct from old.received_quantity
    and new.received_quantity<>new.quantity then
    raise exception '已回货或后续阶段的产品不得减少回货数量，请先由管理员记录原因并回退状态';
  end if;
  return new;
end $$;
create trigger prevent_receipt_regression_after_stage
before update of received_quantity on public.stock_order_items for each row
execute function public.prevent_receipt_regression_after_stage();

create function public.update_stock_item_stages(
  p_stock_order_id uuid,p_changes jsonb,p_expected_updated_at timestamptz,p_note text default null,
  p_packaging_cost_cny numeric default null,p_procurement_expenses_cny numeric default null,
  p_shipping_expenses_cny numeric default null
) returns public.stock_orders language plpgsql security definer set search_path='' as $$
declare actor public.users; target public.stock_orders; change record; item public.stock_order_items;
  old_rank integer; new_rank integer; lowest_rank integer; next_status text; all_shipped boolean;
  changed_lines text:=''; previous_status text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then raise exception '无仓库状态更新权限'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then raise exception '备货单已由其他人更新，请刷新核对后重试'; end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP') then
    raise exception '当前备货单不可逐项更新状态'; end if;
  previous_status:=target.status;
  if jsonb_typeof(p_changes)<>'array' or jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception '请选择1至500项产品更新'; end if;
  if (select count(*) from jsonb_to_recordset(p_changes) as c(item_id uuid,status text))
    is distinct from (select count(distinct c.item_id) from jsonb_to_recordset(p_changes) as c(item_id uuid,status text)) then
    raise exception '同一产品不得重复提交'; end if;
  for change in select * from jsonb_to_recordset(p_changes) as c(item_id uuid,status text) loop
    select * into item from public.stock_order_items where id=change.item_id and stock_order_id=target.id for update;
    if item.id is null then raise exception '产品明细不存在或不属于此备货单'; end if;
    old_rank:=array_position(array['WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED'],item.preparation_status);
    new_rank:=array_position(array['WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED'],change.status);
    if new_rank is null or (new_rank<>old_rank+1 and not (actor.role='ADMIN' and new_rank=old_rank-1
      and nullif(trim(coalesce(p_note,'')),'') is not null)) then
      raise exception '第%项只能推进一步；管理员纠错回退一步必须说明原因',item.line_number; end if;
    if new_rank>=3 and item.received_quantity<>item.quantity then
      raise exception '第%项尚未回齐，不得标记为已回货或后续阶段',item.line_number; end if;
    if new_rank>=5 and nullif(trim(coalesce(p_note,'')),'') is null then
      raise exception '待出货或已发货必须填写理货、测试或物流交接说明'; end if;
    update public.stock_order_items set preparation_status=change.status where id=item.id;
    changed_lines:=changed_lines||case when changed_lines='' then '' else '；' end||
      '第'||item.line_number||'项 '||item.preparation_status||'→'||change.status;
  end loop;
  select min(array_position(array['WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED'],i.preparation_status)),
    bool_and(i.preparation_status='SHIPPED') into lowest_rank,all_shipped
  from public.stock_order_items i where i.stock_order_id=target.id;
  if lowest_rank is null then raise exception '备货单没有产品明细'; end if;
  next_status:=(array['WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED'])[lowest_rank];
  if all_shipped then
    if p_packaging_cost_cny is null or p_procurement_expenses_cny is null or p_shipping_expenses_cny is null
      or p_packaging_cost_cny<0 or p_procurement_expenses_cny<0 or p_shipping_expenses_cny<0
      or p_packaging_cost_cny>999999999999.99 or p_procurement_expenses_cny>999999999999.99
      or p_shipping_expenses_cny>999999999999.99
      or p_packaging_cost_cny<>round(p_packaging_cost_cny,2)
      or p_procurement_expenses_cny<>round(p_procurement_expenses_cny,2)
      or p_shipping_expenses_cny<>round(p_shipping_expenses_cny,2) then
      raise exception '整单全部发货前须填写三项非负、最多两位小数的费用（无费用填0）'; end if;
    insert into public.stock_order_expenses(stock_order_id,packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,updated_by)
    values(target.id,p_packaging_cost_cny,p_procurement_expenses_cny,p_shipping_expenses_cny,actor.id)
    on conflict(stock_order_id) do update set packaging_cost_cny=excluded.packaging_cost_cny,
      procurement_expenses_cny=excluded.procurement_expenses_cny,shipping_expenses_cny=excluded.shipping_expenses_cny,
      updated_by=excluded.updated_by,updated_at=now();
  elsif p_packaging_cost_cny is not null or p_procurement_expenses_cny is not null or p_shipping_expenses_cny is not null then
    raise exception '整单费用只在所有产品均已发货时确认';
  end if;
  perform set_config('app.stock_item_transition','1',true);
  update public.stock_orders set status=next_status,status_note=nullif(trim(coalesce(p_note,'')),''),
    ready_at=case when next_status='READY_TO_SHIP' and ready_at is null then now() else ready_at end,
    updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  perform set_config('app.stock_item_transition','0',true);
  update public.sales_orders set status=case next_status when 'WAITING' then 'WAITING_STOCK' else next_status end,
    updated_at=now() where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(target.id,previous_status,next_status,
    changed_lines||case when nullif(trim(coalesce(p_note,'')),'') is null then '' else '；'||trim(p_note) end,actor.id);
  update public.system_notifications set action_status='RESOLVED'
    where entity_type='stock_order' and entity_id=target.id and type='STOCK_ORDER_CREATED';
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货进度已更新',
    format('%s 更新订单 %s 的产品备货状态：%s。',coalesce(actor.name,actor.email),
      coalesce(target.warehouse_reference_number,target.order_number),changed_lines),
    '/stock-orders/'||target.id,'stock_order',target.id,'stock-item:'||target.id||':'||gen_random_uuid(),'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_ITEM_STAGE_UPDATE','stock_order',target.id,
    jsonb_build_object('changes',p_changes,'note',p_note,'result_status',next_status));
  return target;
end $$;
revoke all on function public.update_stock_item_stages(uuid,jsonb,timestamptz,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.update_stock_item_stages(uuid,jsonb,timestamptz,text,numeric,numeric,numeric) to authenticated;
commit;
