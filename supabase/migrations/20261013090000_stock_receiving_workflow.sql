begin;

alter table public.stock_order_items
  add column received_quantity integer not null default 0,
  add column warehouse_supplier_code text;
alter table public.stock_order_items
  add constraint stock_items_received_quantity_check
  check (received_quantity >= 0 and received_quantity <= quantity);

alter table public.stock_orders drop constraint if exists stock_orders_status_v2_check;
alter table public.stock_orders add constraint stock_orders_status_v2_check
  check (status in ('DRAFT','WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED','READY','SHORTAGE','CANCELLED'));
alter table public.sales_orders drop constraint if exists sales_orders_status_check;
alter table public.sales_orders add constraint sales_orders_status_check
  check (status in ('DRAFT','CONFIRMED','STOCK_DRAFT','WAITING_STOCK','PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED','READY','SHORTAGE','CANCELLED'));

create or replace function public.save_stock_receiving_details(p_stock_order_id uuid,p_items jsonb,p_expected_updated_at timestamptz)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; expected_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then raise exception '无仓库更新权限'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已由其他人更新，请刷新核对后重试'; end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','SHORTAGE') then
    raise exception '当前状态不允许修改回货记录'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception '回货明细格式不正确'; end if;
  select count(*) into expected_count from public.stock_order_items where stock_order_id=target.id;
  if (select count(*) from jsonb_array_elements(p_items))<>expected_count
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items) as x(line_number integer))<>expected_count
    or exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists(select 1 from public.stock_order_items i where i.stock_order_id=target.id and i.line_number=x.line_number))
  then raise exception '回货明细与备货单产品不一致'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer,received_quantity numeric,warehouse_supplier_code text)
    join public.stock_order_items i on i.stock_order_id=target.id and i.line_number=x.line_number
    where x.received_quantity is null or x.received_quantity<>trunc(x.received_quantity)
      or x.received_quantity<0 or x.received_quantity>i.quantity
      or length(coalesce(x.warehouse_supplier_code,''))>100)
  then raise exception '回货数必须是0至订购数量之间的整数，供应商编码不超过100字'; end if;
  update public.stock_order_items i set
    received_quantity=x.received_quantity::integer,
    warehouse_supplier_code=nullif(trim(coalesce(x.warehouse_supplier_code,'')),'')
  from jsonb_to_recordset(p_items) as x(line_number integer,received_quantity numeric,warehouse_supplier_code text)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  if target.status in ('RECEIVED','SORTING') and exists(
    select 1 from public.stock_order_items where stock_order_id=target.id and received_quantity<>quantity
  ) then raise exception '已回货或理货中的单据不得把回货数量改为未回齐'; end if;
  update public.stock_orders set updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_RECEIVING_UPDATE','stock_order',target.id,
    jsonb_build_object('items',p_items));
  return target;
end $$;
revoke execute on function public.save_stock_receiving_details(uuid,jsonb,timestamptz) from public,anon;
grant execute on function public.save_stock_receiving_details(uuid,jsonb,timestamptz) to authenticated;

create or replace function public.save_stock_order_procurement_costs(p_stock_order_id uuid,p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; expected_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.procurement.edit') then raise exception '无采购核价权限'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','SHORTAGE') then raise exception '当前备货状态不允许更新采购价'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception '采购价明细格式不正确'; end if;
  select count(*) into expected_count from public.stock_order_items where stock_order_id=target.id;
  if (select count(*) from jsonb_array_elements(p_items))<>expected_count
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items) as x(line_number integer))<>expected_count
    or exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists(select 1 from public.stock_order_items i where i.stock_order_id=target.id and i.line_number=x.line_number))
  then raise exception '采购价明细与备货单产品不一致'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(procurement_cost numeric)
    where x.procurement_cost<0 or x.procurement_cost>999999999999.99
      or x.procurement_cost<>round(x.procurement_cost,2))
  then raise exception '采购价必须为非负金额且最多两位小数'; end if;
  update public.stock_order_items i set procurement_cost=coalesce(x.procurement_cost,i.procurement_cost),
    procurement_cost_confirmed=(x.procurement_cost is not null)
  from jsonb_to_recordset(p_items) as x(line_number integer,procurement_cost numeric)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  update public.stock_orders set updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_PROCUREMENT_COST_UPDATE','stock_order',target.id,
    jsonb_build_object('confirmed_lines',(select count(*) from public.stock_order_items where stock_order_id=target.id and procurement_cost_confirmed)));
  return target;
end $$;
revoke execute on function public.save_stock_order_procurement_costs(uuid,jsonb) from public,anon;
grant execute on function public.save_stock_order_procurement_costs(uuid,jsonb) to authenticated;

create table public.stock_order_expenses (
  stock_order_id uuid primary key references public.stock_orders(id) on delete cascade,
  packaging_cost_cny numeric(14,2) not null check (packaging_cost_cny >= 0),
  procurement_expenses_cny numeric(14,2) not null check (procurement_expenses_cny >= 0),
  shipping_expenses_cny numeric(14,2) not null check (shipping_expenses_cny >= 0),
  updated_by uuid not null references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.stock_order_expenses enable row level security;
create policy stock_order_expenses_warehouse_read on public.stock_order_expenses for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE'
    and u.role in ('WAREHOUSE','ADMIN') and public.current_user_has_business_permission('stock.view')));
grant select on public.stock_order_expenses to authenticated;

create or replace function public.update_stock_order_status(
  p_stock_order_id uuid,p_status text,p_note text,
  p_packaging_cost_cny numeric,p_procurement_expenses_cny numeric,p_shipping_expenses_cny numeric)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; previous text; allowed boolean;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then raise exception '无仓库状态更新权限'; end if;
  if p_status not in ('PREPARING','RECEIVED','SORTING','READY_TO_SHIP','SHIPPED','SHORTAGE','CANCELLED') then raise exception '无效的备货状态'; end if;
  if p_status in ('SHORTAGE','CANCELLED','READY_TO_SHIP','SHIPPED') and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception '缺货、取消、待出货或已发货时必须填写处理或交接说明'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  previous:=target.status;
  allowed:=(previous='WAITING' and p_status in ('PREPARING','SHORTAGE','CANCELLED')) or
    (previous='PREPARING' and p_status in ('RECEIVED','SHORTAGE','CANCELLED')) or
    (previous='RECEIVED' and p_status in ('SORTING','SHORTAGE','CANCELLED')) or
    (previous='SORTING' and p_status in ('READY_TO_SHIP','SHORTAGE','CANCELLED')) or
    (previous='READY_TO_SHIP' and p_status in ('SHIPPED','CANCELLED')) or
    (previous='SHORTAGE' and p_status in ('PREPARING','CANCELLED'));
  if not allowed then raise exception '当前备货状态不能执行该流转'; end if;
  if p_status='SHIPPED' then
    if p_packaging_cost_cny is null or p_procurement_expenses_cny is null or p_shipping_expenses_cny is null
      or p_packaging_cost_cny<0 or p_procurement_expenses_cny<0 or p_shipping_expenses_cny<0
      or p_packaging_cost_cny>999999999999.99 or p_procurement_expenses_cny>999999999999.99
      or p_shipping_expenses_cny>999999999999.99
      or p_packaging_cost_cny<>round(p_packaging_cost_cny,2)
      or p_procurement_expenses_cny<>round(p_procurement_expenses_cny,2)
      or p_shipping_expenses_cny<>round(p_shipping_expenses_cny,2) then
      raise exception '已发货前必须填写非负、最多两位小数的包装费、采购发生费和出货发生费（无费用请填0）';
    end if;
    insert into public.stock_order_expenses(stock_order_id,packaging_cost_cny,procurement_expenses_cny,
      shipping_expenses_cny,updated_by)
    values(target.id,p_packaging_cost_cny,p_procurement_expenses_cny,p_shipping_expenses_cny,actor.id)
    on conflict(stock_order_id) do update set packaging_cost_cny=excluded.packaging_cost_cny,
      procurement_expenses_cny=excluded.procurement_expenses_cny,shipping_expenses_cny=excluded.shipping_expenses_cny,
      updated_by=excluded.updated_by,updated_at=now();
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_SHIPPING_EXPENSES_SET','stock_order',target.id,
      jsonb_build_object('packaging_cost_cny',p_packaging_cost_cny,
        'procurement_expenses_cny',p_procurement_expenses_cny,'shipping_expenses_cny',p_shipping_expenses_cny));
  elsif p_packaging_cost_cny is not null or p_procurement_expenses_cny is not null or p_shipping_expenses_cny is not null then
    raise exception '整单费用只能在确认已发货时填写';
  end if;
  if p_status='SHIPPED' and not exists(select 1 from public.stock_order_expenses where stock_order_id=target.id) then
    raise exception '备货单缺少整单费用，不能标记已发货';
  end if;
  if p_status in ('RECEIVED','SORTING','READY_TO_SHIP') and exists(
    select 1 from public.stock_order_items where stock_order_id=target.id and received_quantity<>quantity
  ) then raise exception '所有产品回货数量达到订购数量后才能进入此状态'; end if;
  update public.stock_orders set status=p_status,status_note=nullif(trim(coalesce(p_note,'')),''),
    ready_at=case when p_status='READY_TO_SHIP' then now() else ready_at end,
    updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  update public.sales_orders set status=case p_status when 'PREPARING' then 'PREPARING'
    when 'RECEIVED' then 'RECEIVED' when 'SORTING' then 'SORTING'
    when 'READY_TO_SHIP' then 'READY_TO_SHIP' when 'SHIPPED' then 'SHIPPED' when 'SHORTAGE' then 'SHORTAGE'
    else 'CANCELLED' end,updated_at=now() where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(target.id,previous,p_status,nullif(trim(coalesce(p_note,'')),''),actor.id);
  update public.system_notifications set action_status='RESOLVED'
  where entity_type='stock_order' and entity_id=target.id and type='STOCK_ORDER_CREATED';
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货状态已更新',
    format('订单 %s 的备货状态已更新为%s%s。',target.order_number,
      case p_status when 'PREPARING' then '备货中' when 'RECEIVED' then '已回货'
        when 'SORTING' then '理货中' when 'READY_TO_SHIP' then '待出货' when 'SHIPPED' then '已发货'
        when 'SHORTAGE' then '缺货异常' else '已取消' end,
      case when nullif(trim(coalesce(p_note,'')),'') is null then '' else '：'||trim(p_note) end),
    '/stock-orders/'||target.id,'stock_order',target.id,
    'stock-status:'||target.id||':'||p_status||':'||extract(epoch from target.updated_at)::bigint,'INFO');
  return target;
end $$;
revoke execute on function public.update_stock_order_status(uuid,text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.update_stock_order_status(uuid,text,text,numeric,numeric,numeric) to authenticated;

-- Existing three-argument callers may still update non-shipping states, but cannot
-- bypass the expense requirement by invoking the pre-migration RPC signature.
create or replace function public.update_stock_order_status(p_stock_order_id uuid,p_status text,p_note text default null)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
begin
  if p_status='SHIPPED' then raise exception '已发货须填写三项整单费用'; end if;
  return public.update_stock_order_status(p_stock_order_id,p_status,p_note,null,null,null);
end $$;
revoke execute on function public.update_stock_order_status(uuid,text,text) from public,anon;
grant execute on function public.update_stock_order_status(uuid,text,text) to authenticated;

create or replace function public.stock_order_dashboard()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE') then null else actor.id end;
  with scoped as (
    select s.* from public.stock_orders s where (scope_id is null or s.sales_user_id=scope_id)
      and (actor.role<>'WAREHOUSE' or s.status<>'DRAFT')
  ), recent_rows as (
    select s.id,s.quote_id,s.sales_order_id,s.quote_number,s.order_number,s.stock_number,s.sales_user_id,
      s.customer_short_name,s.destination_country,s.status,s.stocking_requirements,s.status_note,
      s.expected_ready_at,s.ready_at,s.created_at,s.updated_at,
      jsonb_build_object('name',u.name,'email',u.email) sales
    from scoped s left join public.users u on u.id=s.sales_user_id order by s.updated_at desc limit 10
  )
  select jsonb_build_object('counts',jsonb_build_object(
    'DRAFT',(select count(*) from scoped where status='DRAFT'),
    'WAITING',(select count(*) from scoped where status='WAITING'),
    'PREPARING',(select count(*) from scoped where status='PREPARING'),
    'RECEIVED',(select count(*) from scoped where status='RECEIVED'),
    'SORTING',(select count(*) from scoped where status='SORTING'),
    'READY_TO_SHIP',(select count(*) from scoped where status='READY_TO_SHIP'),
    'SHIPPED',(select count(*) from scoped where status='SHIPPED'),
    'SHORTAGE',(select count(*) from scoped where status='SHORTAGE'),
    'READY',(select count(*) from scoped where status='READY'),
    'CANCELLED',(select count(*) from scoped where status='CANCELLED')),
    'recent',coalesce((select jsonb_agg(to_jsonb(recent_rows) order by updated_at desc) from recent_rows),'[]'::jsonb)) into result;
  return result;
end $$;

commit;
