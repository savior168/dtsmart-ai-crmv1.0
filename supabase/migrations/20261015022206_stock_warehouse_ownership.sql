begin;

-- Sales can change stock requirements through the PI/quote source only.
-- Warehouse owns every editable stock draft, including legacy quote orders.
insert into public.role_permission_settings(role_code, permission_code, enabled)
values
  ('SALES', 'stock.prepare', false),
  ('SALES', 'stock.submit', false),
  ('SUPERVISOR', 'stock.prepare', false),
  ('SUPERVISOR', 'stock.submit', false),
  ('WAREHOUSE', 'stock.prepare', true),
  ('WAREHOUSE', 'stock.submit', true),
  ('ADMIN', 'stock.prepare', true),
  ('ADMIN', 'stock.submit', true)
on conflict (role_code, permission_code) do update set enabled = excluded.enabled;

-- Retire the sales-owned legacy RPC entry points. Their internal functions
-- remain for migration compatibility but are not executable by API roles.
revoke execute on function public.update_stock_order_draft(uuid,text,timestamptz,jsonb)
  from public,anon,authenticated;
revoke execute on function public.submit_stock_order(uuid)
  from public,anon,authenticated;

create function public.warehouse_prepare_stock_draft(
  p_stock_order_id uuid, p_stocking_requirements text,
  p_expected_ready_at timestamptz, p_items jsonb
) returns public.stock_orders
language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.prepare') then
    raise exception '只有仓库员可以完善备货单';
  end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.status<>'DRAFT' then raise exception '当前备货状态不能修改'; end if;
  if exists(select 1 from public.sales_orders so
    where so.id=target.sales_order_id and so.confirmation_method='DIRECT_PI') then
    raise exception 'PI备货内容只能由销售修改PI后重新提交';
  end if;
  if jsonb_typeof(p_items)<>'array' then raise exception '备货产品数据不正确'; end if;
  if (select count(*) from jsonb_array_elements(p_items))
      <> (select count(*) from public.stock_order_items where stock_order_id=target.id)
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items)
      as x(line_number integer))
      <> (select count(*) from public.stock_order_items where stock_order_id=target.id)
    or exists(select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists(select 1 from public.stock_order_items i
        where i.stock_order_id=target.id and i.line_number=x.line_number)) then
    raise exception '备货产品行与销售订单不一致';
  end if;
  update public.stock_orders set
    stocking_requirements=nullif(trim(coalesce(p_stocking_requirements,'')),''),
    expected_ready_at=p_expected_ready_at,updated_by=actor.id,updated_at=now()
  where id=target.id returning * into target;
  update public.stock_order_items i set
    description_zh=nullif(trim(coalesce(x.description_zh,'')),''),
    preparation_requirement=nullif(trim(coalesce(x.preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items)
    as x(line_number integer,description_zh text,preparation_requirement text)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_DRAFT_UPDATE','stock_order',target.id,
    jsonb_build_object('order_number',coalesce(target.warehouse_reference_number,target.order_number)));
  return target;
end $$;
revoke execute on function public.warehouse_prepare_stock_draft(uuid,text,timestamptz,jsonb)
  from public,anon;
grant execute on function public.warehouse_prepare_stock_draft(uuid,text,timestamptz,jsonb)
  to authenticated;

create function public.warehouse_submit_stock_draft(p_stock_order_id uuid)
returns public.stock_orders
language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.submit') then
    raise exception '只有仓库员可以提交备货草稿';
  end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  if target.status<>'DRAFT' then raise exception '只有待完善备货单可以提交'; end if;
  if exists(select 1 from public.sales_orders so
    where so.id=target.sales_order_id and so.confirmation_method='DIRECT_PI') then
    raise exception 'PI备货单只能由销售确认PI时提交';
  end if;
  if nullif(trim(coalesce(target.stocking_requirements,'')),'') is null then
    raise exception '请填写整单备货要求';
  end if;
  if exists(select 1 from public.stock_order_items
    where stock_order_id=target.id
      and nullif(trim(coalesce(description_zh,'')),'') is null) then
    raise exception '请填写每项产品的中文质量或描述';
  end if;
  update public.stock_orders set status='WAITING',updated_by=actor.id,updated_at=now()
  where id=target.id returning * into target;
  update public.sales_orders set status='WAITING_STOCK',updated_at=now()
  where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(target.id,'DRAFT','WAITING','仓库员完善并确认备货草稿',actor.id);
  insert into public.system_notifications(
    recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status
  )
  values(
    target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货单已确认',
    format('%s 已确认订单 %s 的备货单。',coalesce(actor.name,actor.email),
      coalesce(target.warehouse_reference_number,target.order_number)),
    '/stock-orders/'||target.id,'stock_order',target.id,
    'warehouse-stock-submit:'||target.id,'INFO'
  );
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'STOCK_SUBMIT','stock_order',target.id,
    jsonb_build_object('order_number',coalesce(target.warehouse_reference_number,target.order_number)));
  return target;
end $$;
revoke execute on function public.warehouse_submit_stock_draft(uuid)
  from public,anon;
grant execute on function public.warehouse_submit_stock_draft(uuid)
  to authenticated;

-- Recalled direct PI drafts stay hidden from warehouse; legacy stock drafts
-- become visible so that existing records can be completed instead of stranded.
-- Warehouse has no sales_orders SELECT policy. Resolve the linked order type
-- through a narrowly scoped definer helper rather than an RLS-filtered subquery.
create function public.is_legacy_stock_sales_order(p_sales_order_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.sales_orders so where so.id=p_sales_order_id
    and so.confirmation_method is distinct from 'DIRECT_PI');
$$;
revoke execute on function public.is_legacy_stock_sales_order(uuid) from public,anon;
grant execute on function public.is_legacy_stock_sales_order(uuid) to authenticated;
drop policy if exists stock_orders_scope_select_v6 on public.stock_orders;
create policy stock_orders_scope_select_v7 on public.stock_orders for select to authenticated
using(
  sales_user_id=auth.uid() or public.current_user_is_admin()
  or (public.current_user_is_warehouse() and (
    status<>'DRAFT' or public.is_legacy_stock_sales_order(sales_order_id)
  ))
);
drop policy if exists stock_items_scope_select_v6 on public.stock_order_items;
create policy stock_items_scope_select_v7 on public.stock_order_items for select to authenticated
using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (
  s.sales_user_id=auth.uid() or public.current_user_is_admin()
  or (public.current_user_is_warehouse() and (
    s.status<>'DRAFT' or public.is_legacy_stock_sales_order(s.sales_order_id)
  ))
)));
drop policy if exists stock_events_scope_select_v6 on public.stock_order_events;
create policy stock_events_scope_select_v7 on public.stock_order_events for select to authenticated
using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (
  s.sales_user_id=auth.uid() or public.current_user_is_admin()
  or (public.current_user_is_warehouse() and (
    s.status<>'DRAFT' or public.is_legacy_stock_sales_order(s.sales_order_id)
  ))
)));

-- PI ownership must hold at the database boundary as well as in list APIs.
drop policy if exists sales_orders_scope_select_v6 on public.sales_orders;
create policy sales_orders_scope_select_v7 on public.sales_orders for select to authenticated
using(sales_user_id=auth.uid() or public.current_user_is_admin());
drop policy if exists sales_order_items_scope_select_v6 on public.sales_order_items;
create policy sales_order_items_scope_select_v7 on public.sales_order_items for select to authenticated
using(exists(select 1 from public.sales_orders o where o.id=sales_order_id
  and (o.sales_user_id=auth.uid() or public.current_user_is_admin())));

create or replace function public.stock_order_dashboard()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE') then null else actor.id end;
  with scoped as (
    select s.* from public.stock_orders s where (scope_id is null or s.sales_user_id=scope_id)
      and (actor.role<>'WAREHOUSE' or s.status<>'DRAFT'
        or exists(select 1 from public.sales_orders so
          where so.id=s.sales_order_id and so.confirmation_method is distinct from 'DIRECT_PI'))
  ), recent_rows as (
    select s.id,s.quote_id,s.sales_order_id,s.quote_number,s.order_number,s.warehouse_reference_number,s.stock_number,s.sales_user_id,
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
    'recent',coalesce((select jsonb_agg(to_jsonb(recent_rows) order by updated_at desc)
      from recent_rows),'[]'::jsonb)) into result;
  return result;
end $$;

-- New legacy quote orders enter the warehouse queue immediately.
create function public.notify_warehouse_legacy_stock_draft()
returns trigger language plpgsql security definer set search_path=public as $$
declare operator_name text;
begin
  if new.status<>'DRAFT' or not exists(select 1 from public.sales_orders so
    where so.id=new.sales_order_id and so.confirmation_method is distinct from 'DIRECT_PI') then
    return new;
  end if;
  select coalesce(u.name,u.email,'销售员') into operator_name from public.users u
  where u.id=new.updated_by;
  insert into public.system_notifications(
    recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status
  )
  select u.id,'STOCK_ORDER_CREATED','STOCK','新备货草稿待完善',
    format('%s 已确认订单 %s，请完善备货信息。',coalesce(operator_name,'销售员'),
      coalesce(new.warehouse_reference_number,new.order_number)),
    '/stock-orders/'||new.id,'stock_order',new.id,
    'legacy-stock-draft:'||new.id,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  return new;
end $$;
revoke execute on function public.notify_warehouse_legacy_stock_draft()
  from public,anon,authenticated;
create trigger notify_warehouse_legacy_stock_draft_after_insert
after insert on public.stock_orders for each row
execute function public.notify_warehouse_legacy_stock_draft();

commit;
