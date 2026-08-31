-- Sales and supervisors can inspect their own important operations and the
-- effective login-security policy. Editing security remains ADMIN-only.
insert into public.role_permission_settings(role_code, permission_code, enabled)
values
  ('SUPERVISOR', 'system.audit.view', true),
  ('SUPERVISOR', 'system.security.view', true),
  ('SALES', 'system.audit.view', true),
  ('SALES', 'system.security.view', true),
  ('SUPERVISOR', 'system.security.manage', false),
  ('SALES', 'system.security.manage', false)
on conflict(role_code, permission_code) do update
set enabled = excluded.enabled;
