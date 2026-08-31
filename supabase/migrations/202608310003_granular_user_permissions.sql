-- Page, action and data-scope permissions with sparse per-user overrides.
create table if not exists public.user_permission_overrides (
  user_id uuid not null references public.users(id) on delete cascade,
  permission_code text not null,
  effect text not null check (effect in ('ALLOW','DENY')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_code)
);

create index if not exists user_permission_overrides_user_idx
  on public.user_permission_overrides(user_id, updated_at desc);

alter table public.user_permission_overrides enable row level security;
drop policy if exists user_permission_overrides_admin on public.user_permission_overrides;
create policy user_permission_overrides_admin on public.user_permission_overrides
  for all to authenticated
  using (public.current_user_is_admin())
  with check (public.current_user_is_admin());
grant select, insert, update, delete on public.user_permission_overrides to authenticated;

-- Replace the old coarse grants with complete defaults. Old codes remain in the
-- table for rollback compatibility but application authorization uses this set.
insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, true from (values
  ('SUPERVISOR','dashboard.view'),('SUPERVISOR','dashboard.data_all'),
  ('SUPERVISOR','customers.view'),('SUPERVISOR','customers.data_all'),('SUPERVISOR','customers.create'),('SUPERVISOR','customers.edit'),('SUPERVISOR','customers.delete'),('SUPERVISOR','customers.export'),('SUPERVISOR','customers.batch_edit'),('SUPERVISOR','customers.claim'),('SUPERVISOR','customers.release'),('SUPERVISOR','customers.assign'),('SUPERVISOR','customers.ai_evidence_view'),
  ('SUPERVISOR','imports.view'),('SUPERVISOR','imports.create'),('SUPERVISOR','imports.data_all'),
  ('SUPERVISOR','ai.tasks.view'),('SUPERVISOR','ai.data_all'),('SUPERVISOR','ai.tasks.create'),('SUPERVISOR','ai.tasks.control'),('SUPERVISOR','ai.tasks.delete'),('SUPERVISOR','ai.results.view'),('SUPERVISOR','ai.results.review'),('SUPERVISOR','ai.usage.view'),('SUPERVISOR','ai.usage.view_all'),
  ('SUPERVISOR','followups.view'),('SUPERVISOR','followups.data_all'),('SUPERVISOR','followups.create'),
  ('SUPERVISOR','reports.view'),('SUPERVISOR','reports.data_all'),('SUPERVISOR','reports.export'),

  ('SALES','dashboard.view'),
  ('SALES','customers.view'),('SALES','customers.create'),('SALES','customers.edit'),('SALES','customers.export'),('SALES','customers.batch_edit'),('SALES','customers.claim'),('SALES','customers.release'),('SALES','customers.ai_evidence_view'),
  ('SALES','imports.view'),('SALES','imports.create'),
  ('SALES','ai.tasks.view'),('SALES','ai.tasks.create'),('SALES','ai.tasks.control'),('SALES','ai.tasks.delete'),('SALES','ai.results.view'),('SALES','ai.results.review'),('SALES','ai.usage.view'),
  ('SALES','followups.view'),('SALES','followups.create'),
  ('SALES','reports.view'),('SALES','reports.export')
) as seed(role_code, permission_code)
on conflict(role_code, permission_code) do update set enabled=excluded.enabled;

-- Core permissions are documented in the same matrix but remain ADMIN-only.
insert into public.role_permission_settings(role_code, permission_code, enabled)
select 'ADMIN', permission_code, true from (values
  ('system.users.view'),('system.users.manage'),('system.roles.view'),('system.roles.manage'),
  ('system.audit.view'),('system.security.view'),('system.security.manage')
) as seed(permission_code)
on conflict(role_code, permission_code) do update set enabled=true;
