begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Keep item_ids for existing consumers and historical handoffs. New handoffs
-- additionally retain the exact quantity of each product handed to the carrier.
alter table public.stock_order_shipments add column shipment_lines jsonb;
alter table public.stock_order_shipments add constraint stock_order_shipments_lines_check
  check (shipment_lines is null or jsonb_typeof(shipment_lines) = 'array');

create function public.record_stock_shipment_quantities(
  p_stock_order_id uuid, p_lines jsonb, p_expected_updated_at timestamptz,
  p_note text, p_packaging_cost_cny numeric,
  p_procurement_expenses_cny numeric, p_shipping_expenses_cny numeric
) returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  line public.stock_order_items;
  selection jsonb;
  item_id uuid;
  handoff_quantity integer;
  item_ids uuid[] := array[]::uuid[];
  normalized_lines jsonb := '[]'::jsonb;
  shipped_lines text := '';
  handoff_units bigint := 0;
  total_ordered bigint;
  total_received bigint;
  total_prepared bigint;
  total_shipped bigint;
  started_count bigint;
  previous_status text;
  next_status text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update') then
    raise exception '无仓库交货代权限';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 500
    or exists(select 1 from jsonb_array_elements(p_lines) as x(value)
      where jsonb_typeof(x.value) <> 'object'
        or coalesce(x.value->>'item_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or coalesce(x.value->>'quantity','') !~ '^[1-9][0-9]{0,8}$')
    or (select count(distinct x.value->>'item_id') from jsonb_array_elements(p_lines) as x(value))
      <> jsonb_array_length(p_lines) then
    raise exception '请选择1至500项产品，并逐项填写不重复的正整数交货数量';
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
  perform set_config('app.costed_stock_shipment','1',true);
  for selection in select x.value from jsonb_array_elements(p_lines) as x(value)
    order by x.value->>'item_id' loop
    item_id := (selection->>'item_id')::uuid;
    handoff_quantity := (selection->>'quantity')::integer;
    select * into line from public.stock_order_items
      where id=item_id and stock_order_id=target.id for update;
    if line.id is null or line.pi_amendment_cancelled_at is not null
      or handoff_quantity > line.prepared_quantity-line.shipped_quantity then
      raise exception '所选产品不存在、已删除或本次交货数量超过已理货未交货数量；请刷新后重试';
    end if;
    update public.stock_order_items set shipped_quantity=shipped_quantity+handoff_quantity,
      preparation_status=case when shipped_quantity+handoff_quantity=quantity
        then 'SHIPPED' else preparation_status end
      where id=item_id;
    item_ids := array_append(item_ids,item_id);
    normalized_lines := normalized_lines || jsonb_build_array(
      jsonb_build_object('item_id',item_id,'quantity',handoff_quantity));
    handoff_units := handoff_units+handoff_quantity;
    shipped_lines := shipped_lines || format('第%s项（%s）%s件；',line.line_number,
      coalesce(nullif(line.model,''),line.item_name),handoff_quantity);
  end loop;
  perform set_config('app.costed_stock_shipment','0',true);
  insert into public.stock_order_shipments(stock_order_id,item_ids,shipment_lines,
    packaging_cost_cny,procurement_expenses_cny,shipping_expenses_cny,handoff_note,created_by)
    values(target.id,item_ids,normalized_lines,p_packaging_cost_cny,p_procurement_expenses_cny,
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
      left('交货代：'||shipped_lines||'交接信息：'||trim(p_note)||
        format('；本次费用（人民币）包装¥%s、采购其他¥%s、出货其他¥%s',
          p_packaging_cost_cny,p_procurement_expenses_cny,p_shipping_expenses_cny),3000),actor.id);
  insert into public.system_notifications
    (recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货产品已交货代',
      left(format('%s 将订单 %s 的 %s 项、共 %s 件产品交给货代，请及时查看。',
        coalesce(actor.name,actor.email),
        coalesce(target.warehouse_reference_number,target.order_number),
        cardinality(item_ids),handoff_units),500),
      '/stock-orders/'||target.id,'stock_order',target.id,
      'stock-shipment:'||target.id||':'||gen_random_uuid(),'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'STOCK_LINE_SHIPMENT','stock_order',target.id,
      jsonb_build_object('item_ids',item_ids,'shipment_lines',normalized_lines,'note',trim(p_note),
        'packaging_cost_cny',p_packaging_cost_cny,
        'procurement_expenses_cny',p_procurement_expenses_cny,
        'shipping_expenses_cny',p_shipping_expenses_cny,
        'shipped_units',total_shipped,'result_status',next_status));
  return target;
end $$;
revoke all on function public.record_stock_shipment_quantities(uuid,jsonb,timestamptz,text,numeric,numeric,numeric)
  from public,anon;
grant execute on function public.record_stock_shipment_quantities(uuid,jsonb,timestamptz,text,numeric,numeric,numeric)
  to authenticated;

-- The remaining quantity may still arrive after an earlier partial handoff.
do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.record_supplier_receipt(uuid,uuid,uuid,text,date,integer,numeric,timestamptz,text,numeric)'::regprocedure);
  if strpos(definition,'item.shipped_quantity > 0')=0 then
    raise exception 'single receipt shipment guard changed; review migration';
  end if;
  execute replace(definition,'item.shipped_quantity > 0','item.shipped_quantity >= item.quantity');
  definition := pg_get_functiondef('public.record_supplier_receipts_batch(uuid,jsonb,timestamptz,text)'::regprocedure);
  if strpos(definition,'item.shipped_quantity > 0')=0 then
    raise exception 'batch receipt shipment guard changed; review migration';
  end if;
  execute replace(definition,'item.shipped_quantity > 0','item.shipped_quantity >= item.quantity');
end;
$migration$;
commit;
