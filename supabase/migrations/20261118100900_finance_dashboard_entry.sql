-- A finance user needs the finance-specific landing page, not the sales CRM
-- dashboard or its cross-user data permission. Preserve existing role-level
-- disables and per-user DENY overrides.
insert into public.role_permission_settings (role_code, permission_code, enabled)
values ('FINANCE', 'dashboard.view', true),
       ('FINANCE', 'reports.view', true)
on conflict (role_code, permission_code) do nothing;
