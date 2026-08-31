-- Elevated roles may inspect all sales data, but may only mutate their own
-- business records. Protection expiry has a seven-day grace period and two
-- 45-day renewals per protection cycle. There is no public customer pool.

alter table public.customer_protection
  add column if not exists extension_count integer not null default 0,
  add column if not exists last_extended_at timestamptz;

alter table public.customer_protection
  drop constraint if exists customer_protection_extension_count_check;
alter table public.customer_protection
  add constraint customer_protection_extension_count_check
  check (extension_count between 0 and 2);

-- data_all is a read scope only. Database write policies mirror the API rule.
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_private_insert on public.customers;
drop policy if exists customers_scope_insert_v3 on public.customers;
drop policy if exists customers_own_insert_v4 on public.customers;
create policy customers_own_insert_v4 on public.customers
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and coalesce(owner_user_id, owner_id, created_by) = auth.uid()
    and (owner_user_id is null or owner_user_id = auth.uid())
    and (owner_id is null or owner_id = auth.uid())
  );

drop policy if exists customers_update on public.customers;
drop policy if exists customers_private_update on public.customers;
drop policy if exists customers_scope_update_v3 on public.customers;
drop policy if exists customers_own_update_v4 on public.customers;
create policy customers_own_update_v4 on public.customers
  for update to authenticated
  using (coalesce(owner_user_id, owner_id, created_by) = auth.uid())
  with check (coalesce(owner_user_id, owner_id, created_by) = auth.uid());

drop policy if exists customers_delete_admin on public.customers;
drop policy if exists customers_private_delete on public.customers;
drop policy if exists customers_scope_delete_v3 on public.customers;
drop policy if exists customers_own_delete_v4 on public.customers;
create policy customers_own_delete_v4 on public.customers
  for delete to authenticated
  using (coalesce(owner_user_id, owner_id, created_by) = auth.uid());

drop policy if exists protection_write on public.customer_protection;
drop policy if exists protection_scope_write_v3 on public.customer_protection;
drop policy if exists protection_own_write_v4 on public.customer_protection;
create policy protection_own_write_v4 on public.customer_protection
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists followups_update on public.followups;
drop policy if exists followups_scope_update_v3 on public.followups;
drop policy if exists followups_own_update_v4 on public.followups;
drop policy if exists followups_insert on public.followups;
drop policy if exists followups_scope_insert_v3 on public.followups;
drop policy if exists followups_own_insert_v4 on public.followups;
create policy followups_own_insert_v4 on public.followups
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.customers customer
      where customer.id = customer_id
        and coalesce(customer.owner_user_id, customer.owner_id, customer.created_by) = auth.uid()
    )
  );
create policy followups_own_update_v4 on public.followups
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists import_tasks_update on public.import_tasks;
drop policy if exists import_tasks_scope_update_v3 on public.import_tasks;
drop policy if exists import_tasks_own_update_v4 on public.import_tasks;
create policy import_tasks_own_update_v4 on public.import_tasks
  for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists ai_tasks_scope_v3 on public.ai_screening_tasks;
drop policy if exists ai_tasks_scope_select_v4 on public.ai_screening_tasks;
drop policy if exists ai_tasks_own_insert_v4 on public.ai_screening_tasks;
drop policy if exists ai_tasks_own_update_v4 on public.ai_screening_tasks;
drop policy if exists ai_tasks_own_delete_v4 on public.ai_screening_tasks;
create policy ai_tasks_scope_select_v4 on public.ai_screening_tasks
  for select to authenticated
  using (public.current_user_is_elevated() or user_id = auth.uid());
create policy ai_tasks_own_insert_v4 on public.ai_screening_tasks
  for insert to authenticated
  with check (user_id = auth.uid());
create policy ai_tasks_own_update_v4 on public.ai_screening_tasks
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ai_tasks_own_delete_v4 on public.ai_screening_tasks
  for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists customer_conflicts_select on public.customer_conflicts;
drop policy if exists customer_conflicts_insert on public.customer_conflicts;
drop policy if exists customer_conflicts_update on public.customer_conflicts;
drop policy if exists customer_conflicts_select_v4 on public.customer_conflicts;
drop policy if exists customer_conflicts_insert_v4 on public.customer_conflicts;
drop policy if exists customer_conflicts_update_v4 on public.customer_conflicts;
create policy customer_conflicts_select_v4 on public.customer_conflicts
  for select to authenticated
  using (reported_by = auth.uid() or public.current_user_is_elevated());
create policy customer_conflicts_insert_v4 on public.customer_conflicts
  for insert to authenticated
  with check (reported_by = auth.uid());
create policy customer_conflicts_update_v4 on public.customer_conflicts
  for update to authenticated
  using (reported_by = auth.uid()) with check (reported_by = auth.uid());

-- Renew only the current owner's expired protection, during the seven-day
-- grace period. A stage change creates a new cycle; repeatedly saving the same
-- stage must not reset this counter.
create or replace function public.renew_customer_protection(p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor public.users;
  target public.customers;
  protection public.customer_protection;
  effective_expire timestamptz;
  next_expire timestamptz;
  next_count integer;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '客户已不归属当前用户，不能续期'; end if;
  if target.status = 'DEAL' then raise exception '已成交客户为永久保护，无需续期'; end if;

  select * into protection from public.customer_protection
  where customer_id = target.id and owner_id = actor.id
  order by start_date desc limit 1 for update;

  if protection.id is not null and protection.status = 'RELEASED' then
    raise exception '客户已主动释放，不能续期';
  end if;
  effective_expire := coalesce(protection.expire_date, target.created_at + interval '90 days');
  if effective_expire is null then raise exception '当前客户为永久保护，无需续期'; end if;
  if now() < effective_expire then raise exception '保护期尚未到期，无需续期'; end if;
  if now() > effective_expire + interval '7 days' then raise exception '续期宽限期已结束'; end if;
  next_count := coalesce(protection.extension_count, 0) + 1;
  if next_count > 2 then raise exception '同一保护周期最多续期2次'; end if;
  next_expire := greatest(effective_expire, now()) + interval '45 days';

  if protection.id is null then
    insert into public.customer_protection(customer_id, owner_id, type, start_date, expire_date, status, extension_count, last_extended_at)
    values(target.id, actor.id, case when target.status = 'QUOTE' then 'QUOTE' else 'INTENT' end,
      target.created_at, next_expire, 'ACTIVE', next_count, now())
    returning * into protection;
  else
    update public.customer_protection
    set expire_date = next_expire, status = 'ACTIVE', extension_count = next_count, last_extended_at = now()
    where id = protection.id returning * into protection;
  end if;

  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values(actor.id, 'CUSTOMER_PROTECTION_RENEW', 'customer', target.id,
    jsonb_build_object('days',45,'extension_count',next_count,'expire_date',next_expire));
  return jsonb_build_object('customer_id',target.id,'expire_date',next_expire,'extension_count',next_count);
end $$;

-- A duplicate submission after protection and grace have both ended transfers
-- the single master customer directly to the new submitter. It never enters a
-- public pool and never requires a separate claim action.
create or replace function public.take_over_expired_customer(p_customer_id uuid, p_source text default 'DUPLICATE_SUBMISSION')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  actor public.users;
  previous_owner uuid;
  target public.customers;
  protection public.customer_protection;
  effective_expire timestamptz;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id = actor.id then return jsonb_build_object('transferred',false,'reason','OWN_CUSTOMER'); end if;
  previous_owner := target.owner_id;

  if previous_owner is not null then
    if target.status = 'DEAL' then return jsonb_build_object('transferred',false,'reason','PERMANENT_PROTECTION'); end if;
    select * into protection from public.customer_protection
    where customer_id = target.id and owner_id = previous_owner
    order by start_date desc limit 1 for update;
    if protection.id is not null and protection.status = 'RELEASED' then
      effective_expire := '-infinity'::timestamptz;
    elsif protection.id is not null and protection.expire_date is null then
      return jsonb_build_object('transferred',false,'reason','PERMANENT_PROTECTION');
    else
      effective_expire := coalesce(protection.expire_date, target.created_at + interval '90 days');
    end if;
    if now() <= effective_expire + interval '7 days' then
      return jsonb_build_object('transferred',false,'reason','PROTECTED_OR_GRACE','grace_ends_at',effective_expire + interval '7 days');
    end if;
  end if;

  update public.customer_protection set status = 'SUPERSEDED'
  where customer_id = target.id and status in ('ACTIVE','EXPIRED');
  update public.customers
  set owner_id = actor.id, owner_user_id = actor.id, status = 'CLAIMED', updated_at = now()
  where id = target.id;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,created_at)
  values(target.id,actor.id,case when previous_owner is null then 'CLAIM' else 'TRANSFER' end,'SELF_CLAIM',now());
  update public.customer_conflicts set status = 'RESOLVED'
  where customer_id = target.id and reported_by = actor.id and status = 'OPEN';
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values(actor.id, 'CUSTOMER_EXPIRED_TRANSFER', 'customer', target.id,
    jsonb_build_object('previous_owner_id',previous_owner,'new_owner_id',actor.id,'source',coalesce(p_source,'DUPLICATE_SUBMISSION')));
  return jsonb_build_object('transferred',true,'previous_owner_id',previous_owner,'new_owner_id',actor.id);
end $$;

revoke execute on function public.renew_customer_protection(uuid) from public, anon;
revoke execute on function public.take_over_expired_customer(uuid,text) from public, anon;
grant execute on function public.renew_customer_protection(uuid) to authenticated;
grant execute on function public.take_over_expired_customer(uuid,text) to authenticated;

-- Ownership-changing RPCs must never use the elevated read scope as write
-- authority. Elevated users can only release/change/transfer customers they
-- personally own; assigning an unowned legacy row is also permitted.
create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '只能释放归属自己的客户'; end if;
  if nullif(trim(p_reason),'') is null then raise exception '请填写释放原因'; end if;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and owner_id=actor.id and status='ACTIVE';
  update public.customers set owner_id=null,owner_user_id=null,status='RELEASED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason)
  values(target.id,actor.id,'RELEASE','SELF_CLAIM',actor.name,last_claim,now(),trim(p_reason));
  return target;
end $$;

create or replace function public.assign_customer(p_customer_id uuid,p_user_id uuid)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users; assignee public.users; operation text;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.role not in ('ADMIN','SUPERVISOR') then raise exception '仅主管或系统管理员可分配客户'; end if;
  select * into assignee from public.users where id=p_user_id and status='ACTIVE' and role in ('SALES','SUPERVISOR');
  if assignee.id is null then raise exception '目标销售员不存在或未启用'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is not null and target.owner_id <> actor.id then raise exception '其他销售员的客户仅供查看，不能重新分配'; end if;
  operation:=case when target.owner_id is null then 'CLAIM' else 'TRANSFER' end;
  update public.customers set owner_id=assignee.id,owner_user_id=assignee.id,department_id=null,status='CLAIMED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at)
  values(target.id,assignee.id,operation,'ADMIN_ASSIGN',assignee.name,now());
  return target;
end $$;

create or replace function public.set_customer_stage(p_customer_id uuid,p_status text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users; protection_type text; protection_expire timestamptz; latest public.customer_protection;
begin
  if p_status not in ('CLAIMED','FOLLOWING','QUOTE','DEAL') then raise exception '无效客户阶段'; end if;
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is distinct from actor.id then raise exception '只能修改归属自己的客户阶段'; end if;
  if target.status = p_status then
    update public.customers set status=p_status where id=target.id returning * into target;
    return target;
  end if;
  select * into latest from public.customer_protection where customer_id=target.id and owner_id=actor.id order by start_date desc limit 1 for update;
  update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and owner_id=actor.id and status='ACTIVE';
  if p_status in ('FOLLOWING','QUOTE','DEAL') then
    protection_type:=case p_status when 'FOLLOWING' then 'INTENT' when 'QUOTE' then 'QUOTE' else 'DEAL' end;
    protection_expire:=case p_status when 'FOLLOWING' then now()+interval '90 days' when 'QUOTE' then now()+interval '180 days' else null end;
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status,extension_count)
    values(target.id,actor.id,protection_type,now(),protection_expire,'ACTIVE',0);
  end if;
  update public.customers set status=p_status where id=target.id returning * into target;
  return target;
end $$;

revoke execute on function public.claim_customer(uuid) from authenticated;

-- No public-customer claim action exists in this CRM.
update public.role_permission_settings
set enabled = false
where permission_code = 'customers.claim';

insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('ADMIN','customers.renew',true),('SUPERVISOR','customers.renew',true),('SALES','customers.renew',true)
on conflict(role_code,permission_code) do update set enabled=excluded.enabled;
