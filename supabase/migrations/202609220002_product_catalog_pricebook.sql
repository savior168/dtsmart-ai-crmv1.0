-- Phase 1 product master and price-book foundation.
-- Source rows remain immutable evidence; only reviewed rows may be published.

create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.product_categories(id) on delete restrict,
  code text not null unique,
  name_zh text not null,
  name_en text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_code_not_blank check (btrim(code) <> ''),
  constraint product_categories_name_not_blank check (btrim(name_zh) <> '')
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  category_id uuid references public.product_categories(id) on delete restrict,
  name_zh text not null,
  name_en text,
  brand text,
  model text,
  part_type text,
  quality text,
  color text,
  packaging text,
  description_zh text,
  description_en text,
  aliases text[] not null default '{}',
  image_url text,
  unit text not null default 'PCS',
  minimum_order_quantity numeric(14,3) not null default 1,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_sku_not_blank check (btrim(sku) <> ''),
  constraint products_name_not_blank check (btrim(name_zh) <> ''),
  constraint products_moq_positive check (minimum_order_quantity > 0)
);

create index if not exists products_active_category_idx on public.products(is_active, category_id, updated_at desc);
create index if not exists products_brand_model_idx on public.products(brand, model);

create table if not exists public.product_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_sha256 text not null,
  source_name text not null default '产品报价表',
  status text not null default 'REVIEW' check (status in ('REVIEW','READY','PUBLISHING','PUBLISHED','FAILED','CANCELLED')),
  sheet_count integer not null default 0,
  source_row_count integer not null default 0,
  candidate_count integer not null default 0,
  valid_count integer not null default 0,
  review_count integer not null default 0,
  error_count integer not null default 0,
  published_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.users(id),
  published_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(file_sha256)
);

create table if not exists public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.product_import_batches(id) on delete cascade,
  source_sheet text not null,
  source_row integer not null,
  source_cell text,
  source_values jsonb not null default '[]'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  status text not null default 'REVIEW' check (status in ('REVIEW','VALID','ERROR','SKIPPED','PUBLISHED')),
  issues text[] not null default '{}',
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, source_sheet, source_row, source_cell)
);

create index if not exists product_import_rows_batch_status_idx on public.product_import_rows(batch_id, status, source_sheet, source_row);

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price_kind text not null check (price_kind in ('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE')),
  currency text not null check (currency in ('CNY','USD')),
  amount numeric(18,4) not null,
  minimum_quantity numeric(14,3) not null default 1,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  source_import_row_id uuid references public.product_import_rows(id) on delete set null,
  source_note text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_prices_amount_nonnegative check (amount >= 0),
  constraint product_prices_minimum_quantity_positive check (minimum_quantity > 0),
  constraint product_prices_period_valid check (effective_to is null or effective_to >= effective_from)
);

create index if not exists product_prices_lookup_idx on public.product_prices(product_id, price_kind, currency, is_active, effective_from desc, minimum_quantity);

alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_prices enable row level security;
alter table public.product_import_batches enable row level security;
alter table public.product_import_rows enable row level security;

create or replace function public.current_user_has_business_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when u.role='ADMIN' then true
      when exists(select 1 from public.user_permission_overrides o where o.user_id=u.id and o.permission_code=p_permission and o.effect='DENY') then false
      when exists(select 1 from public.user_permission_overrides o where o.user_id=u.id and o.permission_code=p_permission and o.effect='ALLOW') then true
      else coalesce((select r.enabled from public.role_permission_settings r where r.role_code=u.role and r.permission_code=p_permission),false)
    end
    from public.users u where u.id=auth.uid() and u.status='ACTIVE'
  ),false)
$$;

drop policy if exists product_categories_read on public.product_categories;
create policy product_categories_read on public.product_categories for select to authenticated using (
  public.current_user_has_business_permission('products.view') or public.current_user_has_business_permission('pricebooks.view')
);
drop policy if exists products_read on public.products;
create policy products_read on public.products for select to authenticated using (
  public.current_user_has_business_permission('products.view') or public.current_user_has_business_permission('pricebooks.view')
);
drop policy if exists product_prices_read on public.product_prices;
create policy product_prices_read on public.product_prices for select to authenticated using (
  public.current_user_has_business_permission('pricebooks.view')
  and (
    (price_kind='SALE_REFERENCE' and public.current_user_has_business_permission('pricebooks.sales.view'))
    or (price_kind in ('PROCUREMENT','PACKAGING','OTHER_COST') and public.current_user_has_business_permission('pricebooks.cost.view'))
  )
);
drop policy if exists product_import_batches_read on public.product_import_batches;
create policy product_import_batches_read on public.product_import_batches for select to authenticated using (public.current_user_is_admin());
drop policy if exists product_import_rows_read on public.product_import_rows;
create policy product_import_rows_read on public.product_import_rows for select to authenticated using (public.current_user_is_admin());

grant select on public.product_categories, public.products, public.product_prices to authenticated;
grant select on public.product_import_batches, public.product_import_rows to authenticated;

-- Defaults follow least privilege: sales sees published customer-facing reference
-- prices but never purchasing cost; warehouse sees purchasing/packing cost but not
-- sales pricing or margin data; supervisors can review both. Only administrators
-- may maintain, import or publish the authoritative price book by default.
insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code,
  case
    when role_code = 'ADMIN' then true
    when permission_code in ('products.view','pricebooks.view') then true
    when role_code = 'SUPERVISOR' and permission_code in ('pricebooks.sales.view','pricebooks.cost.total.view','pricebooks.cost.view') then true
    when role_code = 'SALES' and permission_code in ('pricebooks.sales.view','pricebooks.cost.total.view') then true
    when role_code = 'WAREHOUSE' and permission_code in ('pricebooks.cost.total.view','pricebooks.cost.view') then true
    else false
  end
from (values ('ADMIN'),('SUPERVISOR'),('SALES'),('WAREHOUSE')) roles(role_code)
cross join (values
  ('products.view'),('products.manage'),
  ('pricebooks.view'),('pricebooks.sales.view'),('pricebooks.cost.total.view'),('pricebooks.cost.view'),('pricebooks.manage'),('pricebooks.import'),('pricebooks.publish')
) permissions(permission_code)
on conflict(role_code, permission_code) do update set enabled = excluded.enabled, updated_at = now();

create or replace function public.publish_product_import(p_batch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.users;
  target public.product_import_batches;
  row_record record;
  product_record public.products;
  clean_sku text;
  published integer := 0;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role <> 'ADMIN' then raise exception '仅系统管理员可发布产品价格表'; end if;
  select * into target from public.product_import_batches where id = p_batch_id for update;
  if target.id is null then raise exception '导入批次不存在'; end if;
  if target.status = 'PUBLISHED' then
    return jsonb_build_object('batch_id', target.id, 'published_count', target.published_count, 'idempotent', true);
  end if;
  if exists(select 1 from public.product_import_rows where batch_id = target.id and status in ('REVIEW','ERROR')) then
    raise exception '仍有待处理或错误数据，不能发布';
  end if;
  update public.product_import_batches set status = 'PUBLISHING', updated_at = now() where id = target.id;

  for row_record in
    select * from public.product_import_rows where batch_id = target.id and status = 'VALID' order by source_sheet, source_row, source_cell
  loop
    clean_sku := upper(btrim(coalesce(row_record.normalized_data->>'sku','')));
    if clean_sku = '' or btrim(coalesce(row_record.normalized_data->>'name_zh','')) = '' then
      raise exception '存在缺少SKU或商品名称的有效行';
    end if;
    insert into public.products(
      sku,name_zh,name_en,brand,model,part_type,quality,color,packaging,
      description_zh,description_en,aliases,unit,minimum_order_quantity,is_active,created_by,updated_by
    ) values (
      clean_sku,btrim(row_record.normalized_data->>'name_zh'),nullif(btrim(row_record.normalized_data->>'name_en'),''),
      nullif(btrim(row_record.normalized_data->>'brand'),''),nullif(btrim(row_record.normalized_data->>'model'),''),
      nullif(btrim(row_record.normalized_data->>'part_type'),''),nullif(btrim(row_record.normalized_data->>'quality'),''),
      nullif(btrim(row_record.normalized_data->>'color'),''),nullif(btrim(row_record.normalized_data->>'packaging'),''),
      nullif(btrim(row_record.normalized_data->>'description_zh'),''),nullif(btrim(row_record.normalized_data->>'description_en'),''),
      case when jsonb_typeof(row_record.normalized_data->'aliases')='array' then array(select jsonb_array_elements_text(row_record.normalized_data->'aliases')) else '{}'::text[] end,
      coalesce(nullif(upper(btrim(row_record.normalized_data->>'unit')),''),'PCS'),
      greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001),true,actor.id,actor.id
    )
    on conflict(sku) do update set
      name_zh=excluded.name_zh,name_en=excluded.name_en,brand=excluded.brand,model=excluded.model,
      part_type=excluded.part_type,quality=excluded.quality,color=excluded.color,packaging=excluded.packaging,
      description_zh=excluded.description_zh,description_en=excluded.description_en,aliases=excluded.aliases,
      unit=excluded.unit,minimum_order_quantity=excluded.minimum_order_quantity,is_active=true,
      updated_by=actor.id,updated_at=now()
    returning * into product_record;

    if nullif(row_record.normalized_data->>'procurement_cny','') is not null then
      update public.product_prices set is_active=false,effective_to=current_date,updated_at=now()
      where product_id=product_record.id and price_kind='PROCUREMENT' and currency='CNY' and is_active;
      insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_import_row_id,source_note,created_by)
      values(product_record.id,'PROCUREMENT','CNY',(row_record.normalized_data->>'procurement_cny')::numeric,
        greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001),current_date,row_record.id,
        format('%s 第%s行 %s',row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);
    end if;
    if nullif(row_record.normalized_data->>'packaging_cny','') is not null then
      update public.product_prices set is_active=false,effective_to=current_date,updated_at=now()
      where product_id=product_record.id and price_kind='PACKAGING' and currency='CNY' and is_active;
      insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_import_row_id,source_note,created_by)
      values(product_record.id,'PACKAGING','CNY',(row_record.normalized_data->>'packaging_cny')::numeric,
        greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001),current_date,row_record.id,
        format('%s 第%s行 %s',row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);
    end if;
    if nullif(row_record.normalized_data->>'other_cost_cny','') is not null then
      update public.product_prices set is_active=false,effective_to=current_date,updated_at=now()
      where product_id=product_record.id and price_kind='OTHER_COST' and currency='CNY' and is_active;
      insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_import_row_id,source_note,created_by)
      values(product_record.id,'OTHER_COST','CNY',(row_record.normalized_data->>'other_cost_cny')::numeric,
        greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001),current_date,row_record.id,
        format('%s 第%s行 %s',row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);
    end if;
    if nullif(row_record.normalized_data->>'sale_usd','') is not null then
      update public.product_prices set is_active=false,effective_to=current_date,updated_at=now()
      where product_id=product_record.id and price_kind='SALE_REFERENCE' and currency='USD' and is_active;
      insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_import_row_id,source_note,created_by)
      values(product_record.id,'SALE_REFERENCE','USD',(row_record.normalized_data->>'sale_usd')::numeric,
        greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001),current_date,row_record.id,
        format('%s 第%s行 %s',row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);
    end if;
    update public.product_import_rows set status='PUBLISHED',product_id=product_record.id,updated_at=now() where id=row_record.id;
    published := published + 1;
  end loop;

  update public.product_import_batches set status='PUBLISHED',published_count=published,published_by=actor.id,published_at=now(),updated_at=now()
  where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PRODUCT_PRICEBOOK_PUBLISH','product_import_batch',target.id,jsonb_build_object('published_count',published,'file_name',target.file_name));
  return jsonb_build_object('batch_id',target.id,'published_count',published,'idempotent',false);
end $$;

grant execute on function public.current_user_has_business_permission(text) to authenticated;
grant execute on function public.publish_product_import(uuid) to authenticated;
