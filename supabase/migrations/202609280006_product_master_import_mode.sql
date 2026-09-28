-- The product-master template intentionally carries no prices. Keep review and publish boundaries explicit.
begin;

create or replace function public.guard_product_import_parser_version()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='PUBLISHING' and old.status is distinct from 'PUBLISHING'
    and (new.parser_version is distinct from 'A1-V13'
      or new.summary->>'parser_version' is distinct from 'A1-V13') then
    raise exception '该导入批次使用旧版解析坐标，禁止发布；请重新导入原文件并核对';
  end if;
  return new;
end $$;

create or replace function public.split_product_import_row(p_batch_id uuid,p_row_id uuid,p_excerpt text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.product_import_batches; source_record public.product_import_rows;
  child public.product_import_rows; raw_cell text; cell_letters text; column_index integer:=0;
  letter_index integer; next_variant integer; updated_sheets jsonb;
  first_split boolean; valid_rows integer; review_rows integer; error_rows integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('pricebooks.import') then raise exception '无产品报价表核对权限'; end if;
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null or target.status not in ('REVIEW','READY') then raise exception '该批次不能拆分来源单元格'; end if;
  if target.parser_version is distinct from 'A1-V13'
    or target.summary->>'parser_version' is distinct from 'A1-V13' then
    raise exception '旧版解析坐标不可拆分，请重新上传原文件';
  end if;
  if (select count(*) from public.product_import_rows where batch_id=p_batch_id) <> target.candidate_count then
    raise exception '导入批次来源行数量不完整，禁止拆分';
  end if;
  select * into source_record from public.product_import_rows
    where id=p_row_id and batch_id=p_batch_id for update;
  if source_record.id is null or source_record.source_variant<>1 or source_record.source_excerpt is not null
    or source_record.status not in ('REVIEW','ERROR')
  then raise exception '只能从尚未处理完的原始整格记录继续拆分'; end if;
  first_split:=not exists(select 1 from public.product_import_rows where batch_id=p_batch_id
    and source_sheet=source_record.source_sheet and source_row=source_record.source_row
    and source_cell=source_record.source_cell and source_variant>1);
  cell_letters:=substring(source_record.source_cell from '^[A-Z]+');
  if cell_letters is null or length(cell_letters)>3 then raise exception '来源单元格地址无效'; end if;
  for letter_index in 1..length(cell_letters) loop
    column_index:=column_index*26+ascii(substring(cell_letters from letter_index for 1))-64;
  end loop;
  raw_cell:=source_record.source_values->>(column_index-1);
  if p_excerpt is null or length(btrim(p_excerpt))<2 or length(btrim(p_excerpt))>1000
    or raw_cell is null or strpos(raw_cell,btrim(p_excerpt))=0 then
    raise exception '拆分片段必须来自原始单元格，且长度为2至1000字';
  end if;
  if exists(select 1 from public.product_import_rows where batch_id=p_batch_id
    and source_sheet=source_record.source_sheet and source_row=source_record.source_row
    and source_cell=source_record.source_cell and source_excerpt=btrim(p_excerpt)) then
    raise exception '该原文片段已经拆分，请勿重复创建';
  end if;
  if exists(select 1 from public.product_import_rows where batch_id=p_batch_id
    and source_sheet=source_record.source_sheet and source_row=source_record.source_row
    and source_cell=source_record.source_cell and source_excerpt is not null
    and greatest(strpos(raw_cell,btrim(p_excerpt)),strpos(raw_cell,source_excerpt))
      <= least(strpos(raw_cell,btrim(p_excerpt))+length(btrim(p_excerpt))-1,
        strpos(raw_cell,source_excerpt)+length(source_excerpt)-1)) then
    raise exception '该原文片段与已有拆分片段重叠，请按互不重叠的完整商品内容拆分';
  end if;
  select coalesce(max(source_variant),0)+1 into next_variant from public.product_import_rows
    where batch_id=p_batch_id and source_sheet=source_record.source_sheet
      and source_row=source_record.source_row and source_cell=source_record.source_cell;
  insert into public.product_import_rows(batch_id,source_sheet,source_row,source_cell,source_variant,
    source_excerpt,source_values,normalized_data,status,issues)
  values(p_batch_id,source_record.source_sheet,source_record.source_row,source_record.source_cell,
    next_variant,btrim(p_excerpt),source_record.source_values,
    jsonb_build_object('supplier_identifier',coalesce(source_record.normalized_data->>'supplier_identifier',''),
      'category_id',coalesce(source_record.normalized_data->>'category_id',''),
      'description_zh',btrim(p_excerpt),'specifications','{}'::jsonb),
    'REVIEW',array['从同一来源单元格人工拆分；请逐项核对该片段的型号、规格、成本和包装费'])
  returning * into child;
  update public.product_import_rows set status='REVIEW',
    issues=array['原始整格尚有待核对内容；继续拆分，全部处理完后明确跳过此整格记录'],updated_at=now()
    where id=source_record.id;
  select count(*) filter (where status='VALID'), count(*) filter (where status='REVIEW'),
    count(*) filter (where status='ERROR') into valid_rows,review_rows,error_rows
    from public.product_import_rows where batch_id=p_batch_id;
  select jsonb_agg(case when item->>'name'=source_record.source_sheet then
    jsonb_set(item,'{candidates}',to_jsonb(coalesce((item->>'candidates')::integer,0)+1))
    else item end) into updated_sheets
    from jsonb_array_elements(coalesce(target.summary->'sheets','[]'::jsonb)) as entry(item);
  update public.product_import_batches set candidate_count=candidate_count+1,
    valid_count=valid_rows,review_count=review_rows,error_count=error_rows,
    status='REVIEW',summary=jsonb_set(target.summary,'{sheets}',coalesce(updated_sheets,'[]'::jsonb)),
    updated_at=now() where id=p_batch_id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'PRODUCT_IMPORT_CELL_SPLIT','product_import_row',child.id,
      jsonb_build_object('batch_id',p_batch_id,'parent_row_id',source_record.id,
        'source_sheet',child.source_sheet,'source_cell',child.source_cell,
        'source_variant',child.source_variant,'source_excerpt',child.source_excerpt,
        'first_split',first_split,'original_whole_cell_requires_closure',true));
  return jsonb_build_object('id',child.id,'source_variant',child.source_variant);
end $$;

create or replace function public.apply_product_import_review(
  p_batch_id uuid,p_actor_id uuid,p_changes jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.product_import_batches;
  entry jsonb; source_record public.product_import_rows; row_id uuid;
  expected_status text; next_row_status text; next_data jsonb; next_issues text[];
  seen_ids uuid[]:='{}'::uuid[]; changed integer:=0; child_exists boolean;
  refreshed jsonb;
begin
  select * into actor from public.users where id=p_actor_id and status='ACTIVE';
  if actor.id is null then raise exception '用户已停用或不存在'; end if;
  if actor.role<>'ADMIN' and (
    exists(select 1 from public.user_permission_overrides where user_id=actor.id
      and permission_code='pricebooks.import' and effect='DENY')
    or (not exists(select 1 from public.user_permission_overrides where user_id=actor.id
      and permission_code='pricebooks.import' and effect='ALLOW')
      and not exists(select 1 from public.role_permission_settings where role_code=actor.role
        and permission_code='pricebooks.import' and enabled))
  ) then raise exception '无产品报价表核对权限'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_changes)<1 or jsonb_array_length(p_changes)>200 then
    raise exception '每次只能核对1至200条来源记录';
  end if;
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null or target.status not in ('REVIEW','READY') then
    raise exception '导入批次正在发布或已结束，不能修改来源行';
  end if;
  if target.parser_version is distinct from 'A1-V13'
    or target.summary->>'parser_version' is distinct from 'A1-V13' then
    raise exception '旧版解析坐标不可核对，请重新上传原文件';
  end if;
  if (select count(*) from public.product_import_rows where batch_id=p_batch_id)<>target.candidate_count then
    raise exception '导入批次来源行数量不完整，禁止核对';
  end if;
  for entry in select value from jsonb_array_elements(p_changes) loop
    row_id:=(entry->>'id')::uuid;
    if row_id is null or row_id=any(seen_ids) then raise exception '核对来源行重复或无效'; end if;
    seen_ids:=array_append(seen_ids,row_id);
    expected_status:=entry->>'expected_status';
    next_row_status:=entry->>'status';
    if next_row_status not in ('REVIEW','VALID','SKIPPED') then raise exception '核对状态无效'; end if;
    select * into source_record from public.product_import_rows
      where id=row_id and batch_id=p_batch_id for update;
    if source_record.id is null or source_record.status is distinct from expected_status
      or source_record.status in ('PUBLISHED','SKIPPED') then
      raise exception '来源行状态已变化，请刷新后重试';
    end if;
    select exists(select 1 from public.product_import_rows as child
      where child.batch_id=p_batch_id and child.source_sheet=source_record.source_sheet
        and child.source_row=source_record.source_row and child.source_cell=source_record.source_cell
        and child.source_variant>1) into child_exists;
    if source_record.source_variant=1 and child_exists
      and (next_row_status<>'SKIPPED' or entry->>'confirm_split_complete' is distinct from 'true') then
      raise exception '原始整格已拆分；须逐项处理后明确确认结束拆分';
    end if;
    if next_row_status='SKIPPED' then
      update public.product_import_rows set status='SKIPPED',issues='{}'::text[],updated_at=now()
        where id=row_id;
    else
      next_data:=entry->'normalized_data';
      if jsonb_typeof(next_data) is distinct from 'object'
        or jsonb_typeof(entry->'issues') is distinct from 'array' then
        raise exception '核对内容格式无效';
      end if;
      select coalesce(array_agg(value),'{}'::text[]) into next_issues
        from jsonb_array_elements_text(entry->'issues') as issue(value);
      if next_row_status='VALID' and (cardinality(next_issues)>0
        or btrim(coalesce(next_data->>'name_zh',''))=''
        or nullif(next_data->>'category_id','') is null
        or coalesce((next_data->>'minimum_order_quantity')::numeric,0)<=0
        or (next_data->>'import_mode'='PRODUCT_ONLY' and (source_record.source_sheet<>'商品资料导入'
          or next_data->>'procurement_cny' is not null or next_data->>'packaging_cny' is not null
          or next_data->>'other_cost_cny' is not null or next_data->>'sale_usd' is not null))
        or (next_data->>'import_mode' is distinct from 'PRODUCT_ONLY' and (
          source_record.source_sheet='商品资料导入' or (next_data->>'procurement_cny' is null
          and next_data->>'packaging_cny' is null and next_data->>'other_cost_cny' is null
          and next_data->>'sale_usd' is null)))) then
        raise exception '来源行尚未满足核准条件';
      end if;
      update public.product_import_rows set normalized_data=next_data,
        status=next_row_status,issues=next_issues,updated_at=now() where id=row_id;
    end if;
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
      values(actor.id,case when next_row_status='SKIPPED' then 'PRODUCT_IMPORT_ROW_SKIP'
        else 'PRODUCT_IMPORT_ROW_REVIEW' end,'product_import_row',row_id,
        jsonb_build_object('batch_id',p_batch_id,'status',next_row_status,
          'split_complete',entry->>'confirm_split_complete'='true'));
    changed:=changed+1;
  end loop;
  refreshed:=public.refresh_product_import_batch_counts(p_batch_id);
  if refreshed->>'complete' is distinct from 'true' then raise exception '核对后批次对账失败'; end if;
  return jsonb_build_object('updated',changed,'batch',refreshed);
end $$;

alter table public.product_import_rows
  add constraint product_import_rows_master_mode_consistent check (
    (source_sheet <> '商品资料导入' or normalized_data->>'import_mode' = 'PRODUCT_ONLY')
    and (normalized_data->>'import_mode' is distinct from 'PRODUCT_ONLY'
      or (source_sheet = '商品资料导入'
        and normalized_data->>'procurement_cny' is null
        and normalized_data->>'packaging_cny' is null
        and normalized_data->>'other_cost_cny' is null
        and normalized_data->>'sale_usd' is null))
  );

revoke all on function public.split_product_import_row(uuid,uuid,text) from public,anon;
grant execute on function public.split_product_import_row(uuid,uuid,text) to authenticated;
revoke all on function public.apply_product_import_review(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_product_import_review(uuid,uuid,jsonb) to service_role;

commit;
