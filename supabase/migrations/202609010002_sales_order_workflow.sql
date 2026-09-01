-- Complete sales hand-off: customer quotation -> immutable sales order -> stock preparation.
-- User-facing order numbers are entered by sales and are unique; UUIDs remain the internal identity.

begin;

alter table public.quotes drop constraint if exists quotes_status_v2_check;
alter table public.quotes add constraint quotes_status_v3_check
  check (status in ('DRAFT','GENERATED','SENT','CONFIRMED','SUPERSEDED','EXPIRED','CANCELLED'));
alter table public.quotes add column if not exists supersedes_quote_id uuid references public.quotes(id) on delete restrict;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  quote_id uuid not null unique references public.quotes(id) on delete restrict,
  quote_number text not null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  sales_user_id uuid not null references public.users(id),
  customer_short_name text not null,
  destination_country text,
  currency text not null,
  subtotal numeric(14,2) not null default 0,
  shipping_cost numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  payment_method text,
  delivery_date date,
  confirmation_method text,
  confirmation_note text,
  status text not null default 'STOCK_DRAFT' check (status in ('CONFIRMED','STOCK_DRAFT','WAITING_STOCK','PREPARING','READY','SHORTAGE','CANCELLED')),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  line_number integer not null,
  item_name text not null,
  brand text,
  model text,
  quality text,
  description text,
  quantity numeric(12,2) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  amount numeric(14,2) generated always as (quantity * unit_price) stored,
  unique(sales_order_id,line_number)
);

alter table public.stock_orders add column if not exists sales_order_id uuid references public.sales_orders(id) on delete restrict;
alter table public.stock_orders add column if not exists order_number text;
alter table public.stock_orders drop constraint if exists stock_orders_status_check;
alter table public.stock_orders add constraint stock_orders_status_v2_check
  check (status in ('DRAFT','WAITING','PREPARING','READY','SHORTAGE','CANCELLED'));

-- Preserve old confirmed work as auditable legacy sales-order snapshots.
insert into public.sales_orders(order_number,quote_id,quote_number,customer_id,sales_user_id,customer_short_name,destination_country,currency,
  subtotal,shipping_cost,total_amount,payment_method,delivery_date,confirmation_method,confirmation_note,status,confirmed_at,confirmed_by,created_at,updated_at)
select 'LEGACY-'||q.quote_number,q.id,q.quote_number,q.customer_id,q.owner_id,
  coalesce(nullif(q.customer_short_name,''),c.company_name,'未命名客户'),coalesce(q.destination_country,c.country),q.currency,
  q.subtotal,q.shipping_cost,q.total_amount,q.payment_method,q.delivery_date,'历史迁移','系统升级前已确认报价',
  case s.status when 'WAITING' then 'WAITING_STOCK' when 'PREPARING' then 'PREPARING' when 'READY' then 'READY' when 'SHORTAGE' then 'SHORTAGE' when 'CANCELLED' then 'CANCELLED' else 'STOCK_DRAFT' end,
  coalesce(q.customer_confirmed_at,s.created_at),coalesce(q.confirmed_by,q.owner_id),s.created_at,s.updated_at
from public.stock_orders s join public.quotes q on q.id=s.quote_id join public.customers c on c.id=q.customer_id
where not exists(select 1 from public.sales_orders so where so.quote_id=q.id)
on conflict do nothing;

insert into public.sales_order_items(sales_order_id,line_number,item_name,brand,model,quality,description,quantity,unit_price)
select so.id,qi.line_number,qi.item_name,qi.brand,qi.model,qi.quality,qi.description,qi.quantity,qi.unit_price
from public.sales_orders so join public.quote_items qi on qi.quote_id=so.quote_id
where not exists(select 1 from public.sales_order_items oi where oi.sales_order_id=so.id)
on conflict do nothing;

update public.stock_orders s set sales_order_id=so.id,order_number=so.order_number
from public.sales_orders so where so.quote_id=s.quote_id and (s.sales_order_id is null or s.order_number is null);
alter table public.stock_orders alter column sales_order_id set not null;
alter table public.stock_orders alter column order_number set not null;
create unique index if not exists stock_orders_sales_order_unique on public.stock_orders(sales_order_id);
create unique index if not exists sales_orders_order_number_ci_unique on public.sales_orders(lower(order_number));
alter table public.stock_orders drop constraint if exists stock_orders_order_number_fkey;
alter table public.stock_orders add constraint stock_orders_order_number_fkey foreign key(order_number) references public.sales_orders(order_number) on delete restrict;
create index if not exists sales_orders_owner_updated_idx on public.sales_orders(sales_user_id,updated_at desc);
create index if not exists sales_orders_status_updated_idx on public.sales_orders(status,updated_at desc);

create or replace function public.confirm_quote_create_sales_order(
  p_quote_id uuid,p_order_number text,p_confirmation_method text default null,p_confirmation_note text default null
) returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.quotes; customer public.customers; created_order public.sales_orders; created_stock public.stock_orders; stock_no text; clean_order text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  clean_order:=trim(coalesce(p_order_number,''));
  if actor.id is null then raise exception '当前账号无效'; end if;
  if clean_order='' then raise exception '请输入客户确认后的订单编号'; end if;
  if length(clean_order)>80 then raise exception '订单编号不能超过80个字符'; end if;
  if exists(select 1 from public.sales_orders where lower(order_number)=lower(clean_order)) then raise exception '订单编号已存在，请核对后重新填写'; end if;
  select * into target from public.quotes where id=p_quote_id for update;
  if target.id is null then raise exception '报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只有报价归属销售员或系统管理员可以确认客户'; end if;
  if target.status not in ('GENERATED','SENT') then raise exception '只有待发送或已发送报价可以确认'; end if;
  if target.valid_until is not null and target.valid_until<current_date then raise exception '报价已过有效期，请先创建新版本'; end if;
  if not exists(select 1 from public.quote_items where quote_id=target.id) then raise exception '报价单没有产品明细'; end if;
  select * into customer from public.customers where id=target.customer_id;
  update public.quotes set status='CONFIRMED',customer_confirmed_at=now(),confirmed_by=actor.id,updated_at=now() where id=target.id;
  insert into public.sales_orders(order_number,quote_id,quote_number,customer_id,sales_user_id,customer_short_name,destination_country,currency,
    subtotal,shipping_cost,total_amount,payment_method,delivery_date,confirmation_method,confirmation_note,status,confirmed_by)
  values(clean_order,target.id,target.quote_number,target.customer_id,target.owner_id,
    coalesce(nullif(target.customer_short_name,''),customer.company_name,'未命名客户'),coalesce(target.destination_country,customer.country),target.currency,
    target.subtotal,target.shipping_cost,target.total_amount,target.payment_method,target.delivery_date,
    nullif(trim(coalesce(p_confirmation_method,'')),''),nullif(trim(coalesce(p_confirmation_note,'')),''),'STOCK_DRAFT',actor.id)
  returning * into created_order;
  insert into public.sales_order_items(sales_order_id,line_number,item_name,brand,model,quality,description,quantity,unit_price)
  select created_order.id,line_number,item_name,brand,model,quality,description,quantity,unit_price from public.quote_items where quote_id=target.id order by line_number;
  stock_no:='BH-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.stock_orders(quote_id,sales_order_id,quote_number,order_number,stock_number,sales_user_id,customer_short_name,destination_country,status,updated_by)
  values(target.id,created_order.id,target.quote_number,created_order.order_number,stock_no,target.owner_id,created_order.customer_short_name,created_order.destination_country,'DRAFT',actor.id)
  returning * into created_stock;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,quality,description,description_zh,procurement_cost,quantity,preparation_requirement)
  select created_stock.id,line_number,item_name,brand,model,quality,description,null,0,quantity,null from public.quote_items where quote_id=target.id order by line_number;
  insert into public.stock_order_events(stock_order_id,to_status,note,created_by) values(created_stock.id,'DRAFT','订单已创建，等待销售员完善备货信息',actor.id);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SALES_ORDER_CREATE','sales_order',created_order.id,jsonb_build_object('order_number',clean_order,'quote_number',target.quote_number,'stock_order_id',created_stock.id));
  return created_order;
end $$;

create or replace function public.revise_quote(p_quote_id uuid)
returns public.quotes language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.quotes; revised public.quotes; next_no text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.quotes where id=p_quote_id for update;
  if actor.id is null or target.id is null then raise exception '账号或报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能为归属自己的报价创建新版本'; end if;
  if target.status not in ('SENT','EXPIRED','CANCELLED') then raise exception '当前报价无需创建新版本'; end if;
  if exists(select 1 from public.sales_orders where quote_id=target.id) then raise exception '已形成订单的报价不能直接修订，请先按订单取消流程处理'; end if;
  next_no:='PI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,valid_until,notes,version,subtotal,shipping_cost,total_amount,payment_method,delivery_date,customer_short_name,destination_country,supersedes_quote_id)
  values(target.customer_id,actor.id,target.owner_id,next_no,target.currency,target.total_amount,'DRAFT',target.valid_until,target.notes,target.version+1,target.subtotal,target.shipping_cost,target.total_amount,target.payment_method,target.delivery_date,target.customer_short_name,target.destination_country,target.id)
  returning * into revised;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,preparation_requirement)
  select revised.id,line_number,item_name,brand,model,quality,description,null,quantity,unit_price,0,null from public.quote_items where quote_id=target.id order by line_number;
  update public.quotes set status='SUPERSEDED',updated_at=now() where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'QUOTE_REVISE','quote',revised.id,jsonb_build_object('previous_quote_id',target.id,'previous_quote_number',target.quote_number,'new_quote_number',next_no));
  return revised;
end $$;

create or replace function public.update_quote_customer_fields(
  p_quote_id uuid,p_status text,p_currency text,p_valid_until date,p_payment_method text,p_delivery_date date,
  p_customer_short_name text,p_destination_country text,p_shipping_cost numeric,p_notes text,p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
declare target public.quotes; clean_items jsonb;
begin
  select * into target from public.quotes where id=p_quote_id;
  if target.id is null then raise exception '报价单不存在'; end if;
  if target.status not in ('DRAFT','GENERATED') then raise exception '已发送报价不能直接覆盖，请创建新版本'; end if;
  select jsonb_agg((value-'description_zh'-'procurement_cost'-'preparation_requirement')||jsonb_build_object('description_zh',null,'procurement_cost',0,'preparation_requirement',null)) into clean_items from jsonb_array_elements(p_items);
  return public.update_quote_with_items(p_quote_id,p_status,p_currency,p_valid_until,p_payment_method,p_delivery_date,p_customer_short_name,p_destination_country,null,p_shipping_cost,p_notes,clean_items);
end $$;

create or replace function public.update_stock_order_draft(p_stock_order_id uuid,p_stocking_requirements text,p_expected_ready_at timestamptz,p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或备货单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只有订单归属销售员或系统管理员可以完善备货信息'; end if;
  if target.status<>'DRAFT' then raise exception '备货单已提交仓库，不能再修改产品备货信息'; end if;
  if jsonb_typeof(p_items)<>'array' then raise exception '备货产品数据不正确'; end if;
  if (select count(*) from jsonb_array_elements(p_items))<>(select count(*) from public.stock_order_items where stock_order_id=target.id) then raise exception '备货产品行数与销售订单不一致'; end if;
  update public.stock_orders set stocking_requirements=nullif(trim(coalesce(p_stocking_requirements,'')),''),expected_ready_at=p_expected_ready_at,updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  update public.stock_order_items i set
    description_zh=nullif(trim(coalesce(x.description_zh,'')),''),procurement_cost=greatest(coalesce(x.procurement_cost,0),0),preparation_requirement=nullif(trim(coalesce(x.preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(line_number integer,description_zh text,procurement_cost numeric,preparation_requirement text)
  where i.stock_order_id=target.id and i.line_number=x.line_number;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'STOCK_DRAFT_UPDATE','stock_order',target.id,jsonb_build_object('order_number',target.order_number));
  return target;
end $$;

create or replace function public.submit_stock_order(p_stock_order_id uuid)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或备货单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只有订单归属销售员或系统管理员可以提交备货单'; end if;
  if target.status<>'DRAFT' then raise exception '只有待完善备货单可以提交仓库'; end if;
  if nullif(trim(coalesce(target.stocking_requirements,'')),'') is null then raise exception '请填写整单备货要求'; end if;
  if exists(select 1 from public.stock_order_items where stock_order_id=target.id and nullif(trim(coalesce(description_zh,'')),'') is null) then raise exception '请填写每项产品的中文质量或描述'; end if;
  update public.stock_orders set status='WAITING',updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  update public.sales_orders set status='WAITING_STOCK',updated_at=now() where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by) values(target.id,'DRAFT','WAITING','销售员已完善备货信息并提交仓库',actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_ORDER_CREATED','STOCK','收到新备货单',format('订单 %s 的备货单已提交，请安排备货。',target.order_number),
    '/stock-orders/'||target.id,'stock_order',target.id,'stock-submitted:'||target.id,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'STOCK_SUBMIT','stock_order',target.id,jsonb_build_object('order_number',target.order_number));
  return target;
end $$;

create or replace function public.update_sales_order_details(p_sales_order_id uuid,p_delivery_date date,p_confirmation_note text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.sales_orders where id=p_sales_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或销售订单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能修改归属自己的销售订单'; end if;
  if target.status in ('READY','CANCELLED') then raise exception '已结束订单不能再修改'; end if;
  update public.sales_orders set delivery_date=p_delivery_date,confirmation_note=nullif(trim(coalesce(p_confirmation_note,'')),''),updated_at=now() where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'SALES_ORDER_UPDATE','sales_order',target.id,jsonb_build_object('order_number',target.order_number));
  return target;
end $$;

create or replace function public.cancel_sales_order(p_sales_order_id uuid,p_reason text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders; stock public.stock_orders; previous text; reason text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE'; reason:=trim(coalesce(p_reason,''));
  select * into target from public.sales_orders where id=p_sales_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或销售订单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能取消归属自己的销售订单'; end if;
  if reason='' then raise exception '取消订单必须填写真实原因'; end if;
  if target.status='READY' then raise exception '已备齐订单不能直接取消'; end if;
  if target.status='CANCELLED' then return target; end if;
  select * into stock from public.stock_orders where sales_order_id=target.id for update;
  previous:=stock.status;
  update public.sales_orders set status='CANCELLED',confirmation_note=concat_ws(E'\n',confirmation_note,'取消原因：'||reason),updated_at=now() where id=target.id returning * into target;
  update public.stock_orders set status='CANCELLED',status_note=reason,updated_by=actor.id,updated_at=now() where id=stock.id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by) values(stock.id,previous,'CANCELLED',reason,actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_STATUS_CHANGED','STOCK','订单已取消',format('订单 %s 已取消：%s',target.order_number,reason),'/stock-orders/'||stock.id,'stock_order',stock.id,'order-cancel:'||target.id,'INFO'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE' and previous<>'DRAFT';
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'SALES_ORDER_CANCEL','sales_order',target.id,jsonb_build_object('order_number',target.order_number,'reason',reason));
  return target;
end $$;

create or replace function public.update_stock_order_status(p_stock_order_id uuid,p_status text,p_note text default null)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.stock_orders; previous text; allowed boolean;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role not in ('WAREHOUSE','ADMIN') then raise exception '只有仓库员或系统管理员可以更新备货状态'; end if;
  if p_status not in ('PREPARING','READY','SHORTAGE','CANCELLED') then raise exception '无效的备货状态'; end if;
  if p_status in ('SHORTAGE','CANCELLED') and nullif(trim(coalesce(p_note,'')),'') is null then raise exception '缺货异常或取消时必须填写原因说明'; end if;
  select * into target from public.stock_orders where id=p_stock_order_id for update;
  if target.id is null then raise exception '备货单不存在'; end if;
  previous:=target.status;
  allowed:=(previous='WAITING' and p_status in ('PREPARING','SHORTAGE','CANCELLED')) or
    (previous='PREPARING' and p_status in ('READY','SHORTAGE','CANCELLED')) or
    (previous='SHORTAGE' and p_status in ('PREPARING','CANCELLED'));
  if not allowed then raise exception '当前备货状态不能执行该流转'; end if;
  update public.stock_orders set status=p_status,status_note=nullif(trim(coalesce(p_note,'')),''),ready_at=case when p_status='READY' then now() else ready_at end,updated_by=actor.id,updated_at=now() where id=target.id returning * into target;
  update public.sales_orders set status=case p_status when 'PREPARING' then 'PREPARING' when 'READY' then 'READY' when 'SHORTAGE' then 'SHORTAGE' else 'CANCELLED' end,updated_at=now() where id=target.sales_order_id;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by) values(target.id,previous,p_status,nullif(trim(coalesce(p_note,'')),''),actor.id);
  update public.system_notifications set action_status='RESOLVED' where entity_type='stock_order' and entity_id=target.id and type='STOCK_ORDER_CREATED';
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(target.sales_user_id,'STOCK_STATUS_CHANGED','STOCK','备货状态已更新',format('订单 %s 的备货状态已更新为%s%s。',target.order_number,
    case p_status when 'PREPARING' then '备货中' when 'READY' then '已备齐' when 'SHORTAGE' then '缺货异常' else '已取消' end,
    case when nullif(trim(coalesce(p_note,'')),'') is null then '' else '：'||trim(p_note) end),'/stock-orders/'||target.id,'stock_order',target.id,
    'stock-status:'||target.id||':'||p_status||':'||extract(epoch from target.updated_at)::bigint,'INFO');
  return target;
end $$;

revoke execute on function public.confirm_quote_create_sales_order(uuid,text,text,text) from public,anon;
revoke execute on function public.revise_quote(uuid) from public,anon;
revoke execute on function public.update_stock_order_draft(uuid,text,timestamptz,jsonb) from public,anon;
revoke execute on function public.submit_stock_order(uuid) from public,anon;
revoke execute on function public.update_sales_order_details(uuid,date,text) from public,anon;
revoke execute on function public.cancel_sales_order(uuid,text) from public,anon;
revoke execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb) from authenticated;
drop function if exists public.confirm_quote_and_create_stock_order(uuid);
revoke execute on function public.update_quote_customer_fields(uuid,text,text,date,text,date,text,text,numeric,text,jsonb) from public,anon;
grant execute on function public.confirm_quote_create_sales_order(uuid,text,text,text) to authenticated;
grant execute on function public.revise_quote(uuid) to authenticated;
grant execute on function public.update_stock_order_draft(uuid,text,timestamptz,jsonb) to authenticated;
grant execute on function public.submit_stock_order(uuid) to authenticated;
grant execute on function public.update_sales_order_details(uuid,date,text) to authenticated;
grant execute on function public.cancel_sales_order(uuid,text) to authenticated;
grant execute on function public.update_quote_customer_fields(uuid,text,text,date,text,date,text,text,numeric,text,jsonb) to authenticated;

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
create policy sales_orders_scope_select_v6 on public.sales_orders for select to authenticated using(sales_user_id=auth.uid() or public.current_user_is_elevated());
create policy sales_order_items_scope_select_v6 on public.sales_order_items for select to authenticated using(exists(select 1 from public.sales_orders o where o.id=sales_order_id and (o.sales_user_id=auth.uid() or public.current_user_is_elevated())));
drop policy if exists stock_orders_scope_select_v5 on public.stock_orders;
create policy stock_orders_scope_select_v6 on public.stock_orders for select to authenticated using(
  sales_user_id=auth.uid() or public.current_user_is_elevated() or (public.current_user_is_warehouse() and status<>'DRAFT')
);
drop policy if exists stock_items_scope_select_v5 on public.stock_order_items;
create policy stock_items_scope_select_v6 on public.stock_order_items for select to authenticated using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (s.sales_user_id=auth.uid() or public.current_user_is_elevated() or (public.current_user_is_warehouse() and s.status<>'DRAFT'))));
drop policy if exists stock_events_scope_select_v5 on public.stock_order_events;
create policy stock_events_scope_select_v6 on public.stock_order_events for select to authenticated using(exists(select 1 from public.stock_orders s where s.id=stock_order_id and (s.sales_user_id=auth.uid() or public.current_user_is_elevated() or (public.current_user_is_warehouse() and s.status<>'DRAFT'))));
grant select on public.sales_orders,public.sales_order_items to authenticated;

create or replace function public.stock_order_dashboard()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor public.users; scope_id uuid; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号无效'; end if;
  scope_id:=case when actor.role in ('ADMIN','WAREHOUSE') then null else actor.id end;
  with scoped as (
    select s.* from public.stock_orders s where (scope_id is null or s.sales_user_id=scope_id) and (actor.role<>'WAREHOUSE' or s.status<>'DRAFT')
  ), recent_rows as (
    select s.id,s.quote_id,s.sales_order_id,s.quote_number,s.order_number,s.stock_number,s.sales_user_id,s.customer_short_name,s.destination_country,
      s.status,s.stocking_requirements,s.status_note,s.expected_ready_at,s.ready_at,s.created_at,s.updated_at,jsonb_build_object('name',u.name,'email',u.email) sales
    from scoped s left join public.users u on u.id=s.sales_user_id order by s.updated_at desc limit 10
  )
  select jsonb_build_object('counts',jsonb_build_object(
    'DRAFT',(select count(*) from scoped where status='DRAFT'),'WAITING',(select count(*) from scoped where status='WAITING'),
    'PREPARING',(select count(*) from scoped where status='PREPARING'),'SHORTAGE',(select count(*) from scoped where status='SHORTAGE'),
    'READY',(select count(*) from scoped where status='READY'),'CANCELLED',(select count(*) from scoped where status='CANCELLED')),
    'recent',coalesce((select jsonb_agg(to_jsonb(recent_rows) order by updated_at desc) from recent_rows),'[]'::jsonb)) into result;
  return result;
end $$;

insert into public.role_permission_settings(role_code,permission_code,enabled)
select role_code,permission_code,true from (values
  ('SALES','orders.view'),('SALES','orders.edit'),('SALES','orders.cancel'),('SALES','orders.export'),('SALES','stock.prepare'),('SALES','stock.submit'),
  ('SUPERVISOR','orders.view'),('SUPERVISOR','orders.data_all'),('SUPERVISOR','orders.edit'),('SUPERVISOR','orders.cancel'),('SUPERVISOR','orders.export'),('SUPERVISOR','stock.prepare'),('SUPERVISOR','stock.submit'),
  ('ADMIN','orders.view'),('ADMIN','orders.data_all'),('ADMIN','orders.edit'),('ADMIN','orders.cancel'),('ADMIN','orders.export'),('ADMIN','stock.prepare'),('ADMIN','stock.submit')
) seed(role_code,permission_code) on conflict(role_code,permission_code) do update set enabled=excluded.enabled;

commit;
