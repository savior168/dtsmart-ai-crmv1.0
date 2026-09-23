-- Keep sheet-level supplier identifiers distinct from per-product supplier codes.
-- Preserve quote pricing snapshots when a customer-facing quote is revised.
begin;

alter table public.products add column if not exists supplier_identifier text;
alter table public.products add column if not exists specifications jsonb not null default '{}'::jsonb;
create index if not exists products_supplier_identity_idx
  on public.products(supplier_identifier, supplier_code, supplier_source);

create or replace function public.product_cost_at_quantity(p_product_id uuid,p_quantity numeric)
returns numeric language sql stable security definer set search_path=public as $$
  with selected as (
    select distinct on(price_kind) price_kind,amount
    from public.product_prices
    where product_id=p_product_id and is_active and currency='CNY'
      and price_kind in ('PROCUREMENT','PACKAGING','OTHER_COST')
      and minimum_quantity<=p_quantity
      and effective_from<=current_date
      and (effective_to is null or effective_to>=current_date)
    order by price_kind,minimum_quantity desc,effective_from desc
  )
  select case
    when not (public.current_user_has_business_permission('pricebooks.cost.total.view')
      or public.current_user_has_business_permission('pricebooks.cost.view')) then null
    when count(distinct price_kind)<>3 then null
    else sum(amount) end from selected
$$;

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
  insert into public.quotes(customer_id,created_by,owner_id,quote_number,currency,amount,status,valid_until,notes,version,subtotal,shipping_cost,total_amount,payment_method,delivery_date,customer_short_name,destination_country,stocking_requirements,supersedes_quote_id)
  values(target.customer_id,actor.id,target.owner_id,next_no,target.currency,target.total_amount,'DRAFT',target.valid_until,target.notes,target.version+1,target.subtotal,target.shipping_cost,target.total_amount,target.payment_method,target.delivery_date,target.customer_short_name,target.destination_country,target.stocking_requirements,target.id)
  returning * into revised;
  insert into public.quote_items(quote_id,line_number,product_id,product_sku_snapshot,supplier_code_snapshot,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,unit_cost_cny,suggested_unit_price,exchange_rate_snapshot,pricing_rule_snapshot,preparation_requirement)
  select revised.id,line_number,product_id,product_sku_snapshot,supplier_code_snapshot,item_name,brand,model,quality,description,description_zh,quantity,unit_price,procurement_cost,unit_cost_cny,suggested_unit_price,exchange_rate_snapshot,pricing_rule_snapshot,preparation_requirement
  from public.quote_items where quote_id=target.id order by line_number;
  update public.quotes set status='SUPERSEDED',updated_at=now() where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'QUOTE_REVISE','quote',revised.id,jsonb_build_object('previous_quote_id',target.id,'previous_quote_number',target.quote_number,'new_quote_number',next_no));
  return revised;
end $$;

create or replace function public.publish_product_import_rows(p_batch_id uuid, p_row_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.product_import_batches; row_record record; product_record public.products;
  external_code text; supplier_id text; published integer:=0; moq numeric; match_count integer; source_row_count integer;
  requested_count integer; unique_count integer; matched_count integer; remaining_valid_count integer; remaining_review_count integer; remaining_error_count integer;
  total_published integer; unresolved boolean; next_status text; seen_product_ids uuid[]:='{}'::uuid[];
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.publish') then raise exception '无产品报价表发布权限'; end if;
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null then raise exception '导入批次不存在'; end if;
  if target.status not in ('REVIEW','READY','PUBLISHED') then raise exception '导入批次尚未完整保存、正在发布或已结束，禁止发布'; end if;
  select count(*) into source_row_count from public.product_import_rows where batch_id=target.id;
  if source_row_count <> target.candidate_count then raise exception '导入批次来源行数量不完整，禁止发布'; end if;
  select count(*),count(distinct selected.id) into requested_count,unique_count from unnest(p_row_ids) as selected(id);
  if requested_count < 1 or requested_count > 100 or unique_count <> requested_count then raise exception '每次请选择1至100条不重复的核准记录'; end if;
  select count(*) into matched_count from public.product_import_rows
    where batch_id=target.id and id=any(p_row_ids) and status in ('VALID','PUBLISHED');
  if matched_count <> requested_count then raise exception '所选记录不是本批次已核准商品，或状态已变化，请刷新后重试'; end if;
  select count(*) into remaining_valid_count from public.product_import_rows
    where batch_id=target.id and id=any(p_row_ids) and status='VALID';
  if remaining_valid_count=0 then return jsonb_build_object('batch_id',target.id,'published_count',target.published_count,'published_this_run',0,'idempotent',true); end if;
  if target.status='PUBLISHED' then raise exception '已结束批次存在未发布记录，请先核对数据状态'; end if;
  update public.product_import_batches set status='PUBLISHING',updated_at=now() where id=target.id;
  for row_record in select * from public.product_import_rows where batch_id=target.id and id=any(p_row_ids) and status='VALID' order by source_sheet,source_row,source_cell for update loop
    if exists(select 1 from public.product_import_rows as split_row
      where split_row.batch_id=target.id and split_row.source_sheet=row_record.source_sheet
        and split_row.source_row=row_record.source_row and split_row.source_cell=row_record.source_cell
        and split_row.id<>row_record.id and split_row.source_variant>1)
      and row_record.source_variant=1 then
      raise exception '原始整格已拆分，不能把整格再次作为商品发布：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row;
    end if;
    if btrim(coalesce(row_record.normalized_data->>'name_zh',''))='' then raise exception '存在缺少商品名称的有效行'; end if;
    if nullif(row_record.normalized_data->>'category_id','') is null then raise exception '存在未确认商品分类的有效行：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row; end if;
    if jsonb_typeof(coalesce(row_record.normalized_data->'specifications','{}'::jsonb))<>'object' then raise exception '商品规格必须为对象：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row; end if;
    external_code:=nullif(upper(btrim(coalesce(row_record.normalized_data->>'sku',''))),'');
    supplier_id:=nullif(btrim(coalesce(row_record.normalized_data->>'supplier_identifier','')),'');
    moq:=greatest(coalesce(nullif(row_record.normalized_data->>'minimum_order_quantity','')::numeric,1),0.001);
    product_record:=null;
    if external_code is not null then
      select count(*) into match_count from public.products
      where supplier_code=external_code
        and ((supplier_id is not null and supplier_identifier=supplier_id)
          or (supplier_id is null and supplier_identifier is null and lower(coalesce(supplier_source,''))=lower(target.source_name)));
      if match_count>1 then raise exception '供应商货号匹配多个商品，禁止自动覆盖：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row; end if;
      select * into product_record from public.products
      where supplier_code=external_code
        and ((supplier_id is not null and supplier_identifier=supplier_id)
          or (supplier_id is null and supplier_identifier is null and lower(coalesce(supplier_source,''))=lower(target.source_name)))
      order by created_at limit 1;
    end if;
    if product_record.id is null then
      select count(*) into match_count from public.products
      where ((supplier_id is not null and supplier_identifier=supplier_id)
          or (supplier_id is null and supplier_identifier is null and lower(coalesce(supplier_source,''))=lower(target.source_name)))
        and category_id=(row_record.normalized_data->>'category_id')::uuid
        and lower(coalesce(part_type,''))=lower(btrim(coalesce(row_record.normalized_data->>'part_type','')))
        and specifications=coalesce(row_record.normalized_data->'specifications','{}'::jsonb)
        and lower(name_zh)=lower(btrim(row_record.normalized_data->>'name_zh'))
        and lower(coalesce(brand,''))=lower(btrim(coalesce(row_record.normalized_data->>'brand','')))
        and lower(coalesce(model,''))=lower(btrim(coalesce(row_record.normalized_data->>'model','')))
        and lower(coalesce(quality,''))=lower(btrim(coalesce(row_record.normalized_data->>'quality','')))
        and lower(coalesce(color,''))=lower(btrim(coalesce(row_record.normalized_data->>'color','')))
        and lower(coalesce(packaging,''))=lower(btrim(coalesce(row_record.normalized_data->>'packaging','')));
      if match_count>1 then raise exception '商品规格匹配多个商品，禁止自动覆盖：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row; end if;
      select * into product_record from public.products
      where ((supplier_id is not null and supplier_identifier=supplier_id)
          or (supplier_id is null and supplier_identifier is null and lower(coalesce(supplier_source,''))=lower(target.source_name)))
        and category_id=(row_record.normalized_data->>'category_id')::uuid
        and lower(coalesce(part_type,''))=lower(btrim(coalesce(row_record.normalized_data->>'part_type','')))
        and specifications=coalesce(row_record.normalized_data->'specifications','{}'::jsonb)
        and lower(name_zh)=lower(btrim(row_record.normalized_data->>'name_zh'))
        and lower(coalesce(brand,''))=lower(btrim(coalesce(row_record.normalized_data->>'brand','')))
        and lower(coalesce(model,''))=lower(btrim(coalesce(row_record.normalized_data->>'model','')))
        and lower(coalesce(quality,''))=lower(btrim(coalesce(row_record.normalized_data->>'quality','')))
        and lower(coalesce(color,''))=lower(btrim(coalesce(row_record.normalized_data->>'color','')))
        and lower(coalesce(packaging,''))=lower(btrim(coalesce(row_record.normalized_data->>'packaging','')))
      order by created_at limit 1;
    end if;
    if product_record.id is not null and (
      product_record.category_id is distinct from (row_record.normalized_data->>'category_id')::uuid
      or (row_record.normalized_data->'specifications' is not null and row_record.normalized_data->'specifications'<>'{}'::jsonb and product_record.specifications is distinct from row_record.normalized_data->'specifications')
      or lower(coalesce(product_record.part_type,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'part_type','')))
      or lower(product_record.name_zh) is distinct from lower(btrim(row_record.normalized_data->>'name_zh'))
      or lower(coalesce(product_record.brand,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'brand','')))
      or lower(coalesce(product_record.model,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'model','')))
      or lower(coalesce(product_record.quality,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'quality','')))
      or lower(coalesce(product_record.color,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'color','')))
      or lower(coalesce(product_record.packaging,'')) is distinct from lower(btrim(coalesce(row_record.normalized_data->>'packaging','')))
    ) then raise exception '已匹配商品的名称或关键规格不同，禁止用报价导入覆盖商品资料：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row; end if;
    if product_record.id is null then
      insert into public.products(supplier_identifier,supplier_code,supplier_source,category_id,specifications,name_zh,name_en,brand,model,part_type,quality,color,packaging,description_zh,description_en,aliases,unit,minimum_order_quantity,is_active,created_by,updated_by)
      values(supplier_id,external_code,target.source_name,(row_record.normalized_data->>'category_id')::uuid,coalesce(row_record.normalized_data->'specifications','{}'::jsonb),btrim(row_record.normalized_data->>'name_zh'),nullif(btrim(row_record.normalized_data->>'name_en'),''),nullif(btrim(row_record.normalized_data->>'brand'),''),nullif(btrim(row_record.normalized_data->>'model'),''),nullif(btrim(row_record.normalized_data->>'part_type'),''),nullif(btrim(row_record.normalized_data->>'quality'),''),nullif(btrim(row_record.normalized_data->>'color'),''),nullif(btrim(row_record.normalized_data->>'packaging'),''),nullif(btrim(row_record.normalized_data->>'description_zh'),''),nullif(btrim(row_record.normalized_data->>'description_en'),''),case when jsonb_typeof(row_record.normalized_data->'aliases')='array' then array(select jsonb_array_elements_text(row_record.normalized_data->'aliases')) else '{}'::text[] end,coalesce(nullif(upper(btrim(row_record.normalized_data->>'unit')),''),'PCS'),moq,true,actor.id,actor.id)
      returning * into product_record;
    end if;
    if product_record.id=any(seen_product_ids) then
      raise exception '所选记录包含同一商品的多条报价，请分开核对后发布：工作表 % 第 % 行',row_record.source_sheet,row_record.source_row;
    end if;
    seen_product_ids:=array_append(seen_product_ids,product_record.id);
    perform pg_advisory_xact_lock(hashtext(product_record.id::text));
    if nullif(row_record.normalized_data->>'procurement_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='PROCUREMENT' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'PROCUREMENT','CNY',(row_record.normalized_data->>'procurement_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'packaging_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='PACKAGING' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'PACKAGING','CNY',(row_record.normalized_data->>'packaging_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'other_cost_cny','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='OTHER_COST' and currency='CNY' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'OTHER_COST','CNY',(row_record.normalized_data->>'other_cost_cny')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    if nullif(row_record.normalized_data->>'sale_usd','') is not null then update public.product_prices set is_active=false,effective_to=greatest(effective_from,current_date),updated_at=now() where product_id=product_record.id and price_kind='SALE_REFERENCE' and currency='USD' and minimum_quantity=moq and is_active;insert into public.product_prices(product_id,price_kind,currency,amount,minimum_quantity,source_import_row_id,source_note,created_by) values(product_record.id,'SALE_REFERENCE','USD',(row_record.normalized_data->>'sale_usd')::numeric,moq,row_record.id,format('%s / %s 第%s行 %s',target.source_name,row_record.source_sheet,row_record.source_row,coalesce(row_record.source_cell,'')),actor.id);end if;
    update public.product_import_rows set status='PUBLISHED',product_id=product_record.id,updated_at=now() where id=row_record.id;published:=published+1;
  end loop;
  select count(*) filter (where status='VALID'),count(*) filter (where status='REVIEW'),
    count(*) filter (where status='ERROR'),count(*) filter (where status='PUBLISHED')
    into remaining_valid_count,remaining_review_count,remaining_error_count,total_published
    from public.product_import_rows where batch_id=target.id;
  unresolved:=coalesce(jsonb_array_length(target.summary->'uncovered_sheets'),0)>0;
  next_status:=case when remaining_review_count>0 or remaining_error_count>0 or unresolved then 'REVIEW'
    when remaining_valid_count>0 then 'READY' else 'PUBLISHED' end;
  update public.product_import_batches set status=next_status,published_count=total_published,
    valid_count=remaining_valid_count,review_count=remaining_review_count,error_count=remaining_error_count,
    published_by=actor.id,published_at=coalesce(target.published_at,now()),updated_at=now() where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'PRODUCT_PRICEBOOK_PUBLISH_PARTIAL','product_import_batch',target.id,
      jsonb_build_object('published_this_run',published,'published_total',total_published,'selected_row_ids',to_jsonb(p_row_ids),'file_name',target.file_name));
  return jsonb_build_object('batch_id',target.id,'published_count',total_published,'published_this_run',published,'idempotent',false);
end $$;

-- Preserve the existing one-argument RPC for older clients, but only permit
-- whole-batch publication after every source sheet and row has been resolved.
create or replace function public.publish_product_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.product_import_batches; selected_ids uuid[];
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.publish') then raise exception '无产品报价表发布权限'; end if;
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null then raise exception '导入批次不存在'; end if;
  if target.status='PUBLISHED' then return jsonb_build_object('batch_id',target.id,'published_count',target.published_count,'published_this_run',0,'idempotent',true); end if;
  if target.status<>'READY' then raise exception '导入批次尚未完成全部来源核对，禁止整批发布'; end if;
  if coalesce(jsonb_array_length(target.summary->'uncovered_sheets'),0)>0
    or exists(select 1 from public.product_import_rows where batch_id=target.id and status in ('REVIEW','ERROR'))
  then raise exception '仍有未核对来源内容，禁止整批发布'; end if;
  select array_agg(id order by source_sheet,source_row,source_cell) into selected_ids
    from public.product_import_rows where batch_id=target.id and status='VALID';
  if coalesce(array_length(selected_ids,1),0)>100 then raise exception '整批超过100条，请通过已核准记录分批发布'; end if;
  if selected_ids is null then raise exception '没有可发布的核准商品'; end if;
  return public.publish_product_import_rows(p_batch_id,selected_ids);
end $$;

revoke all on function public.publish_product_import_rows(uuid,uuid[]) from public, anon;
grant execute on function public.publish_product_import_rows(uuid,uuid[]) to authenticated;
revoke all on function public.publish_product_import(uuid) from public, anon;
grant execute on function public.publish_product_import(uuid) to authenticated;

commit;
