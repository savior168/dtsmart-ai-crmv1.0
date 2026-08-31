-- Simplified enterprise access control: three fixed roles, reviewable accounts,
-- in-app notifications and database-enforced business data scope.
create extension if not exists pgcrypto;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.users'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop execute format('alter table public.users drop constraint %I', constraint_name); end loop;
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.users'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop execute format('alter table public.users drop constraint %I', constraint_name); end loop;
end $$;

update public.users set role = 'SUPERVISOR' where role = 'MANAGER';
alter table public.users alter column role set default 'SALES';
alter table public.users alter column status set default 'PENDING';
alter table public.users add constraint users_role_v3_check check (role in ('ADMIN','SUPERVISOR','SALES'));
alter table public.users add constraint users_status_v3_check check (status in ('PENDING','ACTIVE','REJECTED','DISABLED','LOCKED'));
alter table public.users add column if not exists reviewed_by uuid references auth.users(id);
alter table public.users add column if not exists reviewed_at timestamptz;
alter table public.users add column if not exists review_reason text;
alter table public.users add column if not exists last_login_at timestamptz;
alter table public.users add column if not exists failed_login_attempts integer not null default 0;
alter table public.users add column if not exists locked_until timestamptz;
alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.users add column if not exists temporary_password_expires_at timestamptz;
alter table public.users add column if not exists password_reset_by uuid references auth.users(id);
alter table public.users add column if not exists password_reset_at timestamptz;
alter table public.users add column if not exists force_logout_at timestamptz;

do $$
begin
  if not exists (select 1 from public.users where lower(email) = 'zzccxry@gmail.com') then
    raise exception '无法初始化系统管理员：账号 zzccxry@gmail.com 不存在';
  end if;
  update public.users set role = 'SALES' where lower(email) <> 'zzccxry@gmail.com';
  update public.users set role = 'ADMIN', status = 'ACTIVE', reviewed_at = coalesce(reviewed_at, now()), review_reason = null
  where lower(email) = 'zzccxry@gmail.com';
end $$;

-- Every new registration starts as a sales account. The users.status default
-- remains PENDING until a system administrator approves it.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''), 'SALES')
  on conflict (id) do nothing;
  return new;
end;
$$;

create table if not exists public.system_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  content text,
  href text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists system_notifications_recipient_idx on public.system_notifications(recipient_id, read_at, created_at desc);

create table if not exists public.role_permission_settings (
  role_code text not null check (role_code in ('ADMIN','SUPERVISOR','SALES')),
  permission_code text not null,
  enabled boolean not null default true,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key(role_code, permission_code)
);

create table if not exists public.system_security_settings (
  id boolean primary key default true check (id),
  max_failed_login_attempts integer not null default 5 check (max_failed_login_attempts between 3 and 10),
  lock_minutes integer not null default 15 check (lock_minutes between 5 and 1440),
  temporary_password_hours integer not null default 24 check (temporary_password_hours between 1 and 168),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.system_security_settings(id) values(true) on conflict(id) do nothing;

insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, true from (values
  ('ADMIN','dashboard.view'),('ADMIN','customers.view'),('ADMIN','customers.manage'),('ADMIN','imports.manage'),('ADMIN','ai.manage'),('ADMIN','followups.manage'),('ADMIN','reports.view'),('ADMIN','usage.view_all'),
  ('SUPERVISOR','dashboard.view'),('SUPERVISOR','customers.view'),('SUPERVISOR','customers.manage'),('SUPERVISOR','imports.manage'),('SUPERVISOR','ai.manage'),('SUPERVISOR','followups.manage'),('SUPERVISOR','reports.view'),('SUPERVISOR','usage.view_all'),
  ('SALES','dashboard.view'),('SALES','customers.view'),('SALES','customers.manage'),('SALES','imports.manage'),('SALES','ai.manage'),('SALES','followups.manage'),('SALES','reports.view')
) as seed(role_code, permission_code)
on conflict(role_code, permission_code) do nothing;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() and status = 'ACTIVE' $$;

create or replace function public.current_user_is_elevated()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() in ('ADMIN','SUPERVISOR'), false) $$;

create or replace function public.current_user_is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.current_user_role() = 'ADMIN', false) $$;

create or replace function public.can_access_customer(target public.customers)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_user_role()
    when 'ADMIN' then target.deleted_at is null
    when 'SUPERVISOR' then target.deleted_at is null
    when 'SALES' then target.deleted_at is null and coalesce(target.owner_user_id,target.owner_id,target.created_by) = auth.uid()
    else false
  end
$$;

-- Business ownership operations use the same three-role model. Departments are
-- intentionally not part of access decisions in this small sales deployment.
create or replace function public.claim_customer(p_customer_id uuid)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is not null or target.status not in ('UNCLAIMED','RELEASED') then raise exception '客户已被认领'; end if;
  if exists(select 1 from public.customer_protection p where p.customer_id=target.id and p.status='ACTIVE' and (p.expire_date is null or p.expire_date>now()) and p.owner_id<>actor.id)
    and actor.role not in ('ADMIN','SUPERVISOR') then raise exception '客户仍在保护期'; end if;
  update public.customers set owner_id=actor.id,department_id=null,status='CLAIMED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at)
  values(target.id,actor.id,'CLAIM','SELF_CLAIM',actor.name,now());
  return target;
end $$;

create or replace function public.release_customer(p_customer_id uuid,p_reason text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users; original_owner public.users; last_claim timestamptz;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is null then raise exception '客户当前没有负责人'; end if;
  if target.owner_id<>actor.id and actor.role not in ('ADMIN','SUPERVISOR') then raise exception '只能释放自己的客户'; end if;
  if nullif(trim(p_reason),'') is null then raise exception '请填写释放原因'; end if;
  select * into original_owner from public.users where id=target.owner_id;
  select created_at into last_claim from public.customer_claims where customer_id=target.id and action in ('CLAIM','TRANSFER') order by created_at desc limit 1;
  update public.customer_protection set status='RELEASED' where customer_id=target.id and status='ACTIVE';
  update public.customers set owner_id=null,status='RELEASED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at,released_at,release_reason)
  values(target.id,original_owner.id,'RELEASE','SELF_CLAIM',original_owner.name,last_claim,now(),trim(p_reason));
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
  operation:=case when target.owner_id is null then 'CLAIM' else 'TRANSFER' end;
  update public.customers set owner_id=assignee.id,department_id=null,status='CLAIMED' where id=target.id returning * into target;
  insert into public.customer_claims(customer_id,user_id,action,claim_type,owner_name,claimed_at)
  values(target.id,assignee.id,operation,'ADMIN_ASSIGN',assignee.name,now());
  return target;
end $$;

create or replace function public.set_customer_stage(p_customer_id uuid,p_status text)
returns public.customers language plpgsql security definer set search_path = public as $$
declare target public.customers; actor public.users; protection_type text; protection_expire timestamptz;
begin
  if p_status not in ('CLAIMED','FOLLOWING','QUOTE','DEAL') then raise exception '无效客户阶段'; end if;
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  select * into target from public.customers where id=p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id<>actor.id and actor.role not in ('ADMIN','SUPERVISOR') then raise exception '无权修改客户阶段'; end if;
  if target.owner_id is null then raise exception '请先认领或分配客户'; end if;
  update public.customer_protection set status='SUPERSEDED' where customer_id=target.id and status='ACTIVE';
  if p_status in ('FOLLOWING','QUOTE','DEAL') then
    protection_type:=case p_status when 'FOLLOWING' then 'INTENT' when 'QUOTE' then 'QUOTE' else 'DEAL' end;
    protection_expire:=case p_status when 'FOLLOWING' then now()+interval '90 days' when 'QUOTE' then now()+interval '180 days' else null end;
    insert into public.customer_protection(customer_id,owner_id,type,start_date,expire_date,status)
    values(target.id,target.owner_id,protection_type,now(),protection_expire,'ACTIVE');
  end if;
  update public.customers set status=p_status where id=target.id returning * into target;
  return target;
end $$;

alter table public.system_notifications enable row level security;
alter table public.role_permission_settings enable row level security;
alter table public.system_security_settings enable row level security;
drop policy if exists system_notifications_self on public.system_notifications;
create policy system_notifications_self on public.system_notifications for select to authenticated using(recipient_id = auth.uid());
drop policy if exists system_notifications_self_update on public.system_notifications;
create policy system_notifications_self_update on public.system_notifications for update to authenticated using(recipient_id = auth.uid()) with check(recipient_id = auth.uid());
drop policy if exists role_permissions_admin on public.role_permission_settings;
create policy role_permissions_admin on public.role_permission_settings for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());
drop policy if exists security_settings_admin on public.system_security_settings;
create policy security_settings_admin on public.system_security_settings for all to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());

drop policy if exists users_select on public.users;
drop policy if exists users_admin_write on public.users;
drop policy if exists users_admin_insert on public.users;
drop policy if exists users_admin_update on public.users;
create policy users_select_v3 on public.users for select to authenticated using(id = auth.uid() or public.current_user_is_elevated());
create policy users_admin_update_v3 on public.users for update to authenticated using(public.current_user_is_admin()) with check(public.current_user_is_admin());

drop policy if exists customers_private_select on public.customers;
drop policy if exists customers_private_insert on public.customers;
drop policy if exists customers_private_update on public.customers;
drop policy if exists customers_private_delete on public.customers;
create policy customers_scope_select_v3 on public.customers for select to authenticated using(
  deleted_at is null and (public.current_user_is_elevated() or coalesce(owner_user_id, owner_id, created_by) = auth.uid())
);
create policy customers_scope_insert_v3 on public.customers for insert to authenticated with check(
  public.current_user_role() is not null and created_by = auth.uid() and (public.current_user_is_elevated() or coalesce(owner_user_id, owner_id, created_by) = auth.uid())
);
create policy customers_scope_update_v3 on public.customers for update to authenticated using(
  public.current_user_is_elevated() or coalesce(owner_user_id, owner_id, created_by) = auth.uid()
) with check(public.current_user_is_elevated() or coalesce(owner_user_id, owner_id, created_by) = auth.uid());

drop policy if exists claims_reports_select on public.customer_claims;
create policy claims_scope_select_v3 on public.customer_claims for select to authenticated using(
  public.current_user_is_elevated() or user_id = auth.uid() or
  exists(select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c))
);
drop policy if exists protection_select on public.customer_protection;
drop policy if exists protection_write on public.customer_protection;
create policy protection_scope_select_v3 on public.customer_protection for select to authenticated using(
  public.current_user_is_elevated() or owner_id = auth.uid()
);
create policy protection_scope_write_v3 on public.customer_protection for all to authenticated using(
  public.current_user_is_elevated() or owner_id = auth.uid()
) with check(public.current_user_is_elevated() or owner_id = auth.uid());

drop policy if exists import_tasks_select on public.import_tasks;
drop policy if exists import_tasks_update on public.import_tasks;
create policy import_tasks_scope_select_v3 on public.import_tasks for select to authenticated using(public.current_user_is_elevated() or created_by = auth.uid());
create policy import_tasks_scope_update_v3 on public.import_tasks for update to authenticated using(public.current_user_is_elevated() or created_by = auth.uid()) with check(public.current_user_is_elevated() or created_by = auth.uid());

drop policy if exists followups_select on public.followups;
drop policy if exists followups_reports_select on public.followups;
drop policy if exists followups_insert on public.followups;
drop policy if exists followups_update on public.followups;
create policy followups_scope_select_v3 on public.followups for select to authenticated using(public.current_user_is_elevated() or user_id = auth.uid());
create policy followups_scope_insert_v3 on public.followups for insert to authenticated with check(user_id = auth.uid() and exists(select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c)));
create policy followups_scope_update_v3 on public.followups for update to authenticated using(public.current_user_is_elevated() or user_id = auth.uid()) with check(public.current_user_is_elevated() or user_id = auth.uid());

drop policy if exists ai_tasks_self on public.ai_screening_tasks;
create policy ai_tasks_scope_v3 on public.ai_screening_tasks for all to authenticated using(public.current_user_is_elevated() or user_id = auth.uid()) with check(public.current_user_is_elevated() or user_id = auth.uid());

drop policy if exists ai_task_items_self on public.ai_screening_task_items;
create policy ai_task_items_scope_v3 on public.ai_screening_task_items for select to authenticated using(
  exists(select 1 from public.ai_screening_tasks t where t.id = task_id and (public.current_user_is_elevated() or t.user_id = auth.uid()))
);
drop policy if exists ai_results_self on public.ai_screening_results;
create policy ai_results_scope_v3 on public.ai_screening_results for select to authenticated using(
  exists(select 1 from public.ai_screening_tasks t where t.id = task_id and (public.current_user_is_elevated() or t.user_id = auth.uid()))
);
drop policy if exists ai_evidence_self on public.ai_screening_evidence;
create policy ai_evidence_scope_v3 on public.ai_screening_evidence for select to authenticated using(
  exists(select 1 from public.ai_screening_tasks t where t.id = task_id and (public.current_user_is_elevated() or t.user_id = auth.uid()))
);

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_scope_v3 on public.audit_logs for select to authenticated using(public.current_user_is_admin() or user_id = auth.uid());

grant select, update on public.system_notifications to authenticated;
grant select, insert, update, delete on public.role_permission_settings to authenticated;
grant select, update on public.system_security_settings to authenticated;

create or replace function public.ai_screening_usage_totals(p_user_id uuid)
returns table (processed bigint,input_tokens numeric,cached_input_tokens numeric,output_tokens numeric,total_tokens numeric,cost_usd numeric)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.ai_screening_completion_ledger c where p_user_id is null or c.user_id = p_user_id),
    (select coalesce(sum(u.input_tokens),0) from public.ai_screening_usage_ledger u where p_user_id is null or u.user_id = p_user_id),
    (select coalesce(sum(u.cached_input_tokens),0) from public.ai_screening_usage_ledger u where p_user_id is null or u.user_id = p_user_id),
    (select coalesce(sum(u.output_tokens),0) from public.ai_screening_usage_ledger u where p_user_id is null or u.user_id = p_user_id),
    (select coalesce(sum(u.total_tokens),0) from public.ai_screening_usage_ledger u where p_user_id is null or u.user_id = p_user_id),
    (select coalesce(sum(u.cost_usd),0) from public.ai_screening_usage_ledger u where p_user_id is null or u.user_id = p_user_id)
$$;
revoke all on function public.ai_screening_usage_totals(uuid) from public;
grant execute on function public.ai_screening_usage_totals(uuid) to service_role;

create or replace function public.sales_performance_report(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid,name text,email text,new_customers bigint,claimed bigint,released bigint,followups bigint,quotes bigint,deals bigint,ai_valid bigint,customer_count bigint,conversion_rate numeric)
language sql stable security definer set search_path = public as $$
  with actor as (select id,role from public.users where id=auth.uid() and status='ACTIVE'),
  sales as (
    select u.id,coalesce(nullif(u.name,''),u.email) as name,u.email from public.users u cross join actor a
    where u.status='ACTIVE' and (((a.role in ('ADMIN','SUPERVISOR')) and u.role in ('SALES','SUPERVISOR')) or u.id=a.id)
  ), customer_stats as (
    select s.id,count(c.id) filter(where c.created_by=s.id and c.created_at between p_from and p_to) as new_customers,count(c.id) filter(where c.owner_id=s.id and c.ai_score>=60 and c.deleted_at is null) as ai_valid
    from sales s left join public.customers c on c.created_by=s.id or c.owner_id=s.id group by s.id
  ), claim_stats as (
    select s.id,count(cc.id) filter(where cc.action in ('CLAIM','TRANSFER')) as claimed,count(cc.id) filter(where cc.action='RELEASE') as released,count(distinct cc.customer_id) filter(where cc.action in ('CLAIM','TRANSFER')) as customer_count
    from sales s left join public.customer_claims cc on cc.user_id=s.id and cc.created_at between p_from and p_to group by s.id
  ), followup_stats as (
    select s.id,count(f.id) as followups from sales s left join public.followups f on f.user_id=s.id and f.created_at between p_from and p_to group by s.id
  ), stage_stats as (
    select s.id,count(a.id) filter(where a.content->>'status'='QUOTE') as quotes,count(a.id) filter(where a.content->>'status'='DEAL') as deals
    from sales s left join public.audit_logs a on a.user_id=s.id and a.action='CUSTOMER_STAGE' and a.created_at between p_from and p_to group by s.id
  )
  select s.id,s.name,s.email,cs.new_customers,cl.claimed,cl.released,fs.followups,st.quotes,st.deals,cs.ai_valid,cl.customer_count,coalesce(round(st.deals::numeric*100/nullif(cl.customer_count,0),1),0)
  from sales s join customer_stats cs on cs.id=s.id join claim_stats cl on cl.id=s.id join followup_stats fs on fs.id=s.id join stage_stats st on st.id=s.id
  order by st.deals desc,coalesce(round(st.deals::numeric*100/nullif(cl.customer_count,0),1),0) desc,fs.followups desc
$$;
revoke execute on function public.sales_performance_report(timestamptz,timestamptz) from public,anon;
grant execute on function public.sales_performance_report(timestamptz,timestamptz) to authenticated;
