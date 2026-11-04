-- Finance is a built-in, least-privilege role. It has no generic CRM data scope.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.users drop constraint if exists users_role_v5_check;
alter table public.users add constraint users_role_v6_check
  check (role in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE','FINANCE'));
alter table public.role_permission_settings drop constraint if exists role_permission_settings_role_code_v5_check;
alter table public.role_permission_settings add constraint role_permission_settings_role_code_v6_check
  check (role_code in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE','FINANCE'));

insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('FINANCE','suppliers.view',true),
  ('FINANCE','supplier.reconciliation.view',true),
  ('FINANCE','supplier.reconciliation.manage',true),
  ('FINANCE','notifications.view',true)
on conflict (role_code, permission_code) do update set enabled = excluded.enabled;

-- Historically ORDER_CLERK has orders.cancel enabled in stored role rows,
-- while application code denied cancellation. Preserve that effective default
-- before allowing administrators to opt in. stock.preview is already effective
-- for this role and must stay enabled.
insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('ORDER_CLERK','orders.cancel',false)
on conflict (role_code, permission_code) do update set enabled = false;

-- These two historical grants were masked by application-level core checks.
-- Persist their effective disabled state before making permissions editable,
-- otherwise removing the mask would silently grant access to SALES/SUPERVISOR.
insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('SALES','ai.tasks.view',false),
  ('SALES','customers.ai_evidence_view',false),
  ('SUPERVISOR','ai.tasks.view',false),
  ('SUPERVISOR','customers.ai_evidence_view',false)
on conflict (role_code, permission_code) do update set enabled = false;

-- Product maintenance was previously administrator-only through a hard mask.
-- Preserve every non-admin role's effective disabled default before making
-- the existing permission-guarded product APIs configurable.
insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, false
from (values ('SUPERVISOR'),('SALES'),('ORDER_CLERK'),('WAREHOUSE'),('FINANCE')) roles(role_code)
cross join (values ('products.categories.manage'),('products.manage')) permissions(permission_code)
on conflict (role_code, permission_code) do update set enabled = false;

-- Financial settings had no non-admin grants in the production baseline.
-- Materialize their previously hard-masked default before enabling explicit
-- role or user grants, including the page permission required by each action.
insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, false
from (values ('SUPERVISOR'),('SALES'),('ORDER_CLERK'),('WAREHOUSE'),('FINANCE')) roles(role_code)
cross join (values ('pi.rates.view'),('pi.rates.manage'),('pi.accounts.view'),('pi.accounts.manage')) permissions(permission_code)
on conflict (role_code, permission_code) do update set enabled = false;

-- Match the application's page + action permission hierarchy for direct RPC
-- callers too. Previously a role row for an action could bypass a closed page
-- by calling a database function without going through the Next.js API.
create or replace function public.current_user_has_business_permission(p_permission text)
returns boolean
language plpgsql stable security definer
set search_path = '' as $$
declare
  actor public.users;
  page_code text;
  action_effect text;
  page_effect text;
  action_enabled boolean;
  page_enabled boolean;
begin
  select * into actor from public.users u
    where u.id=auth.uid() and u.status='ACTIVE'
      and (u.locked_until is null or u.locked_until<=pg_catalog.now())
      and public.current_session_is_current(u.force_logout_at);
  if actor.id is null then return false; end if;
  if actor.role='ADMIN' then return true; end if;
  if p_permission is null or p_permission like 'quotes.%' then return false; end if;
  page_code:=case
    when p_permission like 'dashboard.%' then 'dashboard.view'
    when p_permission like 'customers.%' then 'customers.view'
    when p_permission like 'imports.%' then 'imports.view'
    when p_permission like 'ai.acquisition.%' then 'ai.acquisition.view'
    when p_permission like 'ai.%' then 'ai.tasks.view'
    when p_permission like 'followups.%' then 'followups.view'
    when p_permission like 'products.categories.%' then 'products.categories.view'
    when p_permission like 'products.%' then 'products.view'
    when p_permission like 'pricebooks.rules.%' then 'pricebooks.rules.view'
    when p_permission like 'pricebooks.%' then 'pricebooks.view'
    when p_permission like 'orders.%' then 'orders.view'
    when p_permission like 'stock.%' then 'stock.view'
    when p_permission like 'suppliers.%' then 'suppliers.view'
    when p_permission like 'supplier.reconciliation.%' then 'supplier.reconciliation.view'
    when p_permission like 'pi.rates.%' then 'pi.rates.view'
    when p_permission like 'pi.accounts.%' then 'pi.accounts.view'
    when p_permission like 'reports.%' then 'reports.view'
    when p_permission like 'costs.%' then 'costs.view'
    when p_permission like 'notifications.%' then 'notifications.view'
    when p_permission like 'system.users.%' then 'system.users.view'
    when p_permission like 'system.roles.%' then 'system.roles.view'
    when p_permission like 'system.audit.%' then 'system.audit.view'
    when p_permission like 'system.notifications.%' then 'system.notifications.view'
    when p_permission like 'system.security.%' then 'system.security.view'
    else p_permission end;
  if p_permission=any(array[
    'customers.assign','customers.handover',
    'ai.acquisition.view','ai.acquisition.settings.manage','ai.tasks.view',
    'pricebooks.rules.view',
    'pricebooks.manage','pricebooks.import','pricebooks.publish','pricebooks.rules.manage',
    'system.users.view','system.users.manage',
    'system.roles.view','system.roles.manage','system.notifications.view',
    'system.security.manage'
  ]) or page_code=any(array[
    'ai.acquisition.view','ai.tasks.view','pricebooks.rules.view',
    'system.users.view',
    'system.roles.view','system.notifications.view'
  ]) then return false; end if;
  select o.effect into action_effect from public.user_permission_overrides o
    where o.user_id=actor.id and o.permission_code=p_permission;
  select r.enabled into action_enabled from public.role_permission_settings r
    where r.role_code=actor.role and r.permission_code=p_permission;
  if not (case action_effect when 'DENY' then false when 'ALLOW' then true
    else coalesce(action_enabled,false) end) then return false; end if;
  if page_code=p_permission then return true; end if;
  select o.effect into page_effect from public.user_permission_overrides o
    where o.user_id=actor.id and o.permission_code=page_code;
  select r.enabled into page_enabled from public.role_permission_settings r
    where r.role_code=actor.role and r.permission_code=page_code;
  return case page_effect when 'DENY' then false when 'ALLOW' then true
    else coalesce(page_enabled,false) end;
end;
$$;

-- The financial settings APIs use the caller's JWT. A role grant must pass
-- the same page/action check at the database boundary; no service-role write.
create policy pi_exchange_rate_rules_granted_read on public.pi_exchange_rate_rules
  for select to authenticated
  using (public.current_user_has_business_permission('pi.rates.view'));
create policy pi_exchange_rate_rules_granted_insert on public.pi_exchange_rate_rules
  for insert to authenticated
  with check (public.current_user_has_business_permission('pi.rates.manage'));
create policy pi_exchange_rate_rules_granted_update on public.pi_exchange_rate_rules
  for update to authenticated
  using (public.current_user_has_business_permission('pi.rates.manage'))
  with check (public.current_user_has_business_permission('pi.rates.manage'));
create policy pi_payment_accounts_granted_read on public.pi_payment_accounts
  for select to authenticated
  using (public.current_user_has_business_permission('pi.accounts.view'));
create policy pi_payment_accounts_granted_insert on public.pi_payment_accounts
  for insert to authenticated
  with check (public.current_user_has_business_permission('pi.accounts.manage'));
create policy pi_payment_accounts_granted_update on public.pi_payment_accounts
  for update to authenticated
  using (public.current_user_has_business_permission('pi.accounts.manage'))
  with check (public.current_user_has_business_permission('pi.accounts.manage'));

commit;
