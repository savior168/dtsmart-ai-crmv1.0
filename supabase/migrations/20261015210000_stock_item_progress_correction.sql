begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create function public.correct_stock_item_progress(
  p_stock_order_id uuid,
  p_changes jsonb,
  p_expected_updated_at timestamptz,
  p_reason text
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  line public.stock_order_items;
  change record;
  amount_received integer;
  amount_prepared integer;
  next_line_status text;
  previous_status text;
  total_ordered bigint;
  total_received bigint;
  total_prepared bigint;
  total_shipped bigint;
  started_count bigint;
  next_status text;
  description text := '';
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库备货更新权限';
  end if;
  if nullif(trim(coalesce(p_reason,'')), '') is null or length(p_reason) > 1000 then
    raise exception '请填写更正原因（最多1000字）';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes) < 1 or jsonb_array_length(p_changes) > 500 then
    raise exception '请选择1至500项需要更正的产品';
  end if;
  if (select count(*) from jsonb_to_recordset(p_changes) as x(item_id uuid, received_quantity integer, prepared_quantity integer, supplier_code text, revert_start boolean))
    is distinct from
    (select count(distinct x.item_id) from jsonb_to_recordset(p_changes) as x(item_id uuid, received_quantity integer, prepared_quantity integer, supplier_code text, revert_start boolean)) then
    raise exception '同一产品不得重复更正';
  end if;
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已更新，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHORTAGE') then
    raise exception '当前备货单不能更正正常实物进度；已交货代单据请联系管理员处理';
  end if;
  previous_status := target.status;

  for change in select * from jsonb_to_recordset(p_changes) as x(
    item_id uuid, received_quantity integer, prepared_quantity integer,
    supplier_code text, revert_start boolean
  ) loop
    select * into line from public.stock_order_items
      where id = change.item_id and stock_order_id = target.id for update;
    if line.id is null then raise exception '产品明细不存在或不属于此备货单'; end if;
    amount_received := change.received_quantity;
    amount_prepared := change.prepared_quantity;
    if amount_received is null or amount_prepared is null or amount_received < 0
      or amount_prepared < 0 or amount_received > line.quantity
      or amount_prepared > amount_received or amount_prepared < line.shipped_quantity
      or amount_received < line.shipped_quantity or length(coalesce(change.supplier_code,'')) > 100 then
      raise exception '第%项更正数量无效，须满足已发货数≤理货数≤回货数≤订购数', line.line_number;
    end if;
    if coalesce(change.revert_start,false) then
      if line.preparation_status <> 'PREPARING' or line.received_quantity <> 0
        or line.prepared_quantity <> 0 or line.shipped_quantity <> 0
        or amount_received <> 0 or amount_prepared <> 0 then
        raise exception '仅可撤回尚无实物进度的误点采购操作';
      end if;
      next_line_status := 'WAITING';
      description := description || format('第%s项（%s）：撤回误点的开始采购，恢复为待采购；',
        line.line_number, coalesce(nullif(line.model, ''), line.item_name));
    else
      if amount_received = line.received_quantity
        and amount_prepared = line.prepared_quantity
        and nullif(trim(coalesce(change.supplier_code,'')), '') is not distinct from line.warehouse_supplier_code then
        raise exception '第%项更正内容未发生变化', line.line_number;
      end if;
      next_line_status := case
        when amount_prepared = line.quantity then 'READY_TO_SHIP'
        when amount_received = 0 and amount_prepared = 0 and line.preparation_status = 'WAITING' then 'WAITING'
        when amount_received < line.quantity then 'PREPARING'
        when amount_prepared > 0 then 'SORTING'
        else 'RECEIVED' end;
      description := description || format('第%s项（%s）：进度更正，累计回货%s→%s/%s件，累计理货%s→%s/%s件%s；',
        line.line_number, coalesce(nullif(line.model, ''), line.item_name),
        line.received_quantity, amount_received, line.quantity,
        line.prepared_quantity, amount_prepared, line.quantity,
        case when nullif(trim(coalesce(change.supplier_code,'')), '') is distinct from line.warehouse_supplier_code
          then '，供应商编码已更正' else '' end);
    end if;
    update public.stock_order_items set
      received_quantity = amount_received,
      prepared_quantity = amount_prepared,
      warehouse_supplier_code = nullif(trim(coalesce(change.supplier_code,'')), ''),
      preparation_status = next_line_status
      where id = line.id;
  end loop;

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
    status_note = trim(p_reason),
    updated_by = actor.id, updated_at = now()
    where id = target.id returning * into target;
  perform set_config('app.stock_item_transition','0',true);
  update public.sales_orders set status = case when next_status = 'WAITING' then 'WAITING_STOCK' else next_status end,
    updated_at = now() where id = target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
    values(target.id,previous_status,next_status,
      trim('进度更正：' || description || '更正原因：' || trim(p_reason)),actor.id);
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货进度已更正',
      left(format('%s 更正订单 %s：%s 原因：%s',coalesce(actor.name,actor.email),
        coalesce(target.warehouse_reference_number,target.order_number),description,trim(p_reason)),500),
      '/stock-orders/' || target.id,'stock_order',target.id,
      'stock-correction:' || target.id || ':' || gen_random_uuid(),'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_ITEM_PROGRESS_CORRECTION','stock_order',target.id,
      jsonb_build_object('changes',p_changes,'reason',trim(p_reason),
        'received',total_received,'prepared',total_prepared,'shipped',total_shipped));
  return target;
end $$;
revoke all on function public.correct_stock_item_progress(uuid,jsonb,timestamptz,text) from public,anon;
grant execute on function public.correct_stock_item_progress(uuid,jsonb,timestamptz,text) to authenticated;

commit;
