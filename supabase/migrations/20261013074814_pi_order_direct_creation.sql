-- Direct PI -> sales order -> warehouse order. Historical quotations stay intact.
begin;

create table public.pi_payment_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 120),
  currency text not null check (length(trim(currency)) between 3 and 8),
  instructions text not null check (length(trim(instructions)) between 1 and 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pi_payment_accounts enable row level security;
create policy pi_payment_accounts_read on public.pi_payment_accounts for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE' and u.role in ('ADMIN','SUPERVISOR','SALES')));
create policy pi_payment_accounts_admin_insert on public.pi_payment_accounts for insert to authenticated
  with check (public.current_user_is_admin());
create policy pi_payment_accounts_admin_update on public.pi_payment_accounts for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
grant select,insert,update on public.pi_payment_accounts to authenticated;

alter table public.quotes
  add column pi_direct boolean not null default false,
  add column fx_rate_cny_to_payment numeric(18,6),
  add column subtotal_cny numeric(14,2),
  add column shipping_cny numeric(14,2),
  add column total_cny numeric(14,2),
  add column payment_account_id uuid references public.pi_payment_accounts(id),
  add column payment_account_snapshot text,
  add column delivery_recipient text,
  add column delivery_phone text,
  add column delivery_email text,
  add column delivery_address text;
alter table public.quotes add constraint quotes_pi_direct_fx_valid
  check (not pi_direct or (fx_rate_cny_to_payment > 0 and subtotal_cny >= 0 and shipping_cny >= 0 and total_cny >= 0));
alter table public.quote_items add column unit_price_cny numeric(14,2);
alter table public.quote_items add column internal_note text;
alter table public.sales_orders
  add column pi_valid_until date,
  add column warehouse_reference_number text,
  add column seller_company_name text,
  add column seller_company_address text,
  add column seller_website text,
  add column seller_contact_name text,
  add column seller_contact_phone text,
  add column seller_contact_email text,
  add column fx_rate_cny_to_payment numeric(18,6),
  add column subtotal_cny numeric(14,2),
  add column shipping_cny numeric(14,2),
  add column total_cny numeric(14,2),
  add column payment_account_id uuid references public.pi_payment_accounts(id),
  add column payment_account_snapshot text,
  add column delivery_recipient text,
  add column delivery_phone text,
  add column delivery_email text,
  add column delivery_address text;
alter table public.sales_orders drop constraint if exists sales_orders_status_check;
alter table public.sales_orders add constraint sales_orders_status_check
  check (status in ('DRAFT','CONFIRMED','STOCK_DRAFT','WAITING_STOCK','PREPARING','READY','SHORTAGE','CANCELLED'));
alter table public.sales_orders add column pi_revision integer not null default 1;
alter table public.sales_orders alter column confirmed_at drop not null;
alter table public.sales_orders alter column confirmed_by drop not null;
alter table public.sales_order_items add column unit_price_cny numeric(14,2);
alter table public.sales_order_items add column description_zh text;
alter table public.sales_order_items add column estimated_unit_cost_cny numeric(14,2);
alter table public.sales_order_items add column preparation_requirement text;
alter table public.sales_order_items add column internal_note text;
alter table public.stock_order_items add column internal_note text;
alter table public.stock_order_items add column estimated_unit_cost_cny numeric(14,2);
alter table public.stock_orders add column warehouse_reference_number text;
alter table public.stock_orders add column delivery_recipient text;
alter table public.stock_orders add column delivery_phone text;
alter table public.stock_orders add column delivery_email text;
alter table public.stock_orders add column delivery_address text;
create unique index sales_orders_direct_pi_warehouse_reference_unique
  on public.sales_orders(lower(warehouse_reference_number))
  where confirmation_method='DIRECT_PI' and warehouse_reference_number is not null;

create or replace function public.create_direct_pi_order(
  p_customer_id uuid, p_warehouse_reference_number text, p_currency text, p_fx_rate numeric, p_shipping_cny numeric,
  p_payment_method text, p_payment_account_id uuid, p_valid_until date, p_delivery_date date,
  p_delivery_recipient text, p_delivery_phone text, p_delivery_email text, p_delivery_address text,
  p_stocking_requirements text, p_items jsonb
) returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare
  actor public.users; customer public.customers; account public.pi_payment_accounts;
  created_quote public.quotes; created_order public.sales_orders;
  pi_no text; subtotal_rmb numeric(14,2); subtotal_payment numeric(14,2);
  shipping_payment numeric(14,2); clean_currency text; clean_items jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','SUPERVISOR','ADMIN') then raise exception '当前账号不能创建PI订单'; end if;
  if exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id
    and o.permission_code in ('orders.view','orders.create') and o.effect='DENY') then
    raise exception '当前账号未获PI订单创建权限';
  end if;
  if not exists (select 1 from public.role_permission_settings p where p.role_code=actor.role and p.permission_code='orders.view' and p.enabled)
    and not exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.view' and o.effect='ALLOW') then
    raise exception '当前账号未获PI订单查看权限';
  end if;
  if not exists (select 1 from public.role_permission_settings p where p.role_code=actor.role and p.permission_code='orders.create' and p.enabled)
    and not exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.create' and o.effect='ALLOW') then
    raise exception '当前账号未获PI订单创建权限';
  end if;
  select * into customer from public.customers where id=p_customer_id and deleted_at is null for update;
  if customer.id is null or coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id then
    raise exception '只能为归属自己的有效客户创建PI订单';
  end if;
  if nullif(trim(coalesce(p_warehouse_reference_number,'')),'') is null
    or length(trim(p_warehouse_reference_number))>80 then
    raise exception '请填写80字以内的仓库约定订单编号';
  end if;
  clean_currency:=upper(trim(coalesce(p_currency,'')));
  if clean_currency !~ '^[A-Z]{3}$' then raise exception '请选择有效的付款币种'; end if;
  if p_fx_rate is null or p_fx_rate<=0 or p_fx_rate>100000000 then raise exception '请输入有效的人民币兑付款币种汇率'; end if;
  if p_shipping_cny is null or p_shipping_cny<0 or p_shipping_cny>999999999999 then raise exception '人民币运费不正确'; end if;
  if p_valid_until is null or p_valid_until<current_date then raise exception 'PI有效期不得早于今天'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'PI产品明细需为1至500行'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price_cny numeric,
    estimated_unit_cost_cny numeric,description_zh text)
    where nullif(trim(coalesce(x.item_name,'')),'') is null or x.quantity is null or x.quantity<=0
      or x.quantity<>trunc(x.quantity) or x.unit_price_cny is null or x.unit_price_cny<0
      or x.unit_price_cny<>round(x.unit_price_cny,2)
      or x.estimated_unit_cost_cny is null or x.estimated_unit_cost_cny<0
      or x.estimated_unit_cost_cny<>round(x.estimated_unit_cost_cny,2)
      or nullif(trim(coalesce(x.description_zh,'')),'') is null) then
    raise exception '请填写产品名称、整数数量、人民币销售价、预估成本和仓库用中文规格';
  end if;
  select * into account from public.pi_payment_accounts where id=p_payment_account_id and active=true;
  if account.id is null then raise exception '请选择有效的收款账户'; end if;
  select coalesce(sum(x.quantity*x.unit_price_cny),0),
    coalesce(sum(x.quantity*round(x.unit_price_cny*p_fx_rate,2)),0)
    into subtotal_rmb,subtotal_payment
    from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price_cny numeric);
  shipping_payment:=round(p_shipping_cny*p_fx_rate,2);
  pi_no:='PI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  clean_items:=p_items;
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,subtotal,shipping_cost,total_amount,
    payment_method,customer_short_name,destination_country,stocking_requirements,customer_confirmed_at,confirmed_by,valid_until,
    pi_direct,fx_rate_cny_to_payment,subtotal_cny,shipping_cny,total_cny,payment_account_id,payment_account_snapshot,
    delivery_date,delivery_recipient,delivery_phone,delivery_email,delivery_address)
  values(customer.id,actor.id,actor.id,pi_no,clean_currency,subtotal_payment+shipping_payment,'DRAFT',
    subtotal_payment,shipping_payment,subtotal_payment+shipping_payment,nullif(trim(coalesce(p_payment_method,'')),''),
    customer.company_name,customer.country,coalesce(nullif(trim(p_stocking_requirements),''),'按PI产品明细和仓库中文规格常规备货'),null,null,p_valid_until,true,p_fx_rate,
    subtotal_rmb,p_shipping_cny,subtotal_rmb+p_shipping_cny,account.id,account.instructions,
    p_delivery_date,nullif(trim(coalesce(p_delivery_recipient,'')),''),nullif(trim(coalesce(p_delivery_phone,'')),''),
    nullif(trim(coalesce(p_delivery_email,'')),''),nullif(trim(coalesce(p_delivery_address,'')),'')) returning * into created_quote;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,
    unit_price_cny,unit_cost_cny,procurement_cost,preparation_requirement,internal_note)
  select created_quote.id,x.ordinality,trim(y.item_name),nullif(trim(coalesce(y.brand,'')),''),
    nullif(trim(coalesce(y.model,'')),''),nullif(trim(coalesce(y.quality,'')),''),
    coalesce(y.description,''),trim(y.description_zh),y.quantity,round(y.unit_price_cny*p_fx_rate,2),y.unit_price_cny,
    y.estimated_unit_cost_cny,0,nullif(trim(coalesce(y.preparation_requirement,'')),''),nullif(trim(coalesce(y.internal_note,'')),'')
  from jsonb_array_elements(clean_items) with ordinality as x(value,ordinality)
  cross join lateral jsonb_to_record(x.value) as y(item_name text,brand text,model text,quality text,description text,
    description_zh text,quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric,preparation_requirement text,internal_note text);
  insert into public.sales_orders(order_number,warehouse_reference_number,quote_id,quote_number,customer_id,sales_user_id,customer_short_name,
    destination_country,currency,subtotal,shipping_cost,total_amount,payment_method,delivery_date,confirmation_method,
    status,confirmed_at,confirmed_by,pi_valid_until,seller_company_name,seller_company_address,seller_website,
    seller_contact_name,seller_contact_phone,seller_contact_email,
    fx_rate_cny_to_payment,subtotal_cny,shipping_cny,total_cny,payment_account_id,payment_account_snapshot,
    delivery_recipient,delivery_phone,delivery_email,delivery_address)
  values(pi_no,trim(p_warehouse_reference_number),created_quote.id,pi_no,customer.id,actor.id,customer.company_name,customer.country,clean_currency,
    subtotal_payment,shipping_payment,subtotal_payment+shipping_payment,created_quote.payment_method,p_delivery_date,
    'DIRECT_PI','DRAFT',null,null,p_valid_until,'DT-Smart Technology Co., Ltd',
    'Shenzhou Computer Building, Bantian Sub-district, Longgang District, Shenzhen City, China',
    'https://www.dt-smart.com/',actor.name,
    (select p.phone from public.profiles p where p.id=actor.id),actor.email,
    p_fx_rate,subtotal_rmb,p_shipping_cny,subtotal_rmb+p_shipping_cny,
    account.id,account.instructions,created_quote.delivery_recipient,created_quote.delivery_phone,
    created_quote.delivery_email,created_quote.delivery_address) returning * into created_order;
  insert into public.sales_order_items(sales_order_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,unit_price_cny,
    estimated_unit_cost_cny,preparation_requirement,internal_note)
  select created_order.id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,unit_price_cny,
    unit_cost_cny,preparation_requirement,internal_note
  from public.quote_items where quote_id=created_quote.id order by line_number;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_DRAFT_CREATE','sales_order',created_order.id,
    jsonb_build_object('order_number',pi_no,'customer_id',customer.id,
      'currency',clean_currency,'fx_rate_cny_to_payment',p_fx_rate));
  return created_order;
end $$;
revoke execute on function public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.update_direct_pi_draft(
  p_order_id uuid, p_expected_revision integer, p_warehouse_reference_number text, p_currency text, p_fx_rate numeric, p_shipping_cny numeric,
  p_payment_method text, p_payment_account_id uuid, p_valid_until date, p_delivery_date date,
  p_delivery_recipient text, p_delivery_phone text, p_delivery_email text, p_delivery_address text,
  p_stocking_requirements text, p_items jsonb
) returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare
  actor public.users; target public.sales_orders; account public.pi_payment_accounts; result public.sales_orders;
  clean_currency text; subtotal_rmb numeric(14,2); subtotal_payment numeric(14,2); shipping_payment numeric(14,2);
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'DRAFT' or (target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception '只有归属销售员可以修改尚未提交仓库的PI草稿';
  end if;
  if exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.edit' and o.effect='DENY')
    or (not exists (select 1 from public.role_permission_settings p where p.role_code=actor.role and p.permission_code='orders.edit' and p.enabled)
      and not exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.edit' and o.effect='ALLOW')) then
    raise exception '当前账号未获PI草稿编辑权限';
  end if;
  if target.pi_revision<>p_expected_revision then raise exception 'PI草稿已被其他操作修改，请刷新后再编辑'; end if;
  if nullif(trim(coalesce(p_warehouse_reference_number,'')),'') is null
    or length(trim(p_warehouse_reference_number))>80 then
    raise exception '请填写80字以内的仓库约定订单编号';
  end if;
  if exists(select 1 from public.stock_orders where sales_order_id=target.id and status<>'DRAFT') then
    raise exception '备货单已提交仓库，不能修改PI产品';
  end if;
  clean_currency:=upper(trim(coalesce(p_currency,'')));
  if clean_currency !~ '^[A-Z]{3}$' or p_fx_rate is null or p_fx_rate<=0 or p_fx_rate>100000000
    or p_shipping_cny is null or p_shipping_cny<0 or p_valid_until is null or p_valid_until<current_date then
    raise exception '付款币种、汇率、运费或有效期不正确';
  end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 500 then raise exception 'PI产品明细需为1至500行'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price_cny numeric,
    estimated_unit_cost_cny numeric,description_zh text)
    where nullif(trim(coalesce(x.item_name,'')),'') is null or x.quantity is null or x.quantity<=0
      or x.quantity<>trunc(x.quantity) or x.unit_price_cny is null or x.unit_price_cny<0
      or x.unit_price_cny<>round(x.unit_price_cny,2)
      or x.estimated_unit_cost_cny is null or x.estimated_unit_cost_cny<0
      or x.estimated_unit_cost_cny<>round(x.estimated_unit_cost_cny,2)
      or nullif(trim(coalesce(x.description_zh,'')),'') is null) then
    raise exception '请填写产品名称、整数数量、人民币销售价、预估成本和仓库中文规格';
  end if;
  select * into account from public.pi_payment_accounts where id=p_payment_account_id and active=true;
  if account.id is null then raise exception '请选择有效的收款账户'; end if;
  select coalesce(sum(x.quantity*x.unit_price_cny),0),
    coalesce(sum(x.quantity*round(x.unit_price_cny*p_fx_rate,2)),0)
    into subtotal_rmb,subtotal_payment from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price_cny numeric);
  shipping_payment:=round(p_shipping_cny*p_fx_rate,2);
  update public.quotes set currency=clean_currency,amount=subtotal_payment+shipping_payment,
    subtotal=subtotal_payment,shipping_cost=shipping_payment,total_amount=subtotal_payment+shipping_payment,
    payment_method=nullif(trim(coalesce(p_payment_method,'')),''),valid_until=p_valid_until,
    delivery_date=p_delivery_date,stocking_requirements=coalesce(nullif(trim(p_stocking_requirements),''),'按PI产品明细和仓库中文规格常规备货'),
    fx_rate_cny_to_payment=p_fx_rate,subtotal_cny=subtotal_rmb,shipping_cny=p_shipping_cny,
    total_cny=subtotal_rmb+p_shipping_cny,payment_account_id=account.id,payment_account_snapshot=account.instructions,
    delivery_recipient=nullif(trim(coalesce(p_delivery_recipient,'')),''),delivery_phone=nullif(trim(coalesce(p_delivery_phone,'')),''),
    delivery_email=nullif(trim(coalesce(p_delivery_email,'')),''),delivery_address=nullif(trim(coalesce(p_delivery_address,'')),''),
    updated_at=now() where id=target.quote_id;
  delete from public.quote_items where quote_id=target.quote_id;
  insert into public.quote_items(quote_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,
    unit_price_cny,unit_cost_cny,procurement_cost,preparation_requirement,internal_note)
  select target.quote_id,x.ordinality,trim(y.item_name),nullif(trim(coalesce(y.brand,'')),''),nullif(trim(coalesce(y.model,'')),''),
    nullif(trim(coalesce(y.quality,'')),''),coalesce(y.description,''),trim(y.description_zh),y.quantity,
    round(y.unit_price_cny*p_fx_rate,2),y.unit_price_cny,y.estimated_unit_cost_cny,0,
    nullif(trim(coalesce(y.preparation_requirement,'')),''),nullif(trim(coalesce(y.internal_note,'')),'')
  from jsonb_array_elements(p_items) with ordinality as x(value,ordinality)
  cross join lateral jsonb_to_record(x.value) as y(item_name text,brand text,model text,quality text,description text,
    description_zh text,quantity numeric,unit_price_cny numeric,estimated_unit_cost_cny numeric,preparation_requirement text,internal_note text);
  delete from public.sales_order_items where sales_order_id=target.id;
  insert into public.sales_order_items(sales_order_id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,
    unit_price_cny,estimated_unit_cost_cny,preparation_requirement,internal_note)
  select target.id,line_number,item_name,brand,model,quality,description,description_zh,quantity,unit_price,
    unit_price_cny,unit_cost_cny,preparation_requirement,internal_note
  from public.quote_items where quote_id=target.quote_id order by line_number;
  update public.sales_orders set warehouse_reference_number=trim(p_warehouse_reference_number),
    currency=clean_currency,subtotal=subtotal_payment,shipping_cost=shipping_payment,
    total_amount=subtotal_payment+shipping_payment,payment_method=nullif(trim(coalesce(p_payment_method,'')),''),
    delivery_date=p_delivery_date,pi_valid_until=p_valid_until,fx_rate_cny_to_payment=p_fx_rate,
    subtotal_cny=subtotal_rmb,shipping_cny=p_shipping_cny,total_cny=subtotal_rmb+p_shipping_cny,
    payment_account_id=account.id,payment_account_snapshot=account.instructions,
    delivery_recipient=nullif(trim(coalesce(p_delivery_recipient,'')),''),delivery_phone=nullif(trim(coalesce(p_delivery_phone,'')),''),
    delivery_email=nullif(trim(coalesce(p_delivery_email,'')),''),delivery_address=nullif(trim(coalesce(p_delivery_address,'')),''),
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into result;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_DRAFT_UPDATE','sales_order',target.id,
    jsonb_build_object('revision_before',p_expected_revision,'revision_after',result.pi_revision,
      'item_count',jsonb_array_length(p_items),'total_cny',result.total_cny));
  return result;
end $$;
revoke execute on function public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb) to authenticated;

create or replace function public.submit_direct_pi_order(p_order_id uuid,p_expected_revision integer)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders; target_quote public.quotes; stock public.stock_orders; result public.sales_orders; stock_no text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI' or target.status<>'DRAFT' or (target.sales_user_id<>actor.id and actor.role<>'ADMIN') then
    raise exception '只有归属销售员可以提交PI草稿';
  end if;
  if target.pi_revision<>p_expected_revision then raise exception 'PI草稿已更新，请刷新核对后提交'; end if;
  if stock.id is not null and stock.status<>'DRAFT' then raise exception '备货单状态已改变，请刷新'; end if;
  if exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.create' and o.effect='DENY')
    or (not exists (select 1 from public.role_permission_settings p where p.role_code=actor.role and p.permission_code='orders.create' and p.enabled)
      and not exists (select 1 from public.user_permission_overrides o where o.user_id=actor.id and o.permission_code='orders.create' and o.effect='ALLOW')) then
    raise exception '当前账号未获PI提交权限';
  end if;
  select * into target_quote from public.quotes where id=target.quote_id for update;
  if target_quote.status<>'DRAFT' or not exists(select 1 from public.sales_order_items where sales_order_id=target.id)
    or target.payment_account_snapshot is null then raise exception 'PI草稿内容不完整'; end if;
  if not exists (select 1 from public.customers c where c.id=target.customer_id and c.deleted_at is null
    and coalesce(c.owner_user_id,c.owner_id,c.created_by)=target.sales_user_id) then
    raise exception '客户归属已改变，不能提交此PI草稿';
  end if;
  if not exists (select 1 from public.pi_payment_accounts a where a.id=target.payment_account_id
    and a.active=true) then
    raise exception '收款账户已停用，请重新选择';
  end if;
  if target.pi_valid_until<current_date then raise exception 'PI有效期已过，请修改后提交'; end if;
  if stock.id is null then
    stock_no:='BH-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
    insert into public.stock_orders(quote_id,sales_order_id,quote_number,order_number,warehouse_reference_number,stock_number,sales_user_id,
      customer_short_name,destination_country,status,stocking_requirements,delivery_recipient,delivery_phone,delivery_email,delivery_address,updated_by)
    values(target.quote_id,target.id,target.quote_number,target.order_number,target.warehouse_reference_number,stock_no,target.sales_user_id,
      target.customer_short_name,target.destination_country,'WAITING',target_quote.stocking_requirements,
      target.delivery_recipient,target.delivery_phone,target.delivery_email,target.delivery_address,actor.id)
    returning * into stock;
  else
    update public.stock_orders set status='WAITING',status_note=null,warehouse_reference_number=target.warehouse_reference_number,
      stocking_requirements=target_quote.stocking_requirements,
      delivery_recipient=target.delivery_recipient,delivery_phone=target.delivery_phone,
      delivery_email=target.delivery_email,delivery_address=target.delivery_address,
      updated_by=actor.id,updated_at=now() where id=stock.id returning * into stock;
    delete from public.stock_order_items where stock_order_id=stock.id;
  end if;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,brand,model,quality,description,description_zh,
    procurement_cost,estimated_unit_cost_cny,quantity,preparation_requirement,internal_note)
  select stock.id,line_number,item_name,brand,model,quality,description,description_zh,0,unit_cost_cny,quantity,
    preparation_requirement,internal_note from public.quote_items where quote_id=target.quote_id order by line_number;
  update public.quotes set status='CONFIRMED',customer_confirmed_at=now(),confirmed_by=actor.id,updated_at=now()
    where id=target.quote_id;
  update public.sales_orders set status='WAITING_STOCK',confirmed_at=now(),confirmed_by=actor.id,
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into result;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(stock.id,case when stock_no is null then 'DRAFT' else null end,'WAITING','销售员确认PI并提交仓库',actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_ORDER_CREATED','STOCK','收到新备货单',format('PI订单 %s 已提交仓库，请安排备货。',target.order_number),
    '/stock-orders/'||stock.id,'stock_order',stock.id,'pi-stock:'||stock.id||':'||result.pi_revision,'PENDING'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_SUBMIT','sales_order',target.id,
    jsonb_build_object('revision',result.pi_revision,'stock_order_id',stock.id,'total_cny',result.total_cny));
  return result;
end $$;
revoke execute on function public.submit_direct_pi_order(uuid,integer) from public,anon;
grant execute on function public.submit_direct_pi_order(uuid,integer) to authenticated;

create or replace function public.recall_direct_pi_order(p_order_id uuid,p_reason text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders; stock public.stock_orders; result public.sales_orders; reason text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  reason:=trim(coalesce(p_reason,''));
  select * into stock from public.stock_orders where sales_order_id=p_order_id for update;
  select * into target from public.sales_orders where id=p_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.confirmation_method<>'DIRECT_PI' or (target.sales_user_id<>actor.id and actor.role<>'ADMIN') then raise exception '只能撤回归属自己的PI订单'; end if;
  if not public.current_user_has_business_permission('orders.edit') then raise exception '没有PI订单编辑权限'; end if;
  if target.status<>'WAITING_STOCK' or stock.id is null or stock.status<>'WAITING' then
    raise exception '仓库已开始处理或状态已改变，不能直接撤回，请走变更处理';
  end if;
  if reason='' or length(reason)>500 then raise exception '请填写500字以内的撤回原因'; end if;
  update public.stock_orders set status='DRAFT',status_note=reason,updated_by=actor.id,updated_at=now() where id=stock.id;
  update public.quotes set status='DRAFT',customer_confirmed_at=null,confirmed_by=null,updated_at=now() where id=target.quote_id;
  update public.sales_orders set status='DRAFT',confirmed_at=null,confirmed_by=null,
    pi_revision=pi_revision+1,updated_at=now() where id=target.id returning * into result;
  insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
  values(stock.id,'WAITING','DRAFT','PI撤回：'||reason,actor.id);
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'STOCK_STATUS_CHANGED','STOCK','PI备货单已撤回',format('PI订单 %s 已撤回，请勿继续备货：%s',target.order_number,reason),
    '/stock-orders/'||stock.id,'stock_order',stock.id,'pi-recall:'||stock.id||':'||result.pi_revision,'INFO'
  from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE';
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PI_RECALL','sales_order',target.id,
    jsonb_build_object('reason',reason,'stock_order_id',stock.id,'revision',result.pi_revision));
  return result;
end $$;
revoke execute on function public.recall_direct_pi_order(uuid,text) from public,anon;
grant execute on function public.recall_direct_pi_order(uuid,text) to authenticated;

-- PI drafts are edited only through the atomic order RPCs. Legacy quote RPCs
-- remain callable for historical quotations but cannot desynchronise a PI.
alter function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)
  rename to update_legacy_quote_with_items;
revoke execute on function public.update_legacy_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)
  from public,anon,authenticated;
create function public.update_quote_with_items(
  p_quote_id uuid,p_status text,p_currency text,p_valid_until date,p_payment_method text,p_delivery_date date,
  p_customer_short_name text,p_destination_country text,p_stocking_requirements text,p_shipping_cost numeric,p_notes text,p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
declare target public.quotes;
begin
  select * into target from public.quotes where id=p_quote_id;
  if target.pi_direct then raise exception 'PI订单请在PI草稿页面修改'; end if;
  return public.update_legacy_quote_with_items(p_quote_id,p_status,p_currency,p_valid_until,p_payment_method,
    p_delivery_date,p_customer_short_name,p_destination_country,p_stocking_requirements,p_shipping_cost,p_notes,p_items);
end $$;
revoke execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)
  from public,anon;
grant execute on function public.update_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)
  to authenticated;

alter function public.cancel_quote(uuid,text) rename to cancel_legacy_quote;
revoke execute on function public.cancel_legacy_quote(uuid,text) from public,anon,authenticated;
create function public.cancel_quote(p_quote_id uuid,p_reason text)
returns public.quotes language plpgsql security definer set search_path=public as $$
declare target public.quotes;
begin
  select * into target from public.quotes where id=p_quote_id;
  if target.pi_direct then raise exception 'PI订单请在PI页面取消或撤回'; end if;
  return public.cancel_legacy_quote(p_quote_id,p_reason);
end $$;
revoke execute on function public.cancel_quote(uuid,text) from public,anon;
grant execute on function public.cancel_quote(uuid,text) to authenticated;

drop policy if exists quotes_self on public.quotes;
drop policy if exists quotes_own_insert_v5 on public.quotes;
create policy quotes_own_insert_v5 on public.quotes for insert to authenticated
  with check (not pi_direct and created_by=auth.uid() and (owner_id=auth.uid() or public.current_user_is_admin()));
drop policy if exists quotes_own_update_v5 on public.quotes;
create policy quotes_own_update_v5 on public.quotes for update to authenticated
  using (not pi_direct and (owner_id=auth.uid() or public.current_user_is_admin()))
  with check (not pi_direct and (owner_id=auth.uid() or public.current_user_is_admin()));
drop policy if exists quotes_own_delete_v5 on public.quotes;
create policy quotes_own_delete_v5 on public.quotes for delete to authenticated
  using (not pi_direct and (owner_id=auth.uid() or public.current_user_is_admin()) and status in ('DRAFT','GENERATED'));
drop policy if exists quote_items_own_write_v5 on public.quote_items;
create policy quote_items_own_write_v5 on public.quote_items for all to authenticated
  using (exists(select 1 from public.quotes q where q.id=quote_id and not q.pi_direct
    and (q.owner_id=auth.uid() or public.current_user_is_admin()) and q.status in ('DRAFT','GENERATED','SENT')))
  with check (exists(select 1 from public.quotes q where q.id=quote_id and not q.pi_direct
    and (q.owner_id=auth.uid() or public.current_user_is_admin()) and q.status in ('DRAFT','GENERATED','SENT')));

create or replace function public.cancel_sales_order(p_sales_order_id uuid,p_reason text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders; stock public.stock_orders; previous text; reason text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  reason:=trim(coalesce(p_reason,''));
  select * into stock from public.stock_orders where sales_order_id=p_sales_order_id for update;
  select * into target from public.sales_orders where id=p_sales_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或PI订单不存在'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能取消归属自己的订单'; end if;
  if not public.current_user_has_business_permission('orders.cancel') then raise exception '没有取消订单权限'; end if;
  if reason='' or length(reason)>500 then raise exception '请填写500字以内的真实取消原因'; end if;
  if target.status='CANCELLED' then return target; end if;
  if target.status in ('READY','SHIPPED') then raise exception '已备齐或已发货订单不能直接取消'; end if;
  if target.confirmation_method='DIRECT_PI' and target.status not in ('DRAFT','WAITING_STOCK') then
    raise exception '仓库已开始处理，不能单方取消PI，请联系仓库处理变更';
  end if;
  if target.confirmation_method='DIRECT_PI' and stock.id is not null and stock.status not in ('DRAFT','WAITING') then
    raise exception '仓库状态已改变，不能单方取消PI';
  end if;
  previous:=stock.status;
  update public.sales_orders set status='CANCELLED',
    confirmation_note=concat_ws(E'\n',confirmation_note,'取消原因：'||reason),updated_at=now()
    where id=target.id returning * into target;
  if stock.id is not null then
    update public.stock_orders set status='CANCELLED',status_note=reason,updated_by=actor.id,updated_at=now() where id=stock.id;
    insert into public.stock_order_events(stock_order_id,from_status,to_status,note,created_by)
    values(stock.id,previous,'CANCELLED',reason,actor.id);
    insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    select u.id,'STOCK_STATUS_CHANGED','STOCK','订单已取消',format('订单 %s 已取消：%s',target.order_number,reason),
      '/stock-orders/'||stock.id,'stock_order',stock.id,'order-cancel:'||target.id,'INFO'
    from public.users u where u.role='WAREHOUSE' and u.status='ACTIVE' and previous<>'DRAFT';
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SALES_ORDER_CANCEL','sales_order',target.id,
    jsonb_build_object('order_number',target.order_number,'reason',reason,'stock_order_id',stock.id));
  return target;
end $$;

create or replace function public.sync_cancelled_direct_pi_quote()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.confirmation_method='DIRECT_PI' and new.status='CANCELLED' and old.status<>'CANCELLED' then
    update public.quotes set status='CANCELLED',updated_at=now() where id=new.quote_id and pi_direct;
  end if;
  return new;
end $$;
create trigger sales_order_cancel_direct_pi_quote
after update of status on public.sales_orders
for each row execute function public.sync_cancelled_direct_pi_quote();

create or replace function public.update_sales_order_details(p_sales_order_id uuid,p_delivery_date date,p_confirmation_note text)
returns public.sales_orders language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.sales_orders;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.sales_orders where id=p_sales_order_id for update;
  if actor.id is null or target.id is null then raise exception '账号或销售订单不存在'; end if;
  if target.confirmation_method='DIRECT_PI' then raise exception 'PI订单请在草稿页面修改，已提交内容不得直接覆盖'; end if;
  if target.sales_user_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能修改归属自己的销售订单'; end if;
  if not public.current_user_has_business_permission('orders.edit') then raise exception '没有订单编辑权限'; end if;
  if target.status in ('READY','SHIPPED','CANCELLED') then raise exception '已结束订单不能再修改'; end if;
  update public.sales_orders set delivery_date=p_delivery_date,
    confirmation_note=nullif(trim(coalesce(p_confirmation_note,'')),''),updated_at=now()
    where id=target.id returning * into target;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SALES_ORDER_UPDATE','sales_order',target.id,jsonb_build_object('order_number',target.order_number));
  return target;
end $$;

alter function public.update_stock_order_draft(uuid,text,timestamptz,jsonb)
  rename to update_legacy_stock_order_draft;
revoke execute on function public.update_legacy_stock_order_draft(uuid,text,timestamptz,jsonb)
  from public,anon,authenticated;
create function public.update_stock_order_draft(
  p_stock_order_id uuid,p_stocking_requirements text,p_expected_ready_at timestamptz,p_items jsonb
) returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare is_direct boolean;
begin
  select so.confirmation_method='DIRECT_PI' into is_direct
  from public.stock_orders s join public.sales_orders so on so.id=s.sales_order_id where s.id=p_stock_order_id;
  if is_direct then raise exception 'PI备货明细请在PI草稿中修改'; end if;
  return public.update_legacy_stock_order_draft(p_stock_order_id,p_stocking_requirements,p_expected_ready_at,p_items);
end $$;
revoke execute on function public.update_stock_order_draft(uuid,text,timestamptz,jsonb) from public,anon;
grant execute on function public.update_stock_order_draft(uuid,text,timestamptz,jsonb) to authenticated;

alter function public.submit_stock_order(uuid) rename to submit_legacy_stock_order;
revoke execute on function public.submit_legacy_stock_order(uuid) from public,anon,authenticated;
create function public.submit_stock_order(p_stock_order_id uuid)
returns public.stock_orders language plpgsql security definer set search_path=public as $$
declare is_direct boolean;
begin
  select so.confirmation_method='DIRECT_PI' into is_direct
  from public.stock_orders s join public.sales_orders so on so.id=s.sales_order_id where s.id=p_stock_order_id;
  if is_direct then raise exception 'PI备货单只能从PI草稿确认提交'; end if;
  return public.submit_legacy_stock_order(p_stock_order_id);
end $$;
revoke execute on function public.submit_stock_order(uuid) from public,anon;
grant execute on function public.submit_stock_order(uuid) to authenticated;

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('SALES','orders.create',true),('SUPERVISOR','orders.create',true),('ADMIN','orders.create',true)
on conflict(role_code,permission_code) do nothing;

commit;
