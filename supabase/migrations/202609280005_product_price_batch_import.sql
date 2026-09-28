-- A reviewed price-only import never changes product master data. The preview
-- snapshot is immutable to authenticated users and publication is atomic.
begin;

create table if not exists public.product_price_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null,
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  row_count integer not null check (row_count between 1 and 500 and row_count=jsonb_array_length(rows)),
  status text not null default 'REVIEW' check (status in ('REVIEW','PUBLISHED')),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.users(id),
  published_at timestamptz
);

alter table public.product_price_import_batches enable row level security;
create index if not exists product_price_import_file_idx on public.product_price_import_batches(file_sha256,created_at desc);
revoke all on public.product_price_import_batches from anon, authenticated;
grant all on public.product_price_import_batches to service_role;

create or replace function public.publish_product_price_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  batch public.product_price_import_batches;
  item jsonb;
  product_record public.products;
  prior public.product_prices;
  saved public.product_prices;
  expected_id uuid;
  active_count integer;
  changed integer := 0;
  unchanged integer := 0;
  row_count integer;
  row_key text;
  seen_keys text[] := '{}'::text[];
  kind text;
  currency_code text;
  quantity numeric;
  amount_value numeric;
  effective_date date;
  source_text text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.import')
    or not public.current_user_has_business_permission('pricebooks.publish')
    or not public.current_user_has_business_permission('pricebooks.manage')
  then raise exception '无批量价格发布权限'; end if;
  select * into batch from public.product_price_import_batches where id=p_batch_id for update;
  if batch.id is null then raise exception '调价批次不存在'; end if;
  if batch.status='PUBLISHED' then return jsonb_build_object('id',batch.id,'idempotent',true,'updated',0); end if;
  row_count := jsonb_array_length(batch.rows);
  if row_count<1 or row_count>500 then raise exception '调价行数无效'; end if;
  for item in select value from jsonb_array_elements(batch.rows) as entry(value) loop
    if jsonb_typeof(coalesce(item->'issues','[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(item->'issues','[]'::jsonb)) > 0
    then raise exception '批次仍有未解决的匹配或校验问题，请重新上传'; end if;
    if coalesce(item->>'sku','') !~ '^ZK-[0-9]{4}-[0-9]{6}$' then raise exception '系统 SKU 无效'; end if;
    kind := item->>'price_kind';
    if (kind='SALE_REFERENCE' and not public.current_user_has_business_permission('pricebooks.sales.view'))
      or (kind is distinct from 'SALE_REFERENCE' and not public.current_user_has_business_permission('pricebooks.cost.view'))
    then raise exception '无对应价格查看权限'; end if;
    currency_code := case when kind='SALE_REFERENCE' then 'USD' else 'CNY' end;
    if kind not in ('PROCUREMENT','PACKAGING','OTHER_COST','SALE_REFERENCE')
      or item->>'currency' is distinct from currency_code then raise exception '价格项目或币种无效'; end if;
    quantity := (item->>'minimum_quantity')::numeric;
    amount_value := (item->>'amount')::numeric;
    effective_date := (item->>'effective_from')::date;
    source_text := btrim(coalesce(item->>'source_note',''));
    if quantity is null or amount_value is null or effective_date is null
      or quantity<=0 or quantity>=100000000000 or quantity<>round(quantity,3)
      or amount_value<0 or amount_value>=100000000000000 or amount_value<>round(amount_value,4)
      or effective_date>current_date or source_text='' or length(source_text)>500
    then raise exception '价格、起订量、生效日期或来源无效'; end if;
    row_key := item->>'sku' || ':' || kind || ':' || quantity::text;
    if row_key=any(seen_keys) then raise exception '调价批次中存在重复价格阶梯'; end if;
    seen_keys := array_append(seen_keys,row_key);
    select * into product_record from public.products where sku=item->>'sku' and is_active for update;
    if product_record.id is null or product_record.id::text is distinct from item->>'product_id'
    then raise exception '商品已停用或系统 SKU 匹配已变化，请重新预览'; end if;
    perform pg_advisory_xact_lock(hashtext(product_record.id::text));
    select count(*) into active_count from public.product_prices
      where product_id=product_record.id and price_kind=kind and currency=currency_code
        and minimum_quantity=quantity and is_active;
    if active_count>1 then raise exception '当前价格版本不唯一，请先人工核对'; end if;
    select * into prior from public.product_prices
      where product_id=product_record.id and price_kind=kind and currency=currency_code
        and minimum_quantity=quantity and is_active limit 1 for update;
    expected_id := nullif(item->>'expected_price_id','')::uuid;
    if prior.id is distinct from expected_id
      or (prior.id is not null and prior.amount is distinct from (item->>'expected_amount')::numeric)
    then raise exception '原价格已变化，请重新上传预览，整批未生效'; end if;
    if prior.id is not null and effective_date<prior.effective_from
    then raise exception '新价格生效日早于当前版本，禁止倒填覆盖历史'; end if;
    if prior.id is not null and prior.amount=amount_value then unchanged := unchanged+1; continue; end if;
    if prior.id is not null then
      update public.product_prices set is_active=false,
        effective_to=greatest(effective_from,effective_date),updated_at=now()
      where id=prior.id;
    end if;
    insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,effective_from,source_note,created_by)
    values(product_record.id,kind,currency_code,amount_value,quantity,effective_date,
      format('%s / 第%s行 / %s',batch.file_name,item->>'source_row',source_text),actor.id)
    returning * into saved;
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'PRODUCT_PRICE_BATCH_UPDATE','product_price',saved.id,
      jsonb_build_object('batch_id',batch.id,'product_id',product_record.id,'sku',product_record.sku,
        'price_kind',kind,'old_price_id',prior.id,'old_amount',prior.amount,
        'new_amount',amount_value,'source_row',item->>'source_row'));
    changed := changed+1;
  end loop;
  update public.product_price_import_batches set status='PUBLISHED',published_by=actor.id,published_at=now()
    where id=batch.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PRODUCT_PRICE_BATCH_PUBLISH','product_price_import_batch',batch.id,
    jsonb_build_object('file_sha256',batch.file_sha256,'row_count',row_count,
      'updated',changed,'unchanged',unchanged));
  return jsonb_build_object('id',batch.id,'idempotent',false,'updated',changed,'unchanged',unchanged);
end $$;

revoke all on function public.publish_product_price_import(uuid) from public, anon;
grant execute on function public.publish_product_price_import(uuid) to authenticated;

commit;
