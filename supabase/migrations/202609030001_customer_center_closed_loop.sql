begin;

-- AI task removal is an archive operation. Execution history, evidence and
-- immutable usage/cost ledgers must remain traceable after a task is hidden.
alter table public.ai_screening_tasks add column if not exists archived_at timestamptz;
create index if not exists ai_screening_tasks_active_list_idx
  on public.ai_screening_tasks(user_id,updated_at desc) where archived_at is null;

-- Preserve where a lead originally entered the system even after it is later
-- released into the public pool. acquisition_scope describes the current
-- ownership lane; origin_source is immutable provenance.
alter table public.customers add column if not exists origin_source text;
update public.customers
set origin_source = coalesce(nullif(trim(source), ''), nullif(trim(source_type), ''),
  case when acquisition_scope = 'PUBLIC_POOL' then 'SYSTEM_PUBLIC_POOL' else 'USER_MANUAL' end)
where origin_source is null;
alter table public.customers alter column origin_source set default 'USER_MANUAL';

create or replace function public.keep_customer_origin_source()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and old.origin_source is not null and new.origin_source is distinct from old.origin_source then
    raise exception '客户原始来源由系统保留，不能修改';
  end if;
  new.origin_source:=coalesce(new.origin_source,nullif(trim(new.source),''),nullif(trim(new.source_type),''),'USER_MANUAL');
  return new;
end $$;
drop trigger if exists customers_keep_origin_source on public.customers;
create trigger customers_keep_origin_source before insert or update on public.customers
for each row execute function public.keep_customer_origin_source();

-- A follow-up is not automatically a sales intention. Only an explicit,
-- evidenced customer response may promote a potential lead to intention.
alter table public.followups add column if not exists outcome text not null default 'CONTACT_ONLY';
alter table public.followups drop constraint if exists followups_outcome_check;
alter table public.followups add constraint followups_outcome_check
  check (outcome in ('CONTACT_ONLY','INTEREST','NO_INTEREST'));

create or replace function public.promote_customer_from_evidenced_interest()
returns trigger language plpgsql security definer set search_path=public as $$
declare f public.followups; c public.customers;
begin
  if new.followup_id is null then return new; end if;
  select * into f from public.followups where id=new.followup_id;
  if f.outcome<>'INTEREST' then return new; end if;
  select * into c from public.customers where id=f.customer_id for update;
  if c.id is not null and c.owner_id=f.user_id and c.status in ('UNCLAIMED','CLAIMED') then
    update public.customers set status='FOLLOWING',updated_at=now() where id=c.id;
    insert into public.customer_status_history(customer_id,from_status,to_status,changed_by,reason)
    values(c.id,c.status,'FOLLOWING',f.user_id,'客户明确表达采购意向，且跟进凭证已上传');
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(f.user_id,'CUSTOMER_STAGE_EVIDENCED','customer',c.id,
      jsonb_build_object('from_status',c.status,'to_status','FOLLOWING','followup_id',f.id,'attachment_id',new.id));
  end if;
  return new;
end $$;
drop trigger if exists attachments_promote_evidenced_interest on public.attachments;
create trigger attachments_promote_evidenced_interest after insert on public.attachments
for each row execute function public.promote_customer_from_evidenced_interest();

-- Claiming establishes ownership and a 90-day protection period. It does not
-- prove customer intention, so the stage remains potential (CLAIMED).
create or replace function public.claim_public_customer(
  p_customer_id uuid,p_channel text,p_result text,p_next_plan text,
  p_storage_path text,p_filename text,p_mime_type text,p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.customers; created_followup public.followups;
  created_attachment public.attachments; created_protection public.customer_protection;
  created_claim public.customer_claims; channel text; cycle_id uuid:=gen_random_uuid();
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('SALES','SUPERVISOR') then raise exception '只有已启用的销售员或主管可以认领公海客户'; end if;
  channel:=upper(trim(coalesce(p_channel,'')));
  if channel not in ('EMAIL','WHATSAPP','PHONE','LINKEDIN','OTHER') then raise exception '请选择有效的跟进渠道'; end if;
  if nullif(trim(coalesce(p_result,'')),'') is null then raise exception '请填写本次真实联系结果'; end if;
  if nullif(trim(coalesce(p_next_plan,'')),'') is null then raise exception '请填写下一步跟进计划'; end if;
  if nullif(trim(coalesce(p_storage_path,'')),'') is null or nullif(trim(coalesce(p_filename,'')),'') is null then raise exception '认领必须上传真实联系凭证'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.acquisition_scope<>'PUBLIC_POOL' or target.pool_status<>'AVAILABLE' or target.owner_id is not null then raise exception '该客户已被认领或当前不属于可认领公海'; end if;
  insert into public.followups(customer_id,user_id,type,content,next_follow_date,outcome)
  values(target.id,actor.id,channel,trim(p_result)||E'\n下一步：'||trim(p_next_plan),null,'CONTACT_ONLY') returning * into created_followup;
  insert into public.attachments(customer_id,followup_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
  values(target.id,created_followup.id,actor.id,p_filename,p_filename,p_storage_path,p_mime_type,p_size_bytes,'CLAIM_EVIDENCE') returning * into created_attachment;
  insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
  values(target.id,actor.id,'INTENT',now(),now()+interval '90 days','ACTIVE',0) returning * into created_protection;
  update public.customers set owner_id=actor.id,owner_user_id=actor.id,status='CLAIMED',pool_status='CLAIMED',assigned_via='SELF_CLAIM',claimed_at=now(),ownership_cycle_id=cycle_id,last_contact_time=now(),updated_at=now() where id=target.id;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,evidence_followup_id,evidence_attachment_id)
  values(target.id,actor.id,'CLAIM','SELF_CLAIM',actor.name,now(),created_followup.id,created_attachment.id) returning * into created_claim;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PUBLIC_CUSTOMER_CLAIM','customer',target.id,jsonb_build_object('customer_name',target.company_name,'protection_expires_at',created_protection.expire_date,'claim_id',created_claim.id,'stage','POTENTIAL'));
  return jsonb_build_object('customer_id',target.id,'followup_id',created_followup.id,'attachment_id',created_attachment.id,'protection_expire_date',created_protection.expire_date);
end $$;

-- Refresh all expired ownership cycles. Normal leads return to the public
-- pool; customers with active commercial documents or inactive owners enter
-- the administrator queue instead. Deals remain permanently protected.
create or replace function public.refresh_expired_public_customers()
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer:=0;
begin
  with candidates as (
    select c.id,c.owner_id,p.id protection_id,
      (u.status in ('DISABLED','DEPARTED') or
       exists(select 1 from public.quotes q where q.customer_id=c.id and q.status in ('SENT','CONFIRMED')) or
       exists(select 1 from public.sales_orders o where o.customer_id=c.id and o.status not in ('CANCELLED'))) as needs_admin
    from public.customers c
    join public.users u on u.id=c.owner_id
    join lateral (select * from public.customer_protection cp where cp.customer_id=c.id and cp.owner_id=c.owner_id and cp.status='ACTIVE' order by cp.start_date desc limit 1) p on true
    where c.deleted_at is null and c.owner_id is not null and c.status<>'DEAL'
      and p.expire_date is not null and p.expire_date+interval '3 days'<now()
      and not exists(select 1 from public.customer_protection_renewal_requests r where r.protection_id=p.id and r.status='PENDING')
    for update of c
  ), released as (
    update public.customers c set owner_id=null,owner_user_id=null,status='UNCLAIMED',
      acquisition_scope=case when e.needs_admin then c.acquisition_scope else 'PUBLIC_POOL' end,
      pool_status=case when e.needs_admin then 'PENDING_ALLOCATION' else 'AVAILABLE' end,
      assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now()
    from candidates e where c.id=e.id returning c.id,e.owner_id,e.protection_id,e.needs_admin
  ), protections as (
    update public.customer_protection p set status='EXPIRED' from released r where p.id=r.protection_id returning p.id
  ), claims as (
    insert into public.customer_claims(customer_id,user_id,action,claim_type,claimed_at,released_at,release_reason,source_owner_id)
    select r.id,r.owner_id,'RELEASE','ADMIN_ASSIGN',now(),now(),case when r.needs_admin then '保护到期，存在业务单据或账号停用，转管理员处理' else '保护到期且未有效续期，进入客户公海' end,r.owner_id from released r
    returning id
  ) select count(*) into changed from released;
  return changed;
end $$;

create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; previous_owner uuid; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '只能释放归属自己的客户'; end if;
  if target.status='DEAL' then raise exception '已成交客户为永久保护，不能直接释放'; end if;
  if exists(select 1 from public.quotes q where q.customer_id=target.id and q.status in ('SENT','CONFIRMED'))
    or exists(select 1 from public.sales_orders o where o.customer_id=target.id and o.status not in ('CANCELLED'))
  then raise exception '客户存在进行中的报价或订单，请先完成或取消业务单据后再释放'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '请填写释放原因'; end if;
  previous_owner:=target.owner_id;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and owner_id=previous_owner and status='ACTIVE';
  update public.customers set owner_id=null,owner_user_id=null,status='UNCLAIMED',acquisition_scope='PUBLIC_POOL',pool_status='AVAILABLE',assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now() where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason,source_owner_id)
  values(target.id,actor.id,'RELEASE','SELF_CLAIM',actor.name,last_claim,now(),trim(p_reason),previous_owner);
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'CUSTOMER_RELEASE','customer',target.id,jsonb_build_object('reason',trim(p_reason),'destination','PUBLIC_POOL'));
  return target;
end $$;

-- Customer stages follow verifiable business events, in both directions:
-- sent quote -> quotation; confirmed order -> deal; cancellation rolls back
-- to the strongest remaining verified event. Warehouse preparation never
-- determines whether a sale exists.
create or replace function public.promote_customer_stage_from_business_document()
returns trigger language plpgsql security definer set search_path=public as $$
declare customer_id_value uuid; owner_id_value uuid; previous text; desired text;
  expires_at timestamptz; actor_id uuid;
begin
  customer_id_value:=new.customer_id;
  -- NEW has a different row type for quotes and sales_orders. Reading a field
  -- that does not exist on one of those records raises at runtime even inside
  -- a CASE expression, so resolve the actor through JSON safely.
  actor_id:=coalesce(
    auth.uid(),
    nullif(to_jsonb(new)->>'owner_id','')::uuid,
    nullif(to_jsonb(new)->>'sales_user_id','')::uuid
  );
  select owner_id,status into owner_id_value,previous from public.customers where id=customer_id_value and deleted_at is null for update;
  if owner_id_value is null then return new; end if;

  if exists(select 1 from public.sales_orders o where o.customer_id=customer_id_value and o.status<>'CANCELLED') then
    desired:='DEAL'; expires_at:=null;
  elsif exists(select 1 from public.quotes q where q.customer_id=customer_id_value and q.status in ('SENT','CONFIRMED')) then
    desired:='QUOTE'; expires_at:=now()+interval '180 days';
  elsif exists(select 1 from public.followups f join public.attachments a on a.followup_id=f.id where f.customer_id=customer_id_value and f.outcome='INTEREST') then
    desired:='FOLLOWING'; expires_at:=now()+interval '90 days';
  else
    desired:='CLAIMED'; expires_at:=now()+interval '90 days';
  end if;

  if desired is distinct from previous then
    update public.customer_protection set status='SUPERSEDED' where customer_id=customer_id_value and owner_id=owner_id_value and status='ACTIVE';
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(customer_id_value,owner_id_value,case desired when 'DEAL' then 'DEAL' when 'QUOTE' then 'QUOTE' else 'INTENT' end,now(),expires_at,'ACTIVE',0);
    update public.customers set status=desired,updated_at=now() where id=customer_id_value;
    insert into public.customer_status_history(customer_id,from_status,to_status,changed_by,reason)
    values(customer_id_value,previous,desired,actor_id,
      case desired when 'DEAL' then '客户确认并生成有效销售订单' when 'QUOTE' then '正式报价已发送给客户' when 'FOLLOWING' then '订单或报价取消，保留已有意向凭证' else '订单或报价取消，回到潜在客户' end);
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor_id,'CUSTOMER_STAGE_DOCUMENT_SYNC','customer',customer_id_value,jsonb_build_object('from_status',previous,'to_status',desired,'source_table',tg_table_name,'source_id',new.id));
  end if;
  return new;
end $$;

drop trigger if exists quotes_promote_customer_stage on public.quotes;
create trigger quotes_promote_customer_stage after insert or update of status on public.quotes
for each row execute function public.promote_customer_stage_from_business_document();
drop trigger if exists sales_orders_promote_customer_stage on public.sales_orders;
create trigger sales_orders_promote_customer_stage after insert or update of status on public.sales_orders
for each row execute function public.promote_customer_stage_from_business_document();

commit;
