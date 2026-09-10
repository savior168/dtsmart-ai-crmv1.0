-- AI筛选用量与费用包含第三方成本信息，默认只对系统管理员开放。
-- 非管理员仍可由权限中心按角色启用，或使用用户级 ALLOW 覆盖授权。
insert into public.role_permission_settings(role_code, permission_code, enabled)
values
  ('ADMIN', 'ai.usage.view', true),
  ('SUPERVISOR', 'ai.usage.view', false),
  ('SALES', 'ai.usage.view', false),
  ('WAREHOUSE', 'ai.usage.view', false)
on conflict(role_code, permission_code)
do update set enabled = excluded.enabled, updated_at = now();
