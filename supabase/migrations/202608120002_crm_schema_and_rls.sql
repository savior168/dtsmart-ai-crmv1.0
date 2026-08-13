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
