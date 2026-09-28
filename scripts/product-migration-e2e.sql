-- Run against the isolated test project only. Every test write rolls back.
begin;
do $$
declare
  actor_id uuid;
  category_id uuid;
  import_batch_id uuid;
  import_row_id uuid;
  published_product_id uuid;
  product_sku text;
  price_batch_id uuid;
  first_price_id uuid;
  result jsonb;
begin
  select id into actor_id from public.users where role='ADMIN' and status='ACTIVE' limit 1;
  select id into category_id from public.product_categories where is_active limit 1;
  if actor_id is null then raise exception 'Test fixture requires an active admin'; end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  if category_id is null then
    insert into public.product_categories(code,name_zh,created_by)
    values ('E2E','E2E 临时分类',actor_id) returning id into category_id;
  end if;

  insert into public.product_import_batches
    (file_name,file_sha256,source_name,status,sheet_count,source_row_count,candidate_count,valid_count,summary,created_by,parser_version)
  values ('e2e-product-only.xlsx',repeat('e',64),'E2E isolated test','READY',1,1,1,1,
    '{"parser_version":"A1-V13","sheets":[{"name":"商品资料导入","candidates":1}],"uncovered_sheets":[]}'::jsonb,
    actor_id,'A1-V13') returning id into import_batch_id;
  insert into public.product_import_rows
    (batch_id,source_sheet,source_row,source_cell,source_values,normalized_data,status,issues)
  values (import_batch_id,'商品资料导入',2,'A2','[]'::jsonb,
    jsonb_build_object('import_mode','PRODUCT_ONLY','name_zh','E2E 测试屏幕',
      'category_id',category_id,'minimum_order_quantity',1,'specifications','{}'::jsonb),
    'VALID','{}'::text[]) returning id into import_row_id;
  result:=public.publish_product_import_rows(import_batch_id,array[import_row_id]);
  if (result->>'published_this_run')::integer<>1 then raise exception 'Product publication count incorrect: %',result; end if;
  select p.id,p.sku into published_product_id,product_sku from public.products p
    join public.product_import_rows r on r.product_id=p.id where r.id=import_row_id;
  if published_product_id is null or product_sku !~ '^ZK-[0-9]{4}-[0-9]{6}$' then raise exception 'Automatic SKU or product publication failed'; end if;
  if exists(select 1 from public.product_prices where product_prices.product_id=published_product_id) then raise exception 'Product-only import unexpectedly created a price'; end if;

  insert into public.product_price_import_batches(file_sha256,file_name,rows,row_count,created_by)
  values (repeat('f',64),'e2e-first-price.xlsx',jsonb_build_array(jsonb_build_object(
    'source_row',2,'sku',product_sku,'price_kind','PROCUREMENT','currency','CNY',
    'amount',82,'minimum_quantity',1,'effective_from',current_date::text,
    'source_note','E2E test supplier quote','product_id',published_product_id,
    'expected_price_id',null,'expected_amount',null,'issues','[]'::jsonb)),1,actor_id)
  returning id into price_batch_id;
  result:=public.publish_product_price_import(price_batch_id);
  if (result->>'updated')::integer<>1 then raise exception 'First price publication failed: %',result; end if;
  select id into first_price_id from public.product_prices
    where product_prices.product_id=published_product_id and price_kind='PROCUREMENT' and is_active;
  if first_price_id is null then raise exception 'First price was not created'; end if;

  insert into public.product_price_import_batches(file_sha256,file_name,rows,row_count,created_by)
  values (repeat('a',64),'e2e-updated-price.xlsx',jsonb_build_array(jsonb_build_object(
    'source_row',2,'sku',product_sku,'price_kind','PROCUREMENT','currency','CNY',
    'amount',85,'minimum_quantity',1,'effective_from',current_date::text,
    'source_note','E2E revised supplier quote','product_id',published_product_id,
    'expected_price_id',first_price_id,'expected_amount',82,'issues','[]'::jsonb)),1,actor_id)
  returning id into price_batch_id;
  result:=public.publish_product_price_import(price_batch_id);
  if (result->>'updated')::integer<>1 then raise exception 'Price update failed: %',result; end if;
  if not exists(select 1 from public.product_prices where id=first_price_id and not is_active)
    or (select count(*) from public.product_prices where product_prices.product_id=published_product_id and is_active)<>1
    or not exists(select 1 from public.product_prices where product_prices.product_id=published_product_id and is_active and amount=85)
  then raise exception 'Price history/current-version check failed'; end if;
end $$;
rollback;
