-- Grant a read-only entry to the role-specific reports page. Its cards use
-- the existing orders.view / stock.view APIs and keep their row-level scope.
-- Do not replace an administrator's explicit role-level disable or any
-- per-user DENY override.
insert into public.role_permission_settings (role_code, permission_code, enabled)
values
  ('ORDER_CLERK', 'reports.view', true),
  ('WAREHOUSE', 'reports.view', true)
on conflict (role_code, permission_code) do nothing;
