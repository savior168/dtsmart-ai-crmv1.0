create table public.users (
  id uuid primary key,
  role text not null constraint users_role_v5_check
    check (role in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE')),
  status text not null default 'ACTIVE',
  locked_until timestamptz,
  force_logout_at timestamptz
);

create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor_id',true),'')::uuid
$$;
create function public.current_session_is_current(timestamptz)
returns boolean language sql stable as $$ select true $$;

do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$;
grant usage on schema auth, public to authenticated;
create table public.pi_exchange_rate_rules (
  currency text primary key, adjustment_mode text not null default 'OFFSET',
  adjustment_value numeric not null default 0, manual_reference_cny numeric
);
create table public.pi_payment_accounts (
  id uuid primary key, label text not null, active boolean not null default true
);
alter table public.pi_exchange_rate_rules enable row level security;
alter table public.pi_payment_accounts enable row level security;
grant select, insert, update on public.pi_exchange_rate_rules, public.pi_payment_accounts to authenticated;
insert into public.pi_exchange_rate_rules(currency) values ('USD');
insert into public.pi_payment_accounts(id,label) values
  ('00000000-0000-0000-0000-000000000051','Existing account');

create table public.role_permission_settings (
  role_code text not null constraint role_permission_settings_role_code_v5_check
    check (role_code in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE')),
  permission_code text not null,
  enabled boolean not null,
  primary key (role_code, permission_code)
);

create table public.user_permission_overrides (
  user_id uuid not null,
  permission_code text not null,
  effect text not null,
  primary key(user_id,permission_code)
);

insert into public.users(id,role) values
  ('00000000-0000-0000-0000-000000000001','ORDER_CLERK'),
  ('00000000-0000-0000-0000-000000000002','SALES');

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('ORDER_CLERK','orders.cancel',true),
  ('ORDER_CLERK','orders.view',true),
  ('ORDER_CLERK','stock.preview',true),
  ('ORDER_CLERK','stock.view',true),
  ('SALES','orders.cancel',true),
  ('SALES','ai.tasks.view',true),
  ('SALES','customers.ai_evidence_view',true),
  ('SUPERVISOR','ai.tasks.view',true),
  ('SUPERVISOR','customers.ai_evidence_view',true);

select set_config('test.actor_id','00000000-0000-0000-0000-000000000001',false);
