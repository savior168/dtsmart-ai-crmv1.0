-- Serialize review-count refreshes with publication on the same batch row.
begin;

-- Several saleable variants can share one literal Excel cell. Keep the exact
-- cell address and distinguish manually reviewed variants without fabricating
-- another spreadsheet coordinate.
alter table public.product_import_rows add column if not exists source_variant integer not null default 1;
alter table public.product_import_rows add column if not exists source_excerpt text;
do $$
declare old_constraint text;
begin
  select conname into old_constraint from pg_constraint
    where conrelid='public.product_import_rows'::regclass and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (batch_id, source_sheet, source_row, source_cell)';
  if old_constraint is not null then
    execute format('alter table public.product_import_rows drop constraint %I',old_constraint);
  end if;
end $$;
create unique index if not exists product_import_rows_source_variant_key
  on public.product_import_rows(batch_id,source_sheet,source_row,source_cell,source_variant);
alter table public.product_import_rows add constraint product_import_rows_source_variant_positive check (source_variant>=1);

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
  if target.parser_version is distinct from 'A1-V12'
    or target.summary->>'parser_version' is distinct from 'A1-V12' then
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

revoke all on function public.split_product_import_row(uuid,uuid,text) from public, anon;
grant execute on function public.split_product_import_row(uuid,uuid,text) to authenticated;

create or replace function public.refresh_product_import_batch_counts(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.product_import_batches; saved_count integer; valid_rows integer;
  review_rows integer; error_rows integer; published_rows integer; uncovered boolean; next_status text;
begin
  select * into target from public.product_import_batches where id=p_batch_id for update;
  if target.id is null then raise exception '导入批次不存在'; end if;
  if target.status not in ('REVIEW','READY','FAILED','PUBLISHED') then raise exception '导入批次正在发布或已结束，不能刷新核对状态'; end if;
  select count(*), count(*) filter (where status='VALID'), count(*) filter (where status='REVIEW'),
    count(*) filter (where status='ERROR'), count(*) filter (where status='PUBLISHED')
    into saved_count,valid_rows,review_rows,error_rows,published_rows
    from public.product_import_rows where batch_id=p_batch_id;
  if saved_count <> target.candidate_count then
    update public.product_import_batches set status='FAILED',updated_at=now() where id=p_batch_id;
    return jsonb_build_object('complete',false,'saved_count',saved_count,'expected_count',target.candidate_count);
  end if;
  if target.status='PUBLISHED' then
    if valid_rows>0 or review_rows>0 or error_rows>0 then raise exception '已发布批次的来源状态不一致'; end if;
    return jsonb_build_object('complete',true,'status','PUBLISHED','published_count',published_rows);
  end if;
  uncovered:=coalesce(jsonb_array_length(target.summary->'uncovered_sheets'),0)>0;
  next_status:=case when review_rows>0 or error_rows>0 or uncovered then 'REVIEW'
    when valid_rows>0 then 'READY' when published_rows>0 then 'PUBLISHED' else 'READY' end;
  update public.product_import_batches set valid_count=valid_rows,review_count=review_rows,
    error_count=error_rows,published_count=published_rows,status=next_status,updated_at=now()
    where id=p_batch_id;
  return jsonb_build_object('complete',true,'status',next_status,'valid_count',valid_rows,
    'review_count',review_rows,'error_count',error_rows,'published_count',published_rows);
end $$;

revoke all on function public.refresh_product_import_batch_counts(uuid) from public, anon, authenticated;
grant execute on function public.refresh_product_import_batch_counts(uuid) to service_role;

commit;
