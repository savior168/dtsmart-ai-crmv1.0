-- Keep the old eight-argument function available while the web application
-- rolls out. New claims use this explicit stage-aware overload.
create or replace function public.claim_public_customer(
  p_customer_id uuid,p_channel text,p_result text,p_next_plan text,
  p_storage_path text,p_filename text,p_mime_type text,p_size_bytes bigint,p_stage text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users; target public.customers; created_followup public.followups;
  created_attachment public.attachments; created_protection public.customer_protection;
  created_claim public.customer_claims; channel text; stage text; cycle_id uuid:=gen_random_uuid(); plan text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','SUPERVISOR','ADMIN') then raise exception '只有已启用且具备认领权限的用户可以认领公海客户'; end if;
  channel:=upper(trim(coalesce(p_channel,'')));
  if channel not in ('EMAIL','WHATSAPP','PHONE','LINKEDIN','OTHER') then raise exception '请选择有效的联系渠道'; end if;
  stage:=upper(trim(coalesce(p_stage,'CLAIMED')));
  if stage not in ('CLAIMED','FOLLOWING','QUOTE','DEAL','RELEASED') then raise exception '请选择有效的客户阶段'; end if;
  if nullif(trim(coalesce(p_result,'')),'') is null then raise exception '请选择本次真实联系结果'; end if;
  plan:=nullif(trim(coalesce(p_next_plan,'')), '');
  if plan is null then raise exception '请填写本次联系纪要及下一步安排'; end if;
  if stage <> 'CLAIMED' and (nullif(trim(coalesce(p_storage_path,'')),'') is null or nullif(trim(coalesce(p_filename,'')),'') is null) then
    raise exception '潜在客户以外的阶段必须上传真实凭证附件';
  end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.acquisition_scope<>'PUBLIC_POOL' or target.pool_status<>'AVAILABLE' or target.owner_id is not null then raise exception '该客户已被认领或当前不属于可认领公海'; end if;
  insert into public.followups(customer_id,user_id,type,content,next_follow_date,outcome)
  values(target.id,actor.id,channel,trim(p_result)||E'\n联系纪要及下一步：'||plan,null,'CONTACT_ONLY') returning * into created_followup;
  if nullif(trim(coalesce(p_storage_path,'')),'') is not null then
    insert into public.attachments(customer_id,followup_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
    values(target.id,created_followup.id,actor.id,p_filename,p_filename,p_storage_path,p_mime_type,p_size_bytes,'CLAIM_EVIDENCE') returning * into created_attachment;
  end if;
  insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
  values(target.id,actor.id,'INTENT',now(),now()+interval '90 days','ACTIVE',0) returning * into created_protection;
  update public.customers set owner_id=actor.id,owner_user_id=actor.id,status=stage,pool_status='CLAIMED',assigned_via='SELF_CLAIM',claimed_at=now(),ownership_cycle_id=cycle_id,last_contact_time=now(),updated_at=now() where id=target.id;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,evidence_followup_id,evidence_attachment_id)
  values(target.id,actor.id,'CLAIM','SELF_CLAIM',actor.name,now(),created_followup.id,created_attachment.id) returning * into created_claim;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PUBLIC_CUSTOMER_CLAIM','customer',target.id,jsonb_build_object('customer_name',target.company_name,'protection_expires_at',created_protection.expire_date,'claim_id',created_claim.id,'stage',stage,'has_evidence',created_attachment.id is not null));
  return jsonb_build_object('customer_id',target.id,'followup_id',created_followup.id,'attachment_id',created_attachment.id,'stage',stage,'protection_expire_date',created_protection.expire_date);
end $$;

grant execute on function public.claim_public_customer(uuid,text,text,text,text,text,text,bigint,text) to authenticated;
