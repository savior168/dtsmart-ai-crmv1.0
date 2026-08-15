create extension if not exists "pgcrypto";

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  manager_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text,
  email text not null unique,
  role text not null default 'SALES' check (role in ('ADMIN', 'MANAGER', 'SALES')),
  department_id uuid references public.departments(id) on delete set null,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departments_manager_id_fkey'
      and conrelid = 'public.departments'::regclass
  ) then
    alter table public.departments
      add constraint departments_manager_id_fkey
      foreign key (manager_id) references public.users(id) on delete set null;
  end if;
end;
$$;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  country text,
  phone text,
  whatsapp text,
  email text,
  website text,
  google_url text,
  address text,
  industry text,
  category text,
  source text,
  tags text[] not null default '{}',
  rating numeric(3, 2) check (rating is null or (rating >= 0 and rating <= 5)),
  ai_score integer check (ai_score is null or (ai_score >= 0 and ai_score <= 100)),
  ai_level text,
  ai_reason text,
  status text not null default 'UNCLAIMED' check (status in ('UNCLAIMED', 'CLAIMED', 'FOLLOWING', 'QUOTE', 'DEAL', 'RELEASED')),
  owner_id uuid references public.users(id) on delete set null,
  department_id uuid references public.departments(id) on delete set null,
  created_by uuid references public.users(id) on delete set null,
  last_contact_time timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.customer_claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null check (action in ('CLAIM', 'RELEASE', 'TRANSFER')),
  claim_type text not null check (claim_type in ('SELF_CLAIM', 'ADMIN_ASSIGN')),
  created_at timestamptz not null default now()
);

create table if not exists public.customer_protection (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('INTENT', 'QUOTE', 'DEAL')),
  start_date timestamptz not null default now(),
  expire_date timestamptz,
  status text not null default 'ACTIVE',
  check (expire_date is null or expire_date >= start_date)
);

create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('EMAIL', 'WHATSAPP', 'PHONE', 'LINKEDIN', 'OTHER')),
  content text not null,
  attachment text,
  next_follow_date timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.import_tasks (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  total_count integer not null default 0 check (total_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  content jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customers_owner_id_idx on public.customers(owner_id);
create index if not exists customers_department_id_idx on public.customers(department_id);
create index if not exists customers_status_idx on public.customers(status) where deleted_at is null;

-- AI 筛选与官网联系方式扩展字段（可重复执行）
alter table if exists public.customers add column if not exists website_email text;
alter table if exists public.customers add column if not exists website_phone text;
alter table if exists public.customers add column if not exists ai_screening_done boolean not null default false;
alter table if exists public.customers add column if not exists is_target_customer boolean;
alter table if exists public.customers add column if not exists business_relevance text;
alter table if exists public.customers add column if not exists customer_value text;
alter table if exists public.customers add column if not exists followup_suggestion text;
alter table if exists public.customers add column if not exists notes text;
create index if not exists customer_claims_customer_id_idx on public.customer_claims(customer_id);
create index if not exists customer_protection_customer_id_idx on public.customer_protection(customer_id);
create index if not exists followups_customer_id_idx on public.followups(customer_id);
create index if not exists audit_logs_target_idx on public.audit_logs(target_type, target_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.email, ''),
    case when not exists (select 1 from public.users) then 'ADMIN' else 'SALES' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public
as $$ select role from public.users where id = auth.uid() $$;

create or replace function public.current_department_id()
returns uuid language sql stable security definer set search_path = public
as $$ select department_id from public.users where id = auth.uid() $$;

create or replace function public.can_access_customer(target public.customers)
returns boolean language sql stable security definer set search_path = public
as $$
  select case public.current_user_role()
    when 'ADMIN' then true
    when 'MANAGER' then target.deleted_at is null and target.department_id = public.current_department_id()
    when 'SALES' then target.deleted_at is null and (target.owner_id = auth.uid() or target.status in ('UNCLAIMED', 'RELEASED'))
    else false
  end
$$;

alter table public.users enable row level security;
alter table public.departments enable row level security;
alter table public.customers enable row level security;
alter table public.customer_claims enable row level security;
alter table public.customer_protection enable row level security;
alter table public.followups enable row level security;
alter table public.import_tasks enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists users_select on public.users;
drop policy if exists users_admin_write on public.users;
drop policy if exists departments_select on public.departments;
drop policy if exists departments_admin_write on public.departments;
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete_admin on public.customers;
drop policy if exists claims_select on public.customer_claims;
drop policy if exists claims_insert on public.customer_claims;
drop policy if exists protection_select on public.customer_protection;
drop policy if exists protection_write on public.customer_protection;
drop policy if exists followups_select on public.followups;
drop policy if exists followups_insert on public.followups;
drop policy if exists followups_update on public.followups;
drop policy if exists import_tasks_select on public.import_tasks;
drop policy if exists import_tasks_insert on public.import_tasks;
drop policy if exists import_tasks_update on public.import_tasks;
drop policy if exists audit_logs_select on public.audit_logs;
drop policy if exists audit_logs_insert on public.audit_logs;

create policy users_select on public.users for select to authenticated using (
  public.current_user_role() = 'ADMIN' or id = auth.uid() or
  (public.current_user_role() = 'MANAGER' and department_id = public.current_department_id())
);
create policy users_admin_write on public.users for all to authenticated
using (public.current_user_role() = 'ADMIN') with check (public.current_user_role() = 'ADMIN');
create policy departments_select on public.departments for select to authenticated using (
  public.current_user_role() = 'ADMIN' or id = public.current_department_id()
);
create policy departments_admin_write on public.departments for all to authenticated
using (public.current_user_role() = 'ADMIN') with check (public.current_user_role() = 'ADMIN');

create policy customers_select on public.customers for select to authenticated using (public.can_access_customer(customers));
create policy customers_insert on public.customers for insert to authenticated with check (
  public.current_user_role() = 'ADMIN' or
  (public.current_user_role() = 'MANAGER' and department_id = public.current_department_id()) or
  (public.current_user_role() = 'SALES' and (owner_id = auth.uid() or owner_id is null))
);
create policy customers_update on public.customers for update to authenticated
using (public.can_access_customer(customers)) with check (
  public.current_user_role() = 'ADMIN' or
  (public.current_user_role() = 'MANAGER' and department_id = public.current_department_id()) or
  (public.current_user_role() = 'SALES' and (owner_id = auth.uid() or (owner_id is null and status in ('UNCLAIMED', 'RELEASED'))))
);
create policy customers_delete_admin on public.customers for delete to authenticated using (public.current_user_role() = 'ADMIN');

create policy claims_select on public.customer_claims for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c))
);
create policy claims_insert on public.customer_claims for insert to authenticated with check (
  public.current_user_role() = 'ADMIN' or user_id = auth.uid() or
  (public.current_user_role() = 'MANAGER' and exists (select 1 from public.users u where u.id = user_id and u.department_id = public.current_department_id()))
);

create policy protection_select on public.customer_protection for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c))
);
create policy protection_write on public.customer_protection for all to authenticated
using (exists (select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c)))
with check (owner_id = auth.uid() or public.current_user_role() in ('ADMIN', 'MANAGER'));

create policy followups_select on public.followups for select to authenticated using (
  exists (select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c))
);
create policy followups_insert on public.followups for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.customers c where c.id = customer_id and public.can_access_customer(c))
);
create policy followups_update on public.followups for update to authenticated
using (user_id = auth.uid() or public.current_user_role() = 'ADMIN')
with check (user_id = auth.uid() or public.current_user_role() = 'ADMIN');

create policy import_tasks_select on public.import_tasks for select to authenticated using (
  public.current_user_role() = 'ADMIN' or created_by = auth.uid() or
  (public.current_user_role() = 'MANAGER' and exists (select 1 from public.users u where u.id = created_by and u.department_id = public.current_department_id()))
);
create policy import_tasks_insert on public.import_tasks for insert to authenticated with check (created_by = auth.uid());
create policy import_tasks_update on public.import_tasks for update to authenticated
using (created_by = auth.uid() or public.current_user_role() = 'ADMIN')
with check (created_by = auth.uid() or public.current_user_role() = 'ADMIN');

create policy audit_logs_select on public.audit_logs for select to authenticated using (
  public.current_user_role() = 'ADMIN' or user_id = auth.uid() or
  (public.current_user_role() = 'MANAGER' and exists (select 1 from public.users u where u.id = user_id and u.department_id = public.current_department_id()))
);
create policy audit_logs_insert on public.audit_logs for insert to authenticated with check (user_id = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.users, public.departments, public.customers,
  public.customer_claims, public.customer_protection, public.followups, public.import_tasks to authenticated;
grant select, insert on public.audit_logs to authenticated;

-- CRM claim, protection and follow-up workflow upgrade
alter table public.customer_claims
  add column if not exists owner_name text,
  add column if not exists claimed_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists release_reason text;

create index if not exists customer_claims_user_id_idx on public.customer_claims(user_id);
create index if not exists customer_protection_active_idx
  on public.customer_protection(customer_id, status, expire_date);
create index if not exists followups_next_follow_idx on public.followups(user_id, next_follow_date);

create or replace function public.claim_customer(p_customer_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null then raise exception '当前用户无效'; end if;

  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  if target.owner_id is not null or target.status not in ('UNCLAIMED', 'RELEASED') then
    raise exception '客户已被认领';
  end if;
  if actor.role = 'MANAGER' and target.department_id is distinct from actor.department_id then
    raise exception '无权认领其他部门客户';
  end if;
  if exists (
    select 1 from public.customer_protection p
    where p.customer_id = target.id and p.status = 'ACTIVE'
      and (p.expire_date is null or p.expire_date > now()) and p.owner_id <> actor.id
  ) and actor.role <> 'ADMIN' then
    raise exception '客户仍在保护期';
  end if;

  update public.customers set owner_id = actor.id, department_id = actor.department_id, status = 'CLAIMED'
  where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at)
  values(target.id, actor.id, 'CLAIM', 'SELF_CLAIM', actor.name, now());
  return target;
end;
$$;

create or replace function public.release_customer(p_customer_id uuid, p_reason text)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  original_owner public.users;
  last_claim timestamptz;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id is null then raise exception '客户当前没有负责人'; end if;
  if target.owner_id <> actor.id and actor.role <> 'ADMIN' then raise exception '只能释放自己的客户'; end if;
  if nullif(trim(p_reason), '') is null then raise exception '请填写释放原因'; end if;

  select * into original_owner from public.users where id = target.owner_id;
  select created_at into last_claim from public.customer_claims
    where customer_id = target.id and action in ('CLAIM', 'TRANSFER')
    order by created_at desc limit 1;
  update public.customer_protection set status = 'RELEASED'
    where customer_id = target.id and status = 'ACTIVE';
  update public.customers set owner_id = null, status = 'RELEASED'
    where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at, released_at, release_reason)
  values(target.id, original_owner.id, 'RELEASE', 'SELF_CLAIM', original_owner.name, last_claim, now(), trim(p_reason));
  return target;
end;
$$;

create or replace function public.assign_customer(p_customer_id uuid, p_user_id uuid)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  assignee public.users;
  operation text;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.role <> 'ADMIN' then raise exception '仅管理员可分配客户'; end if;
  select * into assignee from public.users where id = p_user_id and status = 'ACTIVE';
  if assignee.id is null then raise exception '目标用户不存在'; end if;
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if target.id is null then raise exception '客户不存在'; end if;
  operation := case when target.owner_id is null then 'CLAIM' else 'TRANSFER' end;
  update public.customers set owner_id = assignee.id, department_id = assignee.department_id, status = 'CLAIMED'
    where id = target.id returning * into target;
  insert into public.customer_claims(customer_id, user_id, action, claim_type, owner_name, claimed_at)
  values(target.id, assignee.id, operation, 'ADMIN_ASSIGN', assignee.name, now());
  return target;
end;
$$;

create or replace function public.set_customer_stage(p_customer_id uuid, p_status text)
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.customers;
  actor public.users;
  protection_type text;
  protection_expire timestamptz;
begin
  if p_status not in ('CLAIMED', 'FOLLOWING', 'QUOTE', 'DEAL') then raise exception '无效客户阶段'; end if;
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  select * into target from public.customers where id = p_customer_id and deleted_at is null for update;
  if actor.id is null or target.id is null then raise exception '用户或客户不存在'; end if;
  if target.owner_id <> actor.id and actor.role <> 'ADMIN' then raise exception '无权修改客户阶段'; end if;
  if target.owner_id is null then raise exception '请先认领或分配客户'; end if;

  update public.customer_protection set status = 'SUPERSEDED'
    where customer_id = target.id and status = 'ACTIVE';
  if p_status in ('FOLLOWING', 'QUOTE', 'DEAL') then
    protection_type := case p_status when 'FOLLOWING' then 'INTENT' when 'QUOTE' then 'QUOTE' else 'DEAL' end;
    protection_expire := case p_status when 'FOLLOWING' then now() + interval '90 days' when 'QUOTE' then now() + interval '180 days' else null end;
    insert into public.customer_protection(customer_id, owner_id, type, start_date, expire_date, status)
    values(target.id, target.owner_id, protection_type, now(), protection_expire, 'ACTIVE');
  end if;
  update public.customers set status = p_status where id = target.id returning * into target;
  return target;
end;
$$;

revoke execute on function public.claim_customer(uuid) from public, anon;
revoke execute on function public.release_customer(uuid, text) from public, anon;
revoke execute on function public.assign_customer(uuid, uuid) from public, anon;
revoke execute on function public.set_customer_stage(uuid, text) from public, anon;
grant execute on function public.claim_customer(uuid) to authenticated;
grant execute on function public.release_customer(uuid, text) to authenticated;
grant execute on function public.assign_customer(uuid, uuid) to authenticated;
grant execute on function public.set_customer_stage(uuid, text) to authenticated;

-- Sales reports and historical activity visibility
-- Salespeople retain access to their own historical activity after a customer is transferred.
drop policy if exists claims_reports_select on public.customer_claims;
create policy claims_reports_select on public.customer_claims for select to authenticated using (
  user_id = auth.uid() or public.current_user_role() = 'ADMIN'
);

drop policy if exists followups_reports_select on public.followups;
create policy followups_reports_select on public.followups for select to authenticated using (
  user_id = auth.uid() or public.current_user_role() = 'ADMIN'
);

create index if not exists customers_created_by_created_at_idx on public.customers(created_by, created_at);
create index if not exists customer_claims_user_created_at_idx on public.customer_claims(user_id, created_at);
create index if not exists followups_user_created_at_idx on public.followups(user_id, created_at);
create index if not exists audit_logs_user_action_created_at_idx on public.audit_logs(user_id, action, created_at);

drop function if exists public.sales_performance_report(timestamptz, timestamptz);
create function public.sales_performance_report(p_from timestamptz, p_to timestamptz)
returns table (
  user_id uuid, name text, email text, new_customers bigint, claimed bigint,
  released bigint, followups bigint, quotes bigint, deals bigint,
  ai_valid bigint, customer_count bigint, conversion_rate numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with actor as (
    select id, role from public.users where id = auth.uid() and status = 'ACTIVE'
  ), sales as (
    select u.id, coalesce(nullif(u.name, ''), u.email) as name, u.email
    from public.users u cross join actor a
    where u.status = 'ACTIVE' and (
      (a.role = 'ADMIN' and u.role in ('SALES', 'MANAGER')) or u.id = a.id
    )
  ), customer_stats as (
    select s.id,
      count(c.id) filter (where c.created_by = s.id and c.created_at between p_from and p_to) as new_customers,
      count(c.id) filter (where c.owner_id = s.id and c.ai_score >= 60 and c.deleted_at is null) as ai_valid
    from sales s left join public.customers c on c.created_by = s.id or c.owner_id = s.id group by s.id
  ), claim_stats as (
    select s.id,
      count(cc.id) filter (where cc.action in ('CLAIM', 'TRANSFER')) as claimed,
      count(cc.id) filter (where cc.action = 'RELEASE') as released,
      count(distinct cc.customer_id) filter (where cc.action in ('CLAIM', 'TRANSFER')) as customer_count
    from sales s left join public.customer_claims cc on cc.user_id = s.id and cc.created_at between p_from and p_to group by s.id
  ), followup_stats as (
    select s.id, count(f.id) as followups from sales s
    left join public.followups f on f.user_id = s.id and f.created_at between p_from and p_to group by s.id
  ), stage_stats as (
    select s.id,
      count(a.id) filter (where a.content ->> 'status' = 'QUOTE') as quotes,
      count(a.id) filter (where a.content ->> 'status' = 'DEAL') as deals
    from sales s left join public.audit_logs a on a.user_id = s.id and a.action = 'CUSTOMER_STAGE'
      and a.created_at between p_from and p_to group by s.id
  )
  select s.id, s.name, s.email, cs.new_customers, cl.claimed, cl.released, fs.followups,
    st.quotes, st.deals, cs.ai_valid, cl.customer_count,
    coalesce(round(st.deals::numeric * 100 / nullif(cl.customer_count, 0), 1), 0) as conversion_rate
  from sales s join customer_stats cs on cs.id = s.id join claim_stats cl on cl.id = s.id
  join followup_stats fs on fs.id = s.id join stage_stats st on st.id = s.id
  order by st.deals desc,
    coalesce(round(st.deals::numeric * 100 / nullif(cl.customer_count, 0), 1), 0) desc,
    fs.followups desc;
$$;

revoke execute on function public.sales_performance_report(timestamptz, timestamptz) from public, anon;
grant execute on function public.sales_performance_report(timestamptz, timestamptz) to authenticated;
