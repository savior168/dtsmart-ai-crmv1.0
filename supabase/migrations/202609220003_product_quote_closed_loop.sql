-- Complete the product-to-quotation loop without changing existing identifiers.

begin;

create sequence if not exists public.product_sku_sequence start 1;

create or replace function public.next_product_sku()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare candidate text;
begin
  loop
    candidate := 'ZK-' || to_char(current_date, 'YYMM') || '-' || lpad(nextval('public.product_sku_sequence')::text, 6, '0');
    exit when not exists(select 1 from public.products where sku=candidate);
  end loop;
  return candidate;
end;
$$;

grant execute on function public.next_product_sku() to authenticated;
alter table public.products alter column sku set default public.next_product_sku();
alter table public.products add column if not exists supplier_code text;
alter table public.products add column if not exists supplier_source text;
create index if not exists products_supplier_code_idx on public.products(lower(supplier_source),lower(supplier_code)) where supplier_code is not null;

create table if not exists public.sales_pricing_settings (
  id boolean primary key default true check (id),
  cny_per_usd numeric(12,6) not null default 7.200000 check (cny_per_usd > 0),
  default_markup_percent numeric(8,4) not null default 20 check (default_markup_percent >= 0),
  minimum_margin_percent numeric(8,4) not null default 15 check (minimum_margin_percent >= 0 and minimum_margin_percent < 100),
  rounding_increment numeric(12,4) not null default 0.10 check (rounding_increment > 0),
  quote_valid_days integer not null default 7 check (quote_valid_days between 1 and 365),
  source_note text not null default '管理员固定报价汇率',
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
insert into public.sales_pricing_settings(id) values(true) on conflict(id) do nothing;

create table if not exists public.sales_pricing_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.product_categories(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  markup_percent numeric(8,4) not null check (markup_percent >= 0),
  minimum_margin_percent numeric(8,4) not null check (minimum_margin_percent >= 0 and minimum_margin_percent < 100),
  rounding_increment numeric(12,4) not null default 0.10 check (rounding_increment > 0),
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_pricing_rules_single_scope check ((category_id is not null)::int + (product_id is not null)::int = 1)
);
create unique index if not exists sales_pricing_rules_category_active_unique on public.sales_pricing_rules(category_id) where is_active and category_id is not null;
create unique index if not exists sales_pricing_rules_product_active_unique on public.sales_pricing_rules(product_id) where is_active and product_id is not null;

alter table public.sales_pricing_settings enable row level security;
alter table public.sales_pricing_rules enable row level security;
drop policy if exists sales_pricing_settings_read on public.sales_pricing_settings;
create policy sales_pricing_settings_read on public.sales_pricing_settings for select to authenticated using (
  public.current_user_has_business_permission('pricebooks.sales.view') or public.current_user_has_business_permission('pricebooks.manage')
);
drop policy if exists sales_pricing_rules_read on public.sales_pricing_rules;
create policy sales_pricing_rules_read on public.sales_pricing_rules for select to authenticated using (
  public.current_user_has_business_permission('pricebooks.sales.view') or public.current_user_has_business_permission('pricebooks.manage')
);
grant select on public.sales_pricing_settings, public.sales_pricing_rules to authenticated;

alter table public.quote_items
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists product_sku_snapshot text,
  add column if not exists supplier_code_snapshot text,
  add column if not exists unit_cost_cny numeric(18,4),
  add column if not exists suggested_unit_price numeric(18,4),
  add column if not exists exchange_rate_snapshot numeric(12,6),
  add column if not exists pricing_rule_snapshot jsonb not null default '{}'::jsonb;

create index if not exists quote_items_product_idx on public.quote_items(product_id);

insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, 'pricebooks.rules.manage', role_code = 'ADMIN'
from (values ('ADMIN'),('SUPERVISOR'),('SALES'),('WAREHOUSE')) roles(role_code)
on conflict(role_code, permission_code) do update set enabled=excluded.enabled,updated_at=now();

create or replace function public.save_product_price(
  p_product_id uuid,p_price_kind text,p_currency text,p_amount numeric,
  p_minimum_quantity numeric,p_effective_from date,p_source_note text
) returns public.product_prices
language plpgsql security definer set search_path=public as $$
declare actor public.users; saved public.product_prices;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.manage') then raise exception '无产品价格维护权限'; end if;
  if p_price_kind not in ('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE') or p_currency not in ('CNY','USD') then raise exception '价格类型或币种无效'; end if;
  if p_amount < 0 or p_minimum_quantity <= 0 then raise exception '金额或起订量无效'; end if;
  perform pg_advisory_xact_lock(hashtext(p_product_id::text||':'||p_price_kind||':'||p_currency||':'||p_minimum_quantity::text));
  update public.product_prices set is_active=false,effective_to=greatest(effective_from,p_effective_from),updated_at=now()
  where product_id=p_product_id and price_kind=p_price_kind and currency=p_currency and minimum_quantity=p_minimum_quantity and is_active;
  insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_note,created_by)
  values(p_product_id,p_price_kind,p_currency,p_amount,p_minimum_quantity,p_effective_from,nullif(trim(coalesce(p_source_note,'')),''),actor.id)
  returning * into saved;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PRODUCT_PRICE_CREATE','product_price',saved.id,jsonb_build_object('product_id',p_product_id,'price_kind',p_price_kind,'currency',p_currency,'amount',p_amount,'minimum_quantity',p_minimum_quantity));
  return saved;
end $$;

create or replace function public.save_sales_pricing_settings(
  p_cny_per_usd numeric,p_default_markup_percent numeric,p_minimum_margin_percent numeric,
  p_rounding_increment numeric,p_quote_valid_days integer,p_source_note text
) returns public.sales_pricing_settings
language plpgsql security definer set search_path=public as $$
declare actor public.users; saved public.sales_pricing_settings;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.rules.manage') then raise exception '无销售报价规则维护权限'; end if;
  insert into public.sales_pricing_settings(id,cny_per_usd,default_markup_percent,minimum_margin_percent,rounding_increment,quote_valid_days,source_note,updated_by,updated_at)
  values(true,p_cny_per_usd,p_default_markup_percent,p_minimum_margin_percent,p_rounding_increment,p_quote_valid_days,trim(p_source_note),actor.id,now())
  on conflict(id) do update set cny_per_usd=excluded.cny_per_usd,default_markup_percent=excluded.default_markup_percent,
    minimum_margin_percent=excluded.minimum_margin_percent,rounding_increment=excluded.rounding_increment,
    quote_valid_days=excluded.quote_valid_days,source_note=excluded.source_note,updated_by=actor.id,updated_at=now()
  returning * into saved;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SALES_PRICING_SETTINGS_UPDATE','sales_pricing_settings',null,to_jsonb(saved));
  return saved;
end $$;

create or replace function public.save_sales_pricing_rule(
  p_category_id uuid,p_product_id uuid,p_markup_percent numeric,
  p_minimum_margin_percent numeric,p_rounding_increment numeric
) returns public.sales_pricing_rules
language plpgsql security definer set search_path=public as $$
declare actor public.users; saved public.sales_pricing_rules; lock_key text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.rules.manage') then raise exception '无销售报价规则维护权限'; end if;
  if (p_category_id is null) = (p_product_id is null) then raise exception '必须且只能选择商品或分类'; end if;
  lock_key := coalesce('P:'||p_product_id::text,'C:'||p_category_id::text);
  perform pg_advisory_xact_lock(hashtext(lock_key));
  update public.sales_pricing_rules set is_active=false,updated_by=actor.id,updated_at=now()
  where is_active and ((p_product_id is not null and product_id=p_product_id) or (p_category_id is not null and category_id=p_category_id));
  insert into public.sales_pricing_rules(category_id,product_id,markup_percent,minimum_margin_percent,rounding_increment,created_by,updated_by)
  values(p_category_id,p_product_id,p_markup_percent,p_minimum_margin_percent,p_rounding_increment,actor.id,actor.id)
  returning * into saved;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SALES_PRICING_RULE_CREATE','sales_pricing_rule',saved.id,to_jsonb(saved));
  return saved;
end $$;

grant execute on function public.save_product_price(uuid,text,text,numeric,numeric,date,text) to authenticated;
grant execute on function public.save_sales_pricing_settings(numeric,numeric,numeric,numeric,integer,text) to authenticated;
grant execute on function public.save_sales_pricing_rule(uuid,uuid,numeric,numeric,numeric) to authenticated;

create or replace function public.product_cost_at_quantity(p_product_id uuid,p_quantity numeric)
returns numeric language sql stable security definer set search_path=public as $$
  select coalesce(sum(amount),0) from (
    select distinct on(price_kind) price_kind,amount
    from public.product_prices
    where product_id=p_product_id and is_active and currency='CNY'
      and price_kind in ('PROCUREMENT','PACKAGING','OTHER_COST')
    order by price_kind,(minimum_quantity<=greatest(p_quantity,1)) desc,
      case when minimum_quantity<=greatest(p_quantity,1) then minimum_quantity end desc,
      case when minimum_quantity>greatest(p_quantity,1) then minimum_quantity end asc,effective_from desc
  ) selected
$$;
grant execute on function public.product_cost_at_quantity(uuid,numeric) to authenticated;

create or replace function public.create_quote_with_items(
  p_customer_id uuid,p_status text,p_currency text,p_valid_until date,p_payment_method text,p_delivery_date date,
  p_customer_short_name text,p_destination_country text,p_stocking_requirements text,p_shipping_cost numeric,p_notes text,p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
declare actor public.users; customer public.customers; created_quote public.quotes; quote_no text; subtotal_value numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role in ('WAREHOUSE','ADMIN') then raise exception '当前账号不能创建销售报价单'; end if;
  select * into customer from public.customers where id=p_customer_id and deleted_at is null for update;
  if customer.id is null then raise exception '客户不存在'; end if;
  if coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id then raise exception '只能为归属自己的客户创建报价单'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '请至少添加一条产品明细'; end if;
  if p_status not in ('DRAFT','GENERATED','SENT') then raise exception '无效的报价状态'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price numeric) where nullif(trim(coalesce(item_name,'')),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_price,-1)<0) then raise exception '产品名称、数量或销售单价不正确'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid) where product_id is not null and not exists(select 1 from public.products p where p.id=x.product_id)) then raise exception '报价中存在无效商品'; end if;
  select coalesce(sum(quantity*unit_price),0) into subtotal_value from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric);
  quote_no:='PI-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,valid_until,notes,subtotal,shipping_cost,total_amount,payment_method,delivery_date,customer_short_name,destination_country,stocking_requirements)
  values(customer.id,actor.id,actor.id,quote_no,upper(coalesce(nullif(trim(p_currency),''),'USD')),subtotal_value+greatest(coalesce(p_shipping_cost,0),0),p_status,p_valid_until,nullif(trim(coalesce(p_notes,'')),''),subtotal_value,greatest(coalesce(p_shipping_cost,0),0),subtotal_value+greatest(coalesce(p_shipping_cost,0),0),nullif(trim(coalesce(p_payment_method,'')),''),p_delivery_date,coalesce(nullif(trim(coalesce(p_customer_short_name,'')),''),customer.company_name),coalesce(nullif(trim(coalesce(p_destination_country,'')),''),customer.country),nullif(trim(coalesce(p_stocking_requirements,'')),'')) returning * into created_quote;
  insert into public.quote_items(quote_id,line_number,product_id,product_sku_snapshot,supplier_code_snapshot,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,unit_cost_cny,suggested_unit_price,exchange_rate_snapshot,pricing_rule_snapshot,preparation_requirement)
  select created_quote.id,row_number() over(),x.product_id,coalesce(p.sku,x.product_sku_snapshot),coalesce(p.supplier_code,x.supplier_code_snapshot),trim(x.item_name),nullif(trim(coalesce(x.brand,'')),''),nullif(trim(coalesce(x.model,'')),''),nullif(trim(coalesce(x.quality,'')),''),coalesce(x.description,''),nullif(trim(coalesce(x.description_zh,'')),''),x.quantity,x.unit_price,0,case when x.product_id is null then null else public.product_cost_at_quantity(x.product_id,x.quantity) end,x.suggested_unit_price,x.exchange_rate_snapshot,coalesce(x.pricing_rule_snapshot,'{}'::jsonb),nullif(trim(coalesce(x.preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(product_id uuid,product_sku_snapshot text,supplier_code_snapshot text,item_name text,brand text,model text,quality text,description text,description_zh text,quantity numeric,unit_price numeric,suggested_unit_price numeric,exchange_rate_snapshot numeric,pricing_rule_snapshot jsonb,preparation_requirement text)
  left join public.products p on p.id=x.product_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'QUOTE_CREATE','quote',created_quote.id,jsonb_build_object('quote_number',quote_no,'customer_id',customer.id,'status',p_status,'item_count',jsonb_array_length(p_items)));
  return created_quote;
end $$;

create or replace function public.update_quote_with_items(
  p_quote_id uuid,p_status text,p_currency text,p_valid_until date,p_payment_method text,p_delivery_date date,
  p_customer_short_name text,p_destination_country text,p_stocking_requirements text,p_shipping_cost numeric,p_notes text,p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.quotes; updated_quote public.quotes; subtotal_value numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';select * into target from public.quotes where id=p_quote_id for update;
  if actor.id is null or target.id is null then raise exception '账号或报价单不存在'; end if;
  if target.owner_id<>actor.id and actor.role<>'ADMIN' then raise exception '只能修改归属自己的报价单'; end if;
  if target.status not in ('DRAFT','GENERATED') then raise exception '已发送报价不能直接覆盖，请创建新版本'; end if;
  if p_status not in ('DRAFT','GENERATED','SENT') or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception '报价状态或产品明细无效'; end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(item_name text,quantity numeric,unit_price numeric) where nullif(trim(coalesce(item_name,'')),'') is null or coalesce(quantity,0)<=0 or coalesce(unit_price,-1)<0) then raise exception '产品名称、数量或销售单价不正确'; end if;
  select coalesce(sum(quantity*unit_price),0) into subtotal_value from jsonb_to_recordset(p_items) as x(quantity numeric,unit_price numeric);
  update public.quotes set status=p_status,currency=upper(coalesce(nullif(trim(p_currency),''),'USD')),valid_until=p_valid_until,payment_method=nullif(trim(coalesce(p_payment_method,'')),''),delivery_date=p_delivery_date,customer_short_name=nullif(trim(coalesce(p_customer_short_name,'')),''),destination_country=nullif(trim(coalesce(p_destination_country,'')),''),stocking_requirements=nullif(trim(coalesce(p_stocking_requirements,'')),''),shipping_cost=greatest(coalesce(p_shipping_cost,0),0),subtotal=subtotal_value,total_amount=subtotal_value+greatest(coalesce(p_shipping_cost,0),0),amount=subtotal_value+greatest(coalesce(p_shipping_cost,0),0),notes=nullif(trim(coalesce(p_notes,'')),''),sent_at=case when p_status='SENT' then coalesce(sent_at,now()) else sent_at end,updated_at=now() where id=target.id returning * into updated_quote;
  delete from public.quote_items where quote_id=target.id;
  insert into public.quote_items(quote_id,line_number,product_id,product_sku_snapshot,supplier_code_snapshot,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,unit_cost_cny,suggested_unit_price,exchange_rate_snapshot,pricing_rule_snapshot,preparation_requirement)
  select target.id,row_number() over(),x.product_id,coalesce(p.sku,x.product_sku_snapshot),coalesce(p.supplier_code,x.supplier_code_snapshot),trim(x.item_name),nullif(trim(coalesce(x.brand,'')),''),nullif(trim(coalesce(x.model,'')),''),nullif(trim(coalesce(x.quality,'')),''),coalesce(x.description,''),nullif(trim(coalesce(x.description_zh,'')),''),x.quantity,x.unit_price,0,case when x.product_id is null then null else public.product_cost_at_quantity(x.product_id,x.quantity) end,x.suggested_unit_price,x.exchange_rate_snapshot,coalesce(x.pricing_rule_snapshot,'{}'::jsonb),nullif(trim(coalesce(x.preparation_requirement,'')),'')
  from jsonb_to_recordset(p_items) as x(product_id uuid,product_sku_snapshot text,supplier_code_snapshot text,item_name text,brand text,model text,quality text,description text,description_zh text,quantity numeric,unit_price numeric,suggested_unit_price numeric,exchange_rate_snapshot numeric,pricing_rule_snapshot jsonb,preparation_requirement text) left join public.products p on p.id=x.product_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'QUOTE_UPDATE','quote',target.id,jsonb_build_object('quote_number',target.quote_number,'status',p_status,'item_count',jsonb_array_length(p_items)));
  return updated_quote;
end $$;

create or replace function public.update_quote_customer_fields(
  p_quote_id uuid,p_status text,p_currency text,p_valid_until date,p_payment_method text,p_delivery_date date,
  p_customer_short_name text,p_destination_country text,p_shipping_cost numeric,p_notes text,p_items jsonb
) returns public.quotes language plpgsql security definer set search_path=public as $$
begin
  return public.update_quote_with_items(p_quote_id,p_status,p_currency,p_valid_until,p_payment_method,p_delivery_date,p_customer_short_name,p_destination_country,null,p_shipping_cost,p_notes,p_items);
end $$;

create or replace function public.publish_product_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.product_import_batches; row_record record; product_record public.products; external_code text; published integer:=0; moq numeric;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.publish') then raise exception '无产品报价表发布权限'; end if;
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null then raise exception '导入批次不存在'; end if;
  if target.status='PUBLISHED' then return jsonb_build_object('batch_id',target.id,'published_count',target.published_count,'idempotent',true); end if;
  if exists(select 1 from public.product_import_rows where batch_id=target.id and status in('REVIEW','ERROR')) then raise exception '仍有待处理或错误数据，不能发布'; end if;
  update public.product_import_batches set status='PUBLISHING',updated_at=now() where id=target.id;
  for row_record in select * from public.product_import_rows where batch_id=target.id and status='VALID' order by source_sheet,source_row,source_cell loop
    if btrim(coalesce(row_record.normalized_data->>'name_zh',''))='' then raise exception '存在缺少商品名称的有效行'; end if;
    external_code:=nullif(upper(btrim(coalesce(row_record.normalized_data->>'sku',''))),'');moq:=greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001);product_record:=null;
    if external_code is not null then select * into product_record from public.products where lower(coalesce(supplier_source,''))=lower(target.source_name) and lower(coalesce(supplier_code,''))=lower(external_code) order by created_at limit 1; end if;
    if product_record.id is null then
      select * into product_record from public.products where lower(name_zh)=lower(btrim(row_record.normalized_data->>'name_zh'))
        and lower(coalesce(brand,''))=lower(btrim(coalesce(row_record.normalized_data->>'brand','')))
        and lower(coalesce(model,''))=lower(btrim(coalesce(row_record.normalized_data->>'model','')))
        and lower(coalesce(quality,''))=lower(btrim(coalesce(row_record.normalized_data->>'quality','')))
        and lower(coalesce(color,''))=lower(btrim(coalesce(row_record.normalized_data->>'color','')))
        and lower(coalesce(packaging,''))=lower(btrim(coalesce(row_record.normalized_data->>'packaging',''))) order by created_at limit 1;
    end if;
    if product_record.id is null then
      insert into public.products(supplier_code,supplier_source,name_zh,name_en,brand,model,part_type,quality,color,packaging,description_zh,description_en,aliases,unit,minimum_order_quantity,is_active,created_by,updated_by)
      values(external_code,target.source_name,btrim(row_record.normalized_data->>'name_zh'),nullif(btrim(row_record.normalized_data->>'name_en'),''),nullif(btrim(row_record.normalized_data->>'brand'),''),nullif(btrim(row_record.normalized_data->>'model'),''),nullif(btrim(row_record.normalized_data->>'part_type'),''),nullif(btrim(row_record.normalized_data->>'quality'),''),nullif(btrim(row_record.normalized_data->>'color'),''),nullif(btrim(row_record.normalized_data->>'packaging'),''),nullif(btrim(row_record.normalized_data->>'description_zh'),''),nullif(btrim(row_record.normalized_data->>'description_en'),''),case when jsonb_typeof(row_record.normalized_data->'aliases')='array' then array(select jsonb_array_elements_text(row_record.normalized_data->'aliases')) else '{}'::text[] end,coalesce(nullif(upper(btrim(row_record.normalized_data->>'unit')),''),'PCS'),moq,true,actor.id,actor.id) returning * into product_record;
    else
      update public.products set supplier_code=coalesce(external_code,supplier_code),supplier_source=case when external_code is not null then target.source_name else supplier_source end,name_zh=btrim(row_record.normalized_data->>'name_zh'),name_en=nullif(btrim(row_record.normalized_data->>'name_en'),''),brand=nullif(btrim(row_record.normalized_data->>'brand'),''),model=nullif(btrim(row_record.normalized_data->>'model'),''),part_type=nullif(btrim(row_record.normalized_data->>'part_type'),''),quality=nullif(btrim(row_record.normalized_data->>'quality'),''),color=nullif(btrim(row_record.normalized_data->>'color'),''),packaging=nullif(btrim(row_record.normalized_data->>'packaging'),''),description_zh=nullif(btrim(row_record.normalized_data->>'description_zh'),''),description_en=nullif(btrim(row_record.normalized_data->>'description_en'),''),unit=coalesce(nullif(upper(btrim(row_record.normalized_data->>'unit')),''),'PCS'),minimum_order_quantity=moq,is_active=true,updated_by=actor.id,updated_at=now() where id=product_record.id returning * into product_record;
    end if;
    perform pg_advisory_xact_lock(hashtext(product_record.id::text));
    if nullif(row_record.normalized_data->>'procurement_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='PROCUREMENT' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'PROCUREMENT','CNY',(row_record.normalized_data->>'procurement_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'packaging_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='PACKAGING' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'PACKAGING','CNY',(row_record.normalized_data->>'packaging_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'other_cost_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='OTHER_COST' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'OTHER_COST','CNY',(row_record.normalized_data->>'other_cost_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'sale_usd','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='SALE_REFERENCE' and currency='USD' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'SALE_REFERENCE','USD',(row_record.normalized_data->>'sale_usd')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    update public.product_import_rows set status='PUBLISHED',product_id=product_record.id,updated_at=now() where id=row_record.id;published:=published+1;
  end loop;
  update public.product_import_batches set status='PUBLISHED',published_count=published,published_by=actor.id,published_at=now(),updated_at=now() where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'PRODUCT_PRICEBOOK_PUBLISH','product_import_batch',target.id,jsonb_build_object('published_count',published,'file_name',target.file_name));
  return jsonb_build_object('batch_id',target.id,'published_count',published,'idempotent',false);
end $$;

commit;
