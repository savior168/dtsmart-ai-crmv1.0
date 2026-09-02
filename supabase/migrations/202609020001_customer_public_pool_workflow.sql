begin;

-- Public-pool state is deliberately separate from the sales stage. A customer
-- may be FOLLOWING while it is CLAIMED; mixing these two concepts previously
-- made protection expiry and reassignment ambiguous.
alter table public.customers
  add column if not exists acquisition_scope text not null default 'PRIVATE',
  add column if not exists pool_status text,
  add column if not exists assigned_via text,
  add column if not exists claimed_at timestamptz,
  add column if not exists ownership_cycle_id uuid;

alter table public.customers drop constraint if exists customers_acquisition_scope_check;
alter table public.customers add constraint customers_acquisition_scope_check
  check (acquisition_scope in ('PRIVATE','PUBLIC_POOL'));
alter table public.customers drop constraint if exists customers_pool_status_check;
alter table public.customers add constraint customers_pool_status_check
  check (pool_status is null or pool_status in ('AVAILABLE','CLAIMED','PENDING_ALLOCATION','INVALID'));
alter table public.customers drop constraint if exists customers_assigned_via_check;
alter table public.customers add constraint customers_assigned_via_check
  check (assigned_via is null or assigned_via in ('PRIVATE_CREATE','PRIVATE_IMPORT','SELF_CLAIM','ADMIN_ASSIGN','HANDOVER'));

update public.customers
set acquisition_scope='PRIVATE',
    assigned_via=coalesce(assigned_via,case when source in ('BATCH_IMPORT','EXCEL_IMPORT') then 'PRIVATE_IMPORT' else 'PRIVATE_CREATE' end)
where acquisition_scope is null or assigned_via is null;

create index if not exists customers_pool_state_updated_idx
  on public.customers(acquisition_scope,pool_status,updated_at desc)
  where deleted_at is null;
create index if not exists customers_owner_pool_idx
  on public.customers(owner_id,acquisition_scope,pool_status)
  where deleted_at is null;

-- Private/manual customers belong to their creator immediately and receive
-- the same auditable 90-day protection cycle. Existing owned rows without a
-- protection record are backfilled once so renewal behavior is consistent.
insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
select c.id,c.owner_id,case when c.status='DEAL' then 'DEAL' when c.status='QUOTE' then 'QUOTE' else 'INTENT' end,
  c.created_at,case when c.status='DEAL' then null when c.status='QUOTE' then c.created_at+interval '180 days' else c.created_at+interval '90 days' end,'ACTIVE',0
from public.customers c
where c.deleted_at is null and c.owner_id is not null
  and not exists(select 1 from public.customer_protection p where p.customer_id=c.id and p.owner_id=c.owner_id and p.status='ACTIVE');

create or replace function public.create_initial_private_customer_protection()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.owner_id is not null and new.acquisition_scope='PRIVATE' then
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(new.id,new.owner_id,case when new.status='DEAL' then 'DEAL' when new.status='QUOTE' then 'QUOTE' else 'INTENT' end,
      new.created_at,case when new.status='DEAL' then null when new.status='QUOTE' then new.created_at+interval '180 days' else new.created_at+interval '90 days' end,'ACTIVE',0);
  end if;
  return new;
end $$;
drop trigger if exists customers_initial_private_protection on public.customers;
create trigger customers_initial_private_protection after insert on public.customers
for each row execute function public.create_initial_private_customer_protection();

alter table public.users
  add column if not exists departed_at timestamptz,
  add column if not exists manager_id uuid references public.users(id) on delete set null;
alter table public.users drop constraint if exists users_status_v3_check;
alter table public.users drop constraint if exists users_status_check;
alter table public.users add constraint users_status_v4_check
  check (status in ('PENDING','ACTIVE','REJECTED','DISABLED','DEPARTED','LOCKED'));
create index if not exists users_manager_status_idx on public.users(manager_id,status,role);

alter table public.customer_protection drop constraint if exists customer_protection_extension_count_check;
alter table public.customer_protection add constraint customer_protection_extension_count_check
  check (extension_count >= 0);

-- Eva is the current default direct supervisor. The email fallback keeps the
-- assignment stable if her display name is changed later.
update public.users sales
set manager_id=supervisor.id
from lateral (
  select id from public.users
  where role='SUPERVISOR' and status='ACTIVE'
    and (lower(trim(coalesce(name,'')))='eva' or lower(email)='3041624715@qq.com')
  order by case when lower(trim(coalesce(name,'')))='eva' then 0 else 1 end,created_at
  limit 1
) supervisor
where sales.role='SALES' and sales.manager_id is null;

create or replace function public.set_default_sales_manager()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='SALES' and new.manager_id is null then
    select id into new.manager_id from public.users
    where role='SUPERVISOR' and status='ACTIVE'
      and (lower(trim(coalesce(name,'')))='eva' or lower(email)='3041624715@qq.com')
    order by case when lower(trim(coalesce(name,'')))='eva' then 0 else 1 end,created_at
    limit 1;
  elsif new.role<>'SALES' then
    new.manager_id:=null;
  end if;
  return new;
end $$;
drop trigger if exists users_set_default_sales_manager on public.users;
create trigger users_set_default_sales_manager before insert or update of role,manager_id on public.users
for each row execute function public.set_default_sales_manager();

create table if not exists public.customer_assignment_batches (
  id uuid primary key default gen_random_uuid(),
  batch_number text not null unique,
  batch_name text not null,
  reason_type text not null check (reason_type in ('PUBLIC_POOL_ASSIGN','ACCOUNT_HANDOVER','PENDING_ASSIGN','CORRECTION')),
  reason text not null,
  source_user_id uuid references public.users(id),
  target_user_id uuid references public.users(id),
  mode text not null check (mode in ('ASSIGN','RELEASE')),
  customer_count integer not null default 0 check (customer_count >= 0),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.customer_assignment_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.customer_assignment_batches(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  previous_owner_id uuid references public.users(id),
  next_owner_id uuid references public.users(id),
  previous_scope text,
  previous_pool_status text,
  created_at timestamptz not null default now(),
  unique(batch_id,customer_id)
);
create index if not exists assignment_batches_created_idx on public.customer_assignment_batches(created_at desc);
create index if not exists assignment_items_customer_idx on public.customer_assignment_items(customer_id,created_at desc);

alter table public.customer_claims
  add column if not exists source_owner_id uuid references public.users(id),
  add column if not exists assignment_batch_id uuid references public.customer_assignment_batches(id),
  add column if not exists evidence_followup_id uuid references public.followups(id),
  add column if not exists evidence_attachment_id uuid references public.attachments(id);

create table if not exists public.customer_protection_renewal_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  protection_id uuid not null references public.customer_protection(id) on delete restrict,
  owner_id uuid not null references public.users(id),
  renewal_number integer not null check (renewal_number > 0),
  reason text not null,
  next_plan text not null,
  evidence_followup_id uuid not null references public.followups(id) on delete restrict,
  evidence_attachment_id uuid not null references public.attachments(id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
  reviewed_by uuid references public.users(id),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(protection_id,renewal_number)
);
create index if not exists protection_renewal_pending_idx
  on public.customer_protection_renewal_requests(status,created_at desc);
create index if not exists protection_renewal_owner_idx
  on public.customer_protection_renewal_requests(owner_id,created_at desc);

alter table public.customer_assignment_batches enable row level security;
alter table public.customer_assignment_items enable row level security;
alter table public.customer_protection_renewal_requests enable row level security;

drop policy if exists assignment_batches_admin_select on public.customer_assignment_batches;
create policy assignment_batches_admin_select on public.customer_assignment_batches for select to authenticated
  using(public.current_user_is_admin());
drop policy if exists assignment_items_admin_select on public.customer_assignment_items;
create policy assignment_items_admin_select on public.customer_assignment_items for select to authenticated
  using(public.current_user_is_admin());
drop policy if exists protection_renewal_visible on public.customer_protection_renewal_requests;
create policy protection_renewal_visible on public.customer_protection_renewal_requests for select to authenticated
  using(owner_id=auth.uid() or public.current_user_is_elevated());

grant select on public.customer_assignment_batches,public.customer_assignment_items to authenticated;
grant select on public.customer_protection_renewal_requests to authenticated;

-- Keep ADMIN assignment exclusive. Sales and supervisors retain self-claim;
-- supervisors receive only the narrow renewal-review action.
insert into public.role_permission_settings(role_code,permission_code,enabled)
values
  ('SALES','customers.claim',true),('SUPERVISOR','customers.claim',true),
  ('SUPERVISOR','customers.renew.review',true),
  ('SALES','customers.assign',false),('SUPERVISOR','customers.assign',false),
  ('SALES','customers.handover',false),('SUPERVISOR','customers.handover',false)
on conflict(role_code,permission_code) do update set enabled=excluded.enabled;
insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('ADMIN','customers.assign',true),('ADMIN','customers.handover',true),('ADMIN','customers.renew.review',true)
on conflict(role_code,permission_code) do update set enabled=true;

create or replace function public.claim_public_customer(
  p_customer_id uuid,
  p_channel text,
  p_result text,
  p_next_plan text,
  p_storage_path text,
  p_filename text,
  p_mime_type text,
  p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.customers;
  created_followup public.followups;
  created_attachment public.attachments;
  created_protection public.customer_protection;
  created_claim public.customer_claims;
  channel text;
  cycle_id uuid:=gen_random_uuid();
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
  if target.acquisition_scope<>'PUBLIC_POOL' or target.pool_status<>'AVAILABLE' or target.owner_id is not null then
    raise exception '该客户已被认领或当前不属于可认领公海';
  end if;

  insert into public.followups(customer_id,user_id,type,content,next_follow_date)
  values(target.id,actor.id,channel,trim(p_result)||E'\n下一步：'||trim(p_next_plan),null)
  returning * into created_followup;
  insert into public.attachments(customer_id,followup_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
  values(target.id,created_followup.id,actor.id,p_filename,p_filename,p_storage_path,p_mime_type,p_size_bytes,'CLAIM_EVIDENCE')
  returning * into created_attachment;
  insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
  values(target.id,actor.id,'INTENT',now(),now()+interval '90 days','ACTIVE',0)
  returning * into created_protection;
  update public.customers set owner_id=actor.id,owner_user_id=actor.id,status='FOLLOWING',pool_status='CLAIMED',assigned_via='SELF_CLAIM',claimed_at=now(),ownership_cycle_id=cycle_id,last_contact_time=now(),updated_at=now()
  where id=target.id;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,evidence_followup_id,evidence_attachment_id)
  values(target.id,actor.id,'CLAIM','SELF_CLAIM',actor.name,now(),created_followup.id,created_attachment.id)
  returning * into created_claim;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'PUBLIC_CUSTOMER_CLAIM','customer',target.id,jsonb_build_object('customer_name',target.company_name,'protection_expires_at',created_protection.expire_date,'claim_id',created_claim.id));
  return jsonb_build_object('customer_id',target.id,'followup_id',created_followup.id,'attachment_id',created_attachment.id,'protection_expire_date',created_protection.expire_date);
end $$;

create or replace function public.admin_assign_eligible_customers(
  p_customer_ids uuid[],p_target_user_id uuid,p_batch_name text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  assignee public.users;
  target public.customers;
  batch public.customer_assignment_batches;
  batch_no text;
  assigned_count integer:=0;
  cycle_id uuid;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role<>'ADMIN' then raise exception '仅系统管理员可以分配客户'; end if;
  select * into assignee from public.users where id=p_target_user_id and status='ACTIVE' and role in ('SALES','SUPERVISOR');
  if assignee.id is null then raise exception '接收销售员不存在或账号未启用'; end if;
  if coalesce(array_length(p_customer_ids,1),0)=0 then raise exception '请选择需要分配的客户'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '请填写分配原因'; end if;
  batch_no:='FP-'||to_char(clock_timestamp(),'YYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.customer_assignment_batches(batch_number,batch_name,reason_type,reason,target_user_id,mode,created_by)
  values(batch_no,coalesce(nullif(trim(p_batch_name),''),'公海客户分配'),
    case when exists(select 1 from public.customers where id=any(p_customer_ids) and pool_status='PENDING_ALLOCATION') then 'PENDING_ASSIGN' else 'PUBLIC_POOL_ASSIGN' end,
    trim(p_reason),assignee.id,'ASSIGN',actor.id) returning * into batch;

  for target in select * from public.customers where id=any(p_customer_ids) and deleted_at is null order by id for update loop
    if target.owner_id is not null or not (
      (target.acquisition_scope='PUBLIC_POOL' and target.pool_status='AVAILABLE') or
      (target.acquisition_scope='PRIVATE' and target.pool_status='PENDING_ALLOCATION')
    ) then raise exception '客户“%”已被认领或不属于管理员可分配范围',target.company_name; end if;
    cycle_id:=gen_random_uuid();
    update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and status='ACTIVE';
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(target.id,assignee.id,'INTENT',now(),now()+interval '90 days','ACTIVE',0);
    update public.customers set owner_id=assignee.id,owner_user_id=assignee.id,status='CLAIMED',
      pool_status=case when acquisition_scope='PUBLIC_POOL' then 'CLAIMED' else null end,
      assigned_via='ADMIN_ASSIGN',claimed_at=now(),ownership_cycle_id=cycle_id,updated_at=now()
    where id=target.id;
    insert into public.customer_assignment_items(batch_id,customer_id,previous_owner_id,next_owner_id,previous_scope,previous_pool_status)
    values(batch.id,target.id,null,assignee.id,target.acquisition_scope,target.pool_status);
    insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,assignment_batch_id)
    values(target.id,assignee.id,'CLAIM','ADMIN_ASSIGN',assignee.name,now(),batch.id);
    assigned_count:=assigned_count+1;
  end loop;
  update public.customer_assignment_batches set customer_count=assigned_count where id=batch.id;
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(assignee.id,'CUSTOMER_ADMIN_ASSIGNED','CUSTOMER','收到管理员分配的客户',format('系统管理员向您分配了 %s 个客户，分配批次：%s。',assigned_count,batch_no),'/customers','assignment_batch',batch.id,'assignment:'||batch.id,'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_BATCH_ASSIGN','assignment_batch',batch.id,jsonb_build_object('batch_number',batch_no,'target_user_id',assignee.id,'customer_count',assigned_count,'reason',p_reason));
  return jsonb_build_object('batch_id',batch.id,'batch_number',batch_no,'assigned_count',assigned_count);
end $$;

create or replace function public.handover_inactive_user_customers(
  p_source_user_id uuid,p_target_user_id uuid,p_mode text,p_batch_name text,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  source_user public.users;
  assignee public.users;
  target public.customers;
  batch public.customer_assignment_batches;
  batch_no text;
  moved_count integer:=0;
  cycle_id uuid;
  mode_value text:=upper(trim(coalesce(p_mode,'')));
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role<>'ADMIN' then raise exception '仅系统管理员可以执行离职客户交接'; end if;
  select * into source_user from public.users where id=p_source_user_id;
  if source_user.id is null or source_user.status not in ('DISABLED','DEPARTED') then raise exception '只有已停用或已离职账号才能执行客户交接'; end if;
  if source_user.role not in ('SALES','SUPERVISOR') then raise exception '仅销售员或主管账号存在销售客户交接'; end if;
  if mode_value not in ('ASSIGN','RELEASE') then raise exception '无效的交接方式'; end if;
  if mode_value='ASSIGN' then
    select * into assignee from public.users where id=p_target_user_id and status='ACTIVE' and role in ('SALES','SUPERVISOR');
    if assignee.id is null then raise exception '请选择已启用的接收销售员'; end if;
    if assignee.id=source_user.id then raise exception '接收人不能是原归属人'; end if;
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '请填写离职交接原因'; end if;
  batch_no:='LZ-'||to_char(clock_timestamp(),'YYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.customer_assignment_batches(batch_number,batch_name,reason_type,reason,source_user_id,target_user_id,mode,created_by)
  values(batch_no,coalesce(nullif(trim(p_batch_name),''),coalesce(source_user.name,source_user.email)||'客户交接'),'ACCOUNT_HANDOVER',trim(p_reason),source_user.id,assignee.id,mode_value,actor.id)
  returning * into batch;

  for target in select * from public.customers where owner_id=source_user.id and deleted_at is null order by id for update loop
    update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and owner_id=source_user.id and status='ACTIVE';
    if mode_value='ASSIGN' then
      cycle_id:=gen_random_uuid();
      insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
      values(target.id,assignee.id,case when target.status='DEAL' then 'DEAL' else 'INTENT' end,now(),case when target.status='DEAL' then null else now()+interval '90 days' end,'ACTIVE',0);
      update public.customers set owner_id=assignee.id,owner_user_id=assignee.id,
        pool_status=case when acquisition_scope='PUBLIC_POOL' then 'CLAIMED' else null end,
        assigned_via='HANDOVER',claimed_at=now(),ownership_cycle_id=cycle_id,updated_at=now()
      where id=target.id;
      update public.quotes set owner_id=assignee.id,updated_at=now() where customer_id=target.id;
      update public.sales_orders set sales_user_id=assignee.id,updated_at=now() where customer_id=target.id;
      update public.stock_orders set sales_user_id=assignee.id,updated_at=now() where sales_order_id in (select id from public.sales_orders where customer_id=target.id);
      insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,source_owner_id,assignment_batch_id)
      values(target.id,assignee.id,'TRANSFER','ADMIN_ASSIGN',assignee.name,now(),source_user.id,batch.id);
    else
      update public.customers set owner_id=null,owner_user_id=null,status='RELEASED',
        pool_status=case when acquisition_scope='PUBLIC_POOL' then 'AVAILABLE' else 'PENDING_ALLOCATION' end,
        assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now()
      where id=target.id;
      insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason,source_owner_id,assignment_batch_id)
      values(target.id,source_user.id,'RELEASE','ADMIN_ASSIGN',source_user.name,now(),now(),trim(p_reason),source_user.id,batch.id);
    end if;
    insert into public.customer_assignment_items(batch_id,customer_id,previous_owner_id,next_owner_id,previous_scope,previous_pool_status)
    values(batch.id,target.id,source_user.id,assignee.id,target.acquisition_scope,target.pool_status);
    moved_count:=moved_count+1;
  end loop;
  update public.customer_assignment_batches set customer_count=moved_count where id=batch.id;
  if mode_value='ASSIGN' and assignee.id is not null then
    insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
    values(assignee.id,'CUSTOMER_HANDOVER','CUSTOMER','收到客户交接',format('系统管理员将 %s 的 %s 个客户及关联业务交接给您，批次：%s。',coalesce(source_user.name,source_user.email),moved_count,batch_no),'/customers','assignment_batch',batch.id,'handover:'||batch.id,'INFO');
  end if;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_ACCOUNT_HANDOVER','assignment_batch',batch.id,jsonb_build_object('batch_number',batch_no,'source_user_id',source_user.id,'target_user_id',assignee.id,'mode',mode_value,'customer_count',moved_count,'reason',p_reason));
  return jsonb_build_object('batch_id',batch.id,'batch_number',batch_no,'customer_count',moved_count,'mode',mode_value);
end $$;

create or replace function public.submit_customer_protection_renewal(
  p_customer_id uuid,p_channel text,p_result text,p_next_plan text,
  p_storage_path text,p_filename text,p_mime_type text,p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor public.users;
  target public.customers;
  protection public.customer_protection;
  created_followup public.followups;
  created_attachment public.attachments;
  renewal public.customer_protection_renewal_requests;
  effective_expire timestamptz;
  next_expire timestamptz;
  next_count integer;
  channel text;
  auto_approve boolean;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '只能续期归属自己的客户'; end if;
  if target.status='DEAL' then raise exception '已成交客户为永久保护，无需续期'; end if;
  channel:=upper(trim(coalesce(p_channel,'')));
  if channel not in ('EMAIL','WHATSAPP','PHONE','LINKEDIN','OTHER') then raise exception '请选择有效的跟进渠道'; end if;
  if nullif(trim(coalesce(p_result,'')),'') is null or nullif(trim(coalesce(p_next_plan,'')),'') is null then raise exception '请填写真实跟进结果和下一步计划'; end if;
  if nullif(trim(coalesce(p_storage_path,'')),'') is null then raise exception '续期必须上传真实跟进凭证'; end if;
  select * into protection from public.customer_protection where customer_id=target.id and owner_id=actor.id and status='ACTIVE' order by start_date desc limit 1 for update;
  if protection.id is null then raise exception '当前客户没有有效保护记录'; end if;
  effective_expire:=protection.expire_date;
  if effective_expire is null then raise exception '当前客户为永久保护，无需续期'; end if;
  if now()<effective_expire-interval '15 days' then raise exception '仅可在保护到期前15天内申请续期'; end if;
  if now()>effective_expire+interval '3 days' then raise exception '续期宽限期已结束'; end if;
  if exists(select 1 from public.customer_protection_renewal_requests where protection_id=protection.id and status='PENDING') then raise exception '该客户已有待审核续期申请'; end if;

  insert into public.followups(customer_id,user_id,type,content,next_follow_date)
  values(target.id,actor.id,channel,trim(p_result)||E'\n下一步：'||trim(p_next_plan),null) returning * into created_followup;
  insert into public.attachments(customer_id,followup_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
  values(target.id,created_followup.id,actor.id,p_filename,p_filename,p_storage_path,p_mime_type,p_size_bytes,'PROTECTION_EVIDENCE') returning * into created_attachment;
  next_count:=coalesce(protection.extension_count,0)+1;
  auto_approve:=next_count<=2 or actor.role='SUPERVISOR';
  if auto_approve then
    next_expire:=effective_expire+interval '45 days';
    update public.customer_protection set expire_date=next_expire,extension_count=next_count,last_extended_at=now() where id=protection.id;
    insert into public.customer_protection_renewal_requests(customer_id,protection_id,owner_id,renewal_number,reason,next_plan,evidence_followup_id,evidence_attachment_id,status,reviewed_by,review_note,reviewed_at)
    values(target.id,protection.id,actor.id,next_count,trim(p_result),trim(p_next_plan),created_followup.id,created_attachment.id,'APPROVED',actor.id,case when actor.role='SUPERVISOR' and next_count>2 then '主管本人续期，无需审核' else '前两次续期凭证完整，自动生效' end,now()) returning * into renewal;
    insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'CUSTOMER_PROTECTION_RENEW','customer',target.id,jsonb_build_object('renewal_number',next_count,'expire_date',next_expire,'evidence_attachment_id',created_attachment.id,'approval','AUTO'));
    return jsonb_build_object('status','APPROVED','renewal_number',next_count,'expire_date',next_expire,'request_id',renewal.id);
  end if;

  insert into public.customer_protection_renewal_requests(customer_id,protection_id,owner_id,renewal_number,reason,next_plan,evidence_followup_id,evidence_attachment_id,status)
  values(target.id,protection.id,actor.id,next_count,trim(p_result),trim(p_next_plan),created_followup.id,created_attachment.id,'PENDING') returning * into renewal;
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  select u.id,'PROTECTION_RENEWAL_REVIEW','CUSTOMER','客户续期申请待审核',format('%s 提交了客户“%s”的第 %s 次续期申请。',coalesce(actor.name,actor.email),target.company_name,next_count),'/customers/pool?tab=renewals','protection_renewal',renewal.id,'renewal-review:'||renewal.id,'PENDING'
  from public.users u where u.status='ACTIVE' and u.id<>actor.id
    and (u.role='ADMIN' or (u.role='SUPERVISOR' and u.id=actor.manager_id));
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_PROTECTION_RENEW_REQUEST','customer',target.id,jsonb_build_object('renewal_number',next_count,'request_id',renewal.id,'evidence_attachment_id',created_attachment.id));
  return jsonb_build_object('status','PENDING','renewal_number',next_count,'request_id',renewal.id);
end $$;

create or replace function public.review_customer_protection_renewal(p_request_id uuid,p_decision text,p_review_note text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; request_row public.customer_protection_renewal_requests; request_owner public.users; protection public.customer_protection; decision text:=upper(trim(coalesce(p_decision,''))); next_expire timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role not in ('SUPERVISOR','ADMIN') then raise exception '只有主管或系统管理员可以审核续期'; end if;
  select * into request_row from public.customer_protection_renewal_requests where id=p_request_id for update;
  if request_row.id is null or request_row.status<>'PENDING' then raise exception '续期申请不存在或已经处理'; end if;
  if request_row.owner_id=actor.id then raise exception '不能审核自己的续期申请'; end if;
  select * into request_owner from public.users where id=request_row.owner_id;
  if actor.role='SUPERVISOR' and request_owner.manager_id is distinct from actor.id then raise exception '只能审核直属销售员的续期申请'; end if;
  if decision not in ('APPROVED','REJECTED') then raise exception '请选择通过或驳回'; end if;
  if decision='REJECTED' and nullif(trim(coalesce(p_review_note,'')),'') is null then raise exception '驳回续期必须填写原因'; end if;
  select * into protection from public.customer_protection where id=request_row.protection_id for update;
  if protection.id is null or protection.status<>'ACTIVE' then raise exception '客户保护状态已经变化，无法审核'; end if;
  if decision='APPROVED' then
    next_expire:=protection.expire_date+interval '45 days';
    update public.customer_protection set expire_date=next_expire,extension_count=request_row.renewal_number,last_extended_at=now() where id=protection.id;
  end if;
  update public.customer_protection_renewal_requests set status=decision,reviewed_by=actor.id,review_note=nullif(trim(p_review_note),''),reviewed_at=now() where id=request_row.id;
  update public.system_notifications set action_status='RESOLVED' where entity_type='protection_renewal' and entity_id=request_row.id;
  insert into public.system_notifications(recipient_id,type,category,title,content,href,entity_type,entity_id,dedupe_key,action_status)
  values(request_row.owner_id,'PROTECTION_RENEWAL_RESULT','CUSTOMER',case when decision='APPROVED' then '客户续期已通过' else '客户续期被驳回' end,case when decision='APPROVED' then format('第 %s 次续期已通过，保护期延长45天。',request_row.renewal_number) else '驳回原因：'||trim(p_review_note) end,'/customers/protection','protection_renewal',request_row.id,'renewal-result:'||request_row.id,'INFO');
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'CUSTOMER_PROTECTION_RENEW_REVIEW','protection_renewal',request_row.id,jsonb_build_object('decision',decision,'review_note',p_review_note,'owner_id',request_row.owner_id));
  return jsonb_build_object('status',decision,'expire_date',next_expire,'request_id',request_row.id);
end $$;

create or replace function public.refresh_expired_public_customers()
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
  with expired as (
    select c.id,c.owner_id,p.id protection_id
    from public.customers c
    join lateral (select * from public.customer_protection cp where cp.customer_id=c.id and cp.owner_id=c.owner_id and cp.status='ACTIVE' order by cp.start_date desc limit 1) p on true
    where c.deleted_at is null and c.acquisition_scope='PUBLIC_POOL' and c.pool_status='CLAIMED' and c.owner_id is not null
      and p.expire_date is not null and p.expire_date+interval '3 days'<now()
      and not exists(select 1 from public.customer_protection_renewal_requests r where r.protection_id=p.id and r.status='PENDING')
    for update of c
  ), released as (
    update public.customers c set owner_id=null,owner_user_id=null,status='UNCLAIMED',pool_status='AVAILABLE',assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now()
    from expired e where c.id=e.id returning c.id,e.owner_id,e.protection_id
  ), protections as (
    update public.customer_protection p set status='EXPIRED' from released r where p.id=r.protection_id returning p.id
  )
  select count(*) into changed from released;
  return changed;
end $$;

-- Duplicate submissions no longer steal an inactive/private customer. They
-- remain a conflict for explicit review or a public-pool claim.
create or replace function public.take_over_expired_customer(p_customer_id uuid,p_source text default 'DUPLICATE_SUBMISSION')
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.customers;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id=actor.id then return jsonb_build_object('transferred',false,'reason','OWN_CUSTOMER'); end if;
  if target.acquisition_scope='PUBLIC_POOL' and target.pool_status='AVAILABLE' and target.owner_id is null then
    return jsonb_build_object('transferred',false,'reason','PUBLIC_POOL_AVAILABLE');
  end if;
  return jsonb_build_object('transferred',false,'reason',case when target.status='DEAL' then 'PERMANENT_PROTECTION' else 'OWNERSHIP_REVIEW_REQUIRED' end);
end $$;

-- Legacy entry point is retained for compatibility, but cannot transfer a
-- currently owned customer. It delegates only eligible unowned records.
create or replace function public.assign_customer(p_customer_id uuid,p_user_id uuid)
returns public.customers language plpgsql security definer set search_path=public as $$
declare actor public.users; target public.customers; result jsonb;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role<>'ADMIN' then raise exception '仅系统管理员可以分配客户'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.owner_id is not null then raise exception '已被认领的在职客户不能强制重新分配'; end if;
  if not ((target.acquisition_scope='PUBLIC_POOL' and target.pool_status='AVAILABLE') or (target.acquisition_scope='PRIVATE' and target.pool_status='PENDING_ALLOCATION')) then raise exception '当前客户不属于可分配范围'; end if;
  result:=public.admin_assign_eligible_customers(array[p_customer_id],p_user_id,'单客户分配','系统管理员单条分配');
  select * into target from public.customers where id=p_customer_id;
  return target;
end $$;

-- Active owners release only their own non-transactional customer. Public
-- leads return to the pool; private leads wait for administrator allocation.
create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path=public as $$
declare target public.customers; actor public.users; previous_owner uuid; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '只能释放归属自己的客户'; end if;
  if target.status in ('QUOTE','DEAL') then raise exception '报价中或已成交客户不能直接释放'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception '请填写释放原因'; end if;
  previous_owner:=target.owner_id;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and owner_id=previous_owner and status='ACTIVE';
  update public.customers set owner_id=null,owner_user_id=null,status='RELEASED',pool_status=case when acquisition_scope='PUBLIC_POOL' then 'AVAILABLE' else 'PENDING_ALLOCATION' end,assigned_via=null,claimed_at=null,ownership_cycle_id=null,updated_at=now() where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason,source_owner_id)
  values(target.id,actor.id,'RELEASE','SELF_CLAIM',actor.name,last_claim,now(),trim(p_reason),previous_owner);
  insert into public.audit_logs(user_id,action,target_type,target_id,content) values(actor.id,'CUSTOMER_RELEASE','customer',target.id,jsonb_build_object('reason',trim(p_reason),'pool_status',target.pool_status));
  return target;
end $$;

revoke execute on function public.claim_public_customer(uuid,text,text,text,text,text,text,bigint) from public,anon;
revoke execute on function public.admin_assign_eligible_customers(uuid[],uuid,text,text) from public,anon;
revoke execute on function public.handover_inactive_user_customers(uuid,uuid,text,text,text) from public,anon;
revoke execute on function public.submit_customer_protection_renewal(uuid,text,text,text,text,text,text,bigint) from public,anon;
revoke execute on function public.review_customer_protection_renewal(uuid,text,text) from public,anon;
revoke execute on function public.refresh_expired_public_customers() from public,anon;
grant execute on function public.claim_public_customer(uuid,text,text,text,text,text,text,bigint) to authenticated;
grant execute on function public.admin_assign_eligible_customers(uuid[],uuid,text,text) to authenticated;
grant execute on function public.handover_inactive_user_customers(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.submit_customer_protection_renewal(uuid,text,text,text,text,text,text,bigint) to authenticated;
grant execute on function public.review_customer_protection_renewal(uuid,text,text) to authenticated;
grant execute on function public.refresh_expired_public_customers() to authenticated;

commit;
