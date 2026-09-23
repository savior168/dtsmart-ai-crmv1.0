-- Review and publication must lock the batch before touching its source rows.
-- The API validates product fields; this RPC provides the transactional state
-- boundary and is callable only with the server-side service role.
begin;

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
  if target.parser_version is distinct from 'A1-V12'
    or target.summary->>'parser_version' is distinct from 'A1-V12' then
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
        or (next_data->>'procurement_cny' is null and next_data->>'packaging_cny' is null
          and next_data->>'other_cost_cny' is null and next_data->>'sale_usd' is null)) then
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

revoke all on function public.apply_product_import_review(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_product_import_review(uuid,uuid,jsonb) to service_role;

commit;
