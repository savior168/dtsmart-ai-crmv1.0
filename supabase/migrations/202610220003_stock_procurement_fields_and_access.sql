begin;

alter table public.stock_order_items
  add column if not exists warehouse_note text
    check (warehouse_note is null or char_length(warehouse_note) <= 1000);

create or replace function public.save_stock_order_procurement_costs(p_stock_order_id uuid,p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; expected_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role <> 'WAREHOUSE'
    or not public.current_user_has_business_permission('stock.procurement.edit')
  then raise exception '无采购核价权限'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','SHORTAGE') then raise exception '当前备货状态不允许更新采购信息'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception '采购信息明细格式不正确'; end if;
  select count(*) into expected_count from public.stock_order_items where stock_order_id=target.id;
  if (select count(*) from jsonb_array_elements(p_items))<>expected_count
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items) as x(line_number integer))<>expected_count
    or exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists(select 1 from public.stock_order_items i where i.stock_order_id=target.id and i.line_number=x.line_number))
  then raise exception '采购信息明细与备货单产品不一致'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(procurement_cost numeric,warehouse_note text)
    where x.procurement_cost<0 or x.procurement_cost>999999999999.99
      or x.procurement_cost<>round(x.procurement_cost,2)
      or char_length(coalesce(x.warehouse_note,''))>1000)
  then raise exception '采购价必须为非负金额且最多两位小数；仓库备注最多1000字'; end if;
  update public.stock_order_items i set
    procurement_cost=coalesce(x.procurement_cost,i.procurement_cost),
    procurement_cost_confirmed=(x.procurement_cost is not null),
    warehouse_note=case when exists(
      select 1 from jsonb_array_elements(p_items) as supplied(value)
      where (supplied.value->>'line_number')::integer=i.line_number and supplied.value ? 'warehouse_note'
    ) then nullif(trim(coalesce(x.warehouse_note,'')),'') else i.warehouse_note end
  from jsonb_to_recordset(p_items) as x(line_number integer,procurement_cost numeric,warehouse_note text)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  update public.stock_orders set updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_PROCUREMENT_COST_UPDATE','stock_order',target.id,
    jsonb_build_object(
      'confirmed_lines',(select count(*) from public.stock_order_items where stock_order_id=target.id and procurement_cost_confirmed),
      'warehouse_note_lines',(select count(*) from public.stock_order_items where stock_order_id=target.id and warehouse_note is not null)
    ));
  return target;
end $$;
revoke execute on function public.save_stock_order_procurement_costs(uuid,jsonb) from public,anon;
grant execute on function public.save_stock_order_procurement_costs(uuid,jsonb) to authenticated;

commit;
