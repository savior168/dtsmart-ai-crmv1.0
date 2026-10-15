-- Physical, mutually exclusive quantity buckets replace weighted stage estimates.
-- Historical SORTING rows have no known completed quantity and remain at zero.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.stock_order_items
  add column prepared_quantity integer not null default 0,
  add column shipped_quantity integer not null default 0;
update public.stock_order_items
set prepared_quantity = quantity
where preparation_status in ('READY_TO_SHIP', 'SHIPPED') and received_quantity = quantity;
update public.stock_order_items
set shipped_quantity = quantity
where preparation_status = 'SHIPPED' and prepared_quantity = quantity;
alter table public.stock_order_items add constraint stock_item_physical_progress_check
  check (0 <= shipped_quantity and shipped_quantity <= prepared_quantity
    and prepared_quantity <= received_quantity and received_quantity <= quantity);
alter table public.stock_order_items add constraint stock_item_quantity_integer_check
  check (quantity > 0 and quantity = trunc(quantity));
drop trigger if exists prevent_receipt_regression_after_stage on public.stock_order_items;
drop function if exists public.prevent_receipt_regression_after_stage();

-- All execution changes are made under one order lock, with an optimistic
-- version check. A sales user cannot call this privileged RPC.
create function public.record_stock_progress(
  p_stock_order_id uuid, p_action text, p_changes jsonb,
  p_expected_updated_at timestamptz, p_note text default null
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users; target public.stock_orders; line public.stock_order_items;
  change record; amount integer; next_line_status text; previous_status text; supplier_code text;
  total_ordered bigint; total_received bigint; total_prepared bigint; total_shipped bigint;
  started_count bigint; next_status text; description text := ''; notify_sales boolean := false;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库备货更新权限';
  end if;
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已更新，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP') then
    raise exception '当前备货单不能记录正常备货进度';
  end if;
  if p_action not in ('START','RECEIVE','PREPARE','SHIP') then
    raise exception '无效的备货动作';
  end if;
  if length(coalesce(p_note,'')) > 1000 then raise exception '说明不能超过1000字'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) > 500
    or (p_action = 'SHIP' and jsonb_array_length(p_changes) <> 0)
    or (p_action <> 'SHIP' and jsonb_array_length(p_changes) = 0) then
    raise exception '请选择有效产品明细';
  end if;
  if (select count(*) from jsonb_to_recordset(p_changes) as x(item_id uuid, quantity integer, supplier_code text))
    is distinct from
    (select count(distinct x.item_id) from jsonb_to_recordset(p_changes) as x(item_id uuid, quantity integer, supplier_code text)) then
    raise exception '同一产品不得重复提交';
  end if;
  previous_status := target.status;
  if p_action = 'SHIP' then
    if nullif(trim(coalesce(p_note,'')), '') is null then
      raise exception '请填写货代名称、交接时间或运单信息';
    end if;
    if exists (select 1 from public.stock_order_items i where i.stock_order_id = target.id
      and (i.received_quantity <> i.quantity or i.prepared_quantity <> i.quantity)) then
      raise exception '全部产品回齐并完成理货打包后才能整单发货';
    end if;
    if not exists (select 1 from public.stock_order_items i where i.stock_order_id = target.id) then
      raise exception '备货单没有产品';
    end if;
    update public.stock_order_items set shipped_quantity = quantity,
      preparation_status = 'SHIPPED' where stock_order_id = target.id;
    description := '整单已交货代：' || trim(p_note);
    notify_sales := true;
  else
    for change in select * from jsonb_to_recordset(p_changes) as x(item_id uuid, quantity integer, supplier_code text) loop
      select * into line from public.stock_order_items
        where id = change.item_id and stock_order_id = target.id for update;
      if line.id is null then raise exception '产品明细不存在或不属于此备货单'; end if;
      amount := change.quantity;
      if p_action = 'START' then
        if line.preparation_status <> 'WAITING' then
          raise exception '第%项已开始采购，无需重复操作', line.line_number;
        end if;
        next_line_status := 'PREPARING';
        description := description || format('第%s项（%s）：开始采购，订购%s件；',
          line.line_number, coalesce(nullif(line.model, ''), line.item_name), line.quantity);
        notify_sales := true;
      else
        if amount is null or amount < 0 then
          raise exception '第%项累计数量必须为非负整数', line.line_number;
        end if;
        if p_action = 'RECEIVE' then
          supplier_code := nullif(trim(coalesce(change.supplier_code,'')), '');
          if amount > line.quantity or amount < line.prepared_quantity
            or length(coalesce(supplier_code,'')) > 100 then
            raise exception '第%项回货数量须介于已理货数与订购数之间，供应商编码不超过100字', line.line_number;
          end if;
          if amount = line.received_quantity and supplier_code is not distinct from line.warehouse_supplier_code then
            raise exception '第%项回货数量和供应商编码均未变化', line.line_number;
          end if;
          if amount < line.received_quantity and nullif(trim(coalesce(p_note,'')), '') is null then
            raise exception '第%项减少已回货数量须说明更正原因', line.line_number;
          end if;
          if amount <> line.received_quantity then notify_sales := true; end if;
          description := description || format('第%s项（%s）：累计回货%s→%s/%s件%s；',
            line.line_number, coalesce(nullif(line.model, ''), line.item_name),
            line.received_quantity, amount, line.quantity,
            case when supplier_code is distinct from line.warehouse_supplier_code
              then '，供应商编码' || case when supplier_code is null then '已清空' else '更新为' || supplier_code end
              else '' end);
          update public.stock_order_items set received_quantity = amount,
            warehouse_supplier_code = supplier_code
            where id = line.id returning * into line;
        else
          if amount > line.received_quantity or amount < line.shipped_quantity then
            raise exception '第%项理货完成数须介于已发货数与已回货数之间', line.line_number;
          end if;
          if amount = line.prepared_quantity then
            raise exception '第%项理货完成数量未变化', line.line_number;
          end if;
          if amount < line.prepared_quantity and nullif(trim(coalesce(p_note,'')), '') is null then
            raise exception '第%项减少已理货数量须说明更正原因', line.line_number;
          end if;
          notify_sales := true;
          description := description || format('第%s项（%s）：累计理货完成%s→%s/%s件；',
            line.line_number, coalesce(nullif(line.model, ''), line.item_name),
            line.prepared_quantity, amount, line.quantity);
          update public.stock_order_items set prepared_quantity = amount
            where id = line.id returning * into line;
        end if;
        next_line_status := case
          when line.prepared_quantity = line.quantity then 'READY_TO_SHIP'
          when line.received_quantity < line.quantity then 'PREPARING'
          when line.prepared_quantity > 0 then 'SORTING'
          else 'RECEIVED' end;
      end if;
      update public.stock_order_items set preparation_status = next_line_status where id = line.id;
    end loop;
  end if;

  select coalesce(sum(quantity),0), coalesce(sum(received_quantity),0),
    coalesce(sum(prepared_quantity),0), coalesce(sum(shipped_quantity),0),
    count(*) filter (where preparation_status <> 'WAITING')
    into total_ordered,total_received,total_prepared,total_shipped,started_count
    from public.stock_order_items where stock_order_id = target.id;
  if total_ordered = 0 then raise exception '备货单没有有效产品数量'; end if;
  next_status := case
    when total_shipped = total_ordered then 'SHIPPED'
    when total_prepared = total_ordered then 'READY_TO_SHIP'
    when total_received = total_ordered and total_prepared > 0 then 'SORTING'
    when total_received = total_ordered then 'RECEIVED'
    when started_count > 0 then 'PREPARING'
    else 'WAITING' end;
  perform set_config('app.stock_item_transition','1',true);
  update public.stock_orders set status = next_status,
    status_note = nullif(trim(coalesce(p_note,'')),''),
    ready_at = case when next_status = 'READY_TO_SHIP' and ready_at is null then now() else ready_at end,
    updated_by = actor.id, updated_at = now()
    where id = target.id returning * into target;
  perform set_config('app.stock_item_transition','0',true);
  update public.sales_orders set status = case when next_status = 'WAITING' then 'WAITING_STOCK' else next_status end,
    updated_at = now() where id = target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
    values(target.id,previous_status,next_status,
      trim(description || coalesce(' ' || nullif(trim(coalesce(p_note,'')),''),'')),actor.id);
  update public.system_notifications set action_status = 'RESOLVED'
    where entity_type = 'stock_order' and entity_id = target.id and type = 'STOCK_ORDER_CREATED';
  if notify_sales then
    insert into public.system_notifications
      (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
      values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货进度已更新',
        left(format('%s 更新订单 %s：%s',coalesce(actor.name,actor.email),
          coalesce(target.warehouse_reference_number,target.order_number),description),500),
        '/stock-orders/' || target.id,'stock_order',target.id,
        'stock-progress:' || target.id || ':' || gen_random_uuid(),'INFO');
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_PROGRESS_UPDATE','stock_order',target.id,
      jsonb_build_object('action',p_action,'changes',p_changes,'note',p_note,
        'received',total_received,'prepared',total_prepared,'shipped',total_shipped));
  return target;
end $$;
revoke all on function public.record_stock_progress(uuid,text,jsonb,timestamptz,text) from public,anon;
grant execute on function public.record_stock_progress(uuid,text,jsonb,timestamptz,text) to authenticated;

-- Old browser tabs may still call the former write APIs during deployment.
-- Give them a safe, actionable error rather than mutating incompatible counters.
create or replace function public.update_stock_item_stages(
  p_stock_order_id uuid,p_changes jsonb,p_expected_updated_at timestamptz,
  p_note text default null,p_packaging_cost_cny numeric default null,
  p_procurement_expenses_cny numeric default null,p_shipping_expenses_cny numeric default null
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
begin
  raise exception '备货页面已更新，请刷新页面后继续操作';
end $$;
create or replace function public.save_stock_receiving_details(
  p_stock_order_id uuid,p_items jsonb,p_expected_updated_at timestamptz
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
begin
  raise exception '备货页面已更新，请刷新页面后继续操作';
end $$;

-- The legacy order-status RPC remains callable for exception handling only.
-- It must not flatten product quantities or mark a shipment without handoff.
create or replace function public.update_stock_order_status(
  p_stock_order_id uuid,p_status text,p_note text,
  p_packaging_cost_cny numeric,p_procurement_expenses_cny numeric,p_shipping_expenses_cny numeric
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare actor public.users; target public.stock_orders; previous text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库状态更新权限';
  end if;
  if p_status not in ('SHORTAGE','CANCELLED','PREPARING') then
    raise exception '备货页面已更新，请刷新页面后逐项更新进度';
  end if;
  if p_packaging_cost_cny is not null or p_procurement_expenses_cny is not null
    or p_shipping_expenses_cny is not null then raise exception '此入口不处理费用'; end if;
  if nullif(trim(coalesce(p_note,'')),'') is null then raise exception '异常处理必须说明原因'; end if;
  if p_status='CANCELLED' and actor.role<>'ADMIN' then raise exception '取消备货单仅管理员可操作'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  previous := target.status;
  if not ((p_status='SHORTAGE' and previous in ('WAITING','PREPARING','RECEIVED','SORTING'))
    or (p_status='PREPARING' and previous='SHORTAGE')
    or (p_status='CANCELLED' and previous not in ('DRAFT','CANCELLED','SHIPPED'))) then
    raise exception '当前备货单不能执行该异常处理';
  end if;
  perform set_config('app.stock_item_transition','1',true);
  update public.stock_orders set status=p_status,status_note=trim(p_note),
    updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  perform set_config('app.stock_item_transition','0',true);
  update public.sales_orders set status=p_status,updated_at=now()
    where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
    values(target.id,previous,p_status,trim(p_note),actor.id);
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货异常已更新',
      format('%s 更新订单 %s：%s。%s',coalesce(actor.name,actor.email),
        coalesce(target.warehouse_reference_number,target.order_number),
        case p_status when 'SHORTAGE' then '缺货异常' when 'CANCELLED' then '已取消'
          else '恢复采购' end,trim(p_note)),
      '/stock-orders/'||target.id,'stock_order',target.id,
      'stock-exception:'||target.id||':'||gen_random_uuid(),'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_EXCEPTION_UPDATE','stock_order',target.id,
      jsonb_build_object('previous',previous,'status',p_status,'note',trim(p_note)));
  return target;
end $$;
revoke all on function public.update_stock_order_status(uuid,text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.update_stock_order_status(uuid,text,text,numeric,numeric,numeric) to authenticated;
commit;
