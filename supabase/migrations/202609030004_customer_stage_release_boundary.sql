begin;

-- RELEASED is an ownership transition, never a customer stage.  It must go
-- through release_customer so owner, protection, pool eligibility and history
-- change together.
create or replace function public.change_customer_stage_with_evidence(
  p_customer_id uuid,
  p_status text,
  p_reason text,
  p_storage_path text default null,
  p_filename text default null,
  p_mime_type text default null,
  p_size_bytes bigint default null
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  actor public.users;
  target public.customers;
  target_status text:=upper(trim(coalesce(p_status,'')));
  reason_value text:=trim(coalesce(p_reason,''));
  attachment_id uuid;
  expires_at timestamptz;
  protection_type text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前账号不存在或未启用'; end if;

  select * into target from public.customers
  where id=p_customer_id and deleted_at is null
  for update;
  if target.id is null then raise exception '客户不存在或已删除'; end if;
  if target.owner_id is null then raise exception '公海待认领客户不能直接修改阶段，请先分配或由销售员认领'; end if;
  if actor.role<>'ADMIN' and target.owner_id<>actor.id then
    raise exception '只能修改归属自己的客户阶段';
  end if;
  if target_status not in ('CLAIMED','FOLLOWING','QUOTE','DEAL') then
    raise exception '释放客户必须使用释放流程，不能作为阶段修改';
  end if;
  if target.status=target_status then raise exception '客户当前已经是所选阶段'; end if;
  if reason_value='' then raise exception '请填写真实、可追溯的阶段变更原因'; end if;

  if target_status in ('FOLLOWING','QUOTE','DEAL') then
    if nullif(trim(coalesce(p_storage_path,'')),'') is null
      or nullif(trim(coalesce(p_filename,'')),'') is null then
      raise exception '变更为意向客户、报价中或已成交时必须上传真实凭证';
    end if;
    if coalesce(p_mime_type,'') not in ('image/jpeg','image/png','image/webp','application/pdf') then
      raise exception '阶段凭证仅支持 JPG、PNG、WebP 图片或 PDF 文件';
    end if;
  end if;

  if nullif(trim(coalesce(p_storage_path,'')),'') is not null then
    insert into public.attachments(customer_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
    values(target.id,actor.id,trim(p_filename),trim(p_filename),trim(p_storage_path),p_mime_type,p_size_bytes,'STAGE_EVIDENCE')
    returning id into attachment_id;
  end if;

  update public.customer_protection
  set status='SUPERSEDED'
  where customer_id=target.id and owner_id=target.owner_id and status='ACTIVE';

  expires_at:=case target_status when 'DEAL' then null when 'QUOTE' then now()+interval '180 days' else now()+interval '90 days' end;
  protection_type:=case target_status when 'DEAL' then 'DEAL' when 'QUOTE' then 'QUOTE' else 'INTENT' end;
  insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
  values(target.id,target.owner_id,protection_type,now(),expires_at,'ACTIVE',0);

  update public.customers
  set status=target_status,
      pool_status='CLAIMED',
      updated_at=now()
  where id=target.id;

  insert into public.customer_status_history(customer_id,from_status,to_status,changed_by,reason)
  values(target.id,target.status,target_status,actor.id,reason_value);

  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_STAGE','customer',target.id,jsonb_build_object(
    'customer_name',target.company_name,
    'from_status',target.status,
    'to_status',target_status,
    'reason',reason_value,
    'evidence_attachment_id',attachment_id
  ));

  return jsonb_build_object('customer_id',target.id,'from_status',target.status,'to_status',target_status,'evidence_attachment_id',attachment_id);
end $$;

grant execute on function public.change_customer_stage_with_evidence(uuid,text,text,text,text,text,bigint) to authenticated;

commit;
