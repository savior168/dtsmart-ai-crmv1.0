-- Each handoff ships complete product lines only. Costs belong to the handoff,
-- while stock_order_expenses remains the aggregate for existing reports.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.stock_order_shipments (
  id uuid primary key default gen_random_uuid(),
  stock_order_id uuid not null references public.stock_orders(id) on delete cascade,
  item_ids uuid[] not null check (cardinality(item_ids) between 1 and 500),
  packaging_cost_cny numeric(14,2) not null check (packaging_cost_cny >= 0),
  procurement_expenses_cny numeric(14,2) not null check (procurement_expenses_cny >= 0),
  shipping_expenses_cny numeric(14,2) not null check (shipping_expenses_cny >= 0),
  handoff_note text not null check (length(trim(handoff_note)) between 1 and 1000),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);
create index stock_order_shipments_order_created_idx
  on public.stock_order_shipments(stock_order_id,created_at desc);
alter table public.stock_order_shipments enable row level security;
create policy stock_order_shipments_warehouse_read on public.stock_order_shipments
  for select to authenticated using (
    exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE'
      and u.role in ('WAREHOUSE','ADMIN') and public.current_user_has_business_permission('stock.view'))
  );
revoke all on table public.stock_order_shipments from public,anon,authenticated;
grant select on table public.stock_order_shipments to authenticated;

-- The old record_stock_progress('SHIP') call has no cost arguments. Reject its
-- shipped-quantity write at the database boundary, including stale browser tabs.
create function public.require_costed_stock_shipment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.preparation_status is distinct from old.preparation_status
      or new.shipped_quantity is distinct from old.shipped_quantity)
    and ((new.shipped_quantity = new.quantity and new.preparation_status <> 'SHIPPED')
      or (new.shipped_quantity <> new.quantity and new.preparation_status = 'SHIPPED')) then
    raise exception '产品发货数量与单项状态不一致，请刷新后重试';
  end if;
  if new.shipped_quantity is distinct from old.shipped_quantity
    and current_setting('app.costed_stock_shipment',true) is distinct from '1' then
    raise exception '交货代请刷新页面并通过填写三项人民币费用的发货入口操作';
  end if;
  return new;
end $$;
create trigger require_costed_stock_shipment_before_update
before update of shipped_quantity,preparation_status on public.stock_order_items for each row
execute function public.require_costed_stock_shipment();
revoke all on function public.require_costed_stock_shipment() from public,anon,authenticated;

create function public.record_stock_shipment(
  p_stock_order_id uuid, p_item_ids uuid[], p_expected_updated_at timestamptz,
  p_note text, p_packaging_cost_cny numeric,
  p_procurement_expenses_cny numeric, p_shipping_expenses_cny numeric
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  selected_count integer;
  total_ordered bigint;
  total_received bigint;
  total_prepared bigint;
  total_shipped bigint;
  started_count bigint;
  shipped_lines text;
  previous_status text;
  next_status text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库交货代权限';
  end if;
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500
    or array_position(p_item_ids,null) is not null
    or (select count(distinct selected.id) from unnest(p_item_ids) as selected(id)) <> cardinality(p_item_ids) then
    raise exception '请选择1至500项不重复的完整产品行';
  end if;
  if nullif(trim(coalesce(p_note,'')),'') is null or length(p_note)>1000 then
    raise exception '请填写货代交接信息（最多1000字）';
  end if;
  if p_packaging_cost_cny is null or p_procurement_expenses_cny is null
    or p_shipping_expenses_cny is null or p_packaging_cost_cny<0
    or p_procurement_expenses_cny<0 or p_shipping_expenses_cny<0
    or p_packaging_cost_cny>999999999999.99
    or p_procurement_expenses_cny>999999999999.99
    or p_shipping_expenses_cny>999999999999.99
    or p_packaging_cost_cny<>round(p_packaging_cost_cny,2)
    or p_procurement_expenses_cny<>round(p_procurement_expenses_cny,2)
    or p_shipping_expenses_cny<>round(p_shipping_expenses_cny,2) then
    raise exception '三项人民币费用均必填非负金额，最多两位小数；无费用请填0';
  end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已更新，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP') then
    raise exception '当前备货单不能交货代';
  end if;
  previous_status := target.status;
  -- Parent lock serializes all supported stock actions. Lock selected rows too,
  -- so every line is validated against its current physical quantities.
  perform 1 from public.stock_order_items i
    where i.stock_order_id=target.id and i.id=any(p_item_ids)
    order by i.id for update;
  select count(*), string_agg(format('第%s项（%s）%s件',i.line_number,
    coalesce(nullif(i.model,''),i.item_name),i.quantity), '；' order by i.line_number)
    into selected_count,shipped_lines
    from public.stock_order_items i
    where i.stock_order_id=target.id and i.id=any(p_item_ids)
      and i.received_quantity=i.quantity and i.prepared_quantity=i.quantity
      and i.shipped_quantity=0;
  if selected_count<>cardinality(p_item_ids) then
    raise exception '所选产品必须整行回齐、完成理货且尚未交货代；请刷新后重选';
  end if;
  perform set_config('app.costed_stock_shipment','1',true);
  update public.stock_order_items set shipped_quantity=quantity,preparation_status='SHIPPED'
    where stock_order_id=target.id and id=any(p_item_ids);
  perform set_config('app.costed_stock_shipment','0',true);
  insert into public.stock_order_shipments(stock_order_id,item_ids,packaging_cost_cny,
    procurement_expenses_cny,shipping_expenses_cny,handoff_note,created_by)
    values(target.id,p_item_ids,p_packaging_cost_cny,p_procurement_expenses_cny,
      p_shipping_expenses_cny,trim(p_note),actor.id);
  insert into public.stock_order_expenses(stock_order_id,packaging_cost_cny,
    procurement_expenses_cny,shipping_expenses_cny,updated_by)
    values(target.id,p_packaging_cost_cny,p_procurement_expenses_cny,
      p_shipping_expenses_cny,actor.id)
    on conflict(stock_order_id) do update set
      packaging_cost_cny=public.stock_order_expenses.packaging_cost_cny+excluded.packaging_cost_cny,
      procurement_expenses_cny=public.stock_order_expenses.procurement_expenses_cny+excluded.procurement_expenses_cny,
      shipping_expenses_cny=public.stock_order_expenses.shipping_expenses_cny+excluded.shipping_expenses_cny,
      updated_by=excluded.updated_by,updated_at=now();

  select coalesce(sum(quantity),0),coalesce(sum(received_quantity),0),
    coalesce(sum(prepared_quantity),0),coalesce(sum(shipped_quantity),0),
    count(*) filter(where preparation_status<>'WAITING')
    into total_ordered,total_received,total_prepared,total_shipped,started_count
    from public.stock_order_items where stock_order_id=target.id;
  next_status := case
    when total_shipped=total_ordered then 'SHIPPED'
    when total_prepared=total_ordered then 'READY_TO_SHIP'
    when total_received=total_ordered and total_prepared>0 then 'SORTING'
    when total_received=total_ordered then 'RECEIVED'
    when started_count>0 then 'PREPARING'
    else 'WAITING' end;
  perform set_config('app.stock_item_transition','1',true);
  update public.stock_orders set status=next_status,status_note=trim(p_note),
    updated_by=actor.id,updated_at=now()
    where id=target.id returning * into target;
  perform set_config('app.stock_item_transition','0',true);
  update public.sales_orders set status=case when next_status='WAITING' then 'WAITING_STOCK' else next_status end,
    updated_at=now() where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
    values(target.id,previous_status,next_status,
      left('交货代：'||shipped_lines||'；交接信息：'||trim(p_note)||
        format('；本次费用（人民币）包装¥%s、采购其他¥%s、出货其他¥%s',
          p_packaging_cost_cny,p_procurement_expenses_cny,p_shipping_expenses_cny),3000),actor.id);
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货产品已交货代',
      left(format('%s 将订单 %s 的 %s 项完整产品行交给货代，请及时查看。',
        coalesce(actor.name,actor.email),
        coalesce(target.warehouse_reference_number,target.order_number),selected_count),500),
      '/stock-orders/'||target.id,'stock_order',target.id,
      'stock-shipment:'||target.id||':'||gen_random_uuid(),'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_LINE_SHIPMENT','stock_order',target.id,
      jsonb_build_object('item_ids',p_item_ids,'note',trim(p_note),
        'packaging_cost_cny',p_packaging_cost_cny,
        'procurement_expenses_cny',p_procurement_expenses_cny,
        'shipping_expenses_cny',p_shipping_expenses_cny,
        'shipped_units',total_shipped,'result_status',next_status));
  return target;
end $$;
revoke all on function public.record_stock_shipment(uuid,uuid[],timestamptz,text,numeric,numeric,numeric)
  from public,anon;
grant execute on function public.record_stock_shipment(uuid,uuid[],timestamptz,text,numeric,numeric,numeric)
  to authenticated;
commit;
