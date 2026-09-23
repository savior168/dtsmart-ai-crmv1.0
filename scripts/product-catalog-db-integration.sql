-- Run only against an isolated test project with the complete migration chain.
-- All fixture writes, including audit entries, are rolled back.
begin;
do $$
declare
  actor_id uuid := '00000000-0000-4000-8000-000000000001';
  category_id uuid;
  batch_id uuid;
  approved_row_id uuid;
  unresolved_row_id uuid;
  reviewed jsonb;
  published jsonb;
begin
  if not exists (select 1 from public.users where id=actor_id and role='ADMIN' and status='ACTIVE') then
    raise exception 'Isolated test administrator fixture missing';
  end if;
  perform set_config('request.jwt.claim.sub',actor_id::text,true);
  insert into public.product_categories(code,name_zh,created_by)
  values('TEST-IMPORT-ROLLBACK','测试商品分类（回滚）',actor_id)
  returning id into category_id;
  insert into public.product_import_batches(
    file_name,file_sha256,source_name,status,sheet_count,source_row_count,
    candidate_count,review_count,parser_version,summary,created_by
  ) values(
    'TEST_ONLY_ROLLBACK.xlsx',repeat('a',64),'TEST_ONLY','REVIEW',1,2,
    2,2,'A1-V12','{"parser_version":"A1-V12","uncovered_sheets":[]}'::jsonb,actor_id
  ) returning id into batch_id;
  insert into public.product_import_rows(
    batch_id,source_sheet,source_row,source_cell,source_values,status,issues
  ) values(batch_id,'TEST',2,'A2','["approved"]'::jsonb,'REVIEW',array['awaiting review'])
  returning id into approved_row_id;
  insert into public.product_import_rows(
    batch_id,source_sheet,source_row,source_cell,source_values,status,issues
  ) values(batch_id,'TEST',3,'A3','["unresolved"]'::jsonb,'REVIEW',array['awaiting review'])
  returning id into unresolved_row_id;
  reviewed:=public.apply_product_import_review(batch_id,actor_id,jsonb_build_array(
    jsonb_build_object(
      'id',approved_row_id,'expected_status','REVIEW','status','VALID','issues','[]'::jsonb,
      'normalized_data',jsonb_build_object(
        'name_zh','测试屏幕（回滚）','category_id',category_id,'sku','TEST-SUPPLIER-001',
        'supplier_identifier','TEST-SUPPLIER','minimum_order_quantity',1,
        'procurement_cny',82,'packaging_cny',2,'other_cost_cny',0,'sale_usd',20,
        'specifications','{}'::jsonb
      )
    )
  ));
  if reviewed->>'updated'<>'1' or reviewed->'batch'->>'status'<>'REVIEW' then
    raise exception 'Atomic review did not retain unresolved source row: %',reviewed;
  end if;
  published:=public.publish_product_import_rows(batch_id,array[approved_row_id]);
  if published->>'published_this_run'<>'1' then
    raise exception 'Selected approved row was not published: %',published;
  end if;
  if (select status from public.product_import_rows where id=unresolved_row_id)<>'REVIEW'
    or (select status from public.product_import_batches where id=batch_id)<>'REVIEW'
    or (select count(*) from public.products where name_zh='测试屏幕（回滚）')<>1
    or (select count(*) from public.product_prices where source_import_row_id=approved_row_id)<>4 then
    raise exception 'Partial publication changed unresolved row or lost source-linked prices';
  end if;
  if public.publish_product_import_rows(batch_id,array[approved_row_id])->>'idempotent'<>'true' then
    raise exception 'Repeated publication was not idempotent';
  end if;
end $$;
rollback;
