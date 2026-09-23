begin;

-- Older stock rows retain their value but are not treated as a verified purchase
-- price. Only a warehouse/authorized buyer can explicitly confirm it.
alter table public.stock_order_items
  add column if not exists procurement_cost_confirmed boolean not null default false;

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('WAREHOUSE','stock.procurement.edit',true)
on conflict(role_code,permission_code) do nothing;

create or replace function public.capture_stock_product_type_and_cost()
returns trigger language plpgsql set search_path=public as $$
declare source_item public.quote_items;
begin
  select qi.* into source_item from public.quote_items qi
  join public.stock_orders so on so.quote_id=qi.quote_id
  where so.id=new.stock_order_id and qi.line_number=new.line_number;
  if source_item.id is not null then
    new.product_type_snapshot := coalesce(new.product_type_snapshot,source_item.product_type_snapshot);
  end if;
  -- quote_items.unit_cost_cny is a total (purchase + packaging + other).
  -- It must never become the purchase-only price in a stock order.
  return new;
end $$;

create or replace function public.update_stock_order_draft(p_stock_order_id uuid,p_stocking_requirements text,p_expected_ready_at timestamptz,p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或备货单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只有订单归属销售员或系统管理员可以完善备货信息'; end if;
  if not public.current_user_has_business_permission('stock.prepare') then raise exception '无备货单完善权限'; end if;
  if target.status<>'DRAFT' then raise exception '备货单已提交仓库，不能再修改产品备货信息'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception '备货产品数据不正确'; end if;
  if (select count(*) from jsonb_array_elements(p_items))<>(select count(*) from public.stock_order_items where stock_order_id=target.id)
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items) as x(line_number integer))<>(select count(*) from public.stock_order_items where stock_order_id=target.id)
    or exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists(select 1 from public.stock_order_items i where i.stock_order_id=target.id and i.line_number=x.line_number))
  then raise exception '备货产品行与销售订单不一致'; end if;
  update public.stock_orders set stocking_requirements=nullif(trim(coalesce(p_stocking_requirements,'')),''),expected_ready_at=p_expected_ready_at,updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  update public.stock_order_items i set
    description_zh=nullif(trim(coalesce(x.description_zh,'')),''),
    preparation_requirement=nullif(trim(coalesce(x.preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(line_number integer,description_zh text,preparation_requirement text)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'STOCK_DRAFT_UPDATE','stock_order',target.id,jsonb_build_object('order_number',target.order_number));
  return target;
end $$;

create or replace function public.save_stock_order_procurement_costs(p_stock_order_id uuid,p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; expected_count integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.procurement.edit')
  then raise exception '无采购核价权限'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.status not in ('WAITING','PREPARING','SHORTAGE') then raise exception '当前备货状态不允许更新采购价'; end if;
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
  update public.stock_order_items i set
    procurement_cost=coalesce(x.procurement_cost,i.procurement_cost),
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

commit;
