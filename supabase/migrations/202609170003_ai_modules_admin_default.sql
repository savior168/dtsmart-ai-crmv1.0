-- AI获客与AI筛选均属于高成本、可批量创建任务的模块。
-- 系统管理员在应用层固定拥有全部权限；非管理员默认关闭，
-- 后续只能由系统管理员在“角色默认权限”或用户单独授权中明确开启。

insert into public.role_permission_settings (role_code, permission_code, enabled)
select role_code, permission_code, false
from (values ('SUPERVISOR'), ('SALES'), ('WAREHOUSE')) as roles(role_code)
cross join (values
  ('ai.acquisition.view'),
  ('ai.acquisition.data_all'),
  ('ai.acquisition.create'),
  ('ai.acquisition.control'),
  ('ai.acquisition.evidence.view'),
  ('ai.acquisition.usage.view'),
  ('ai.tasks.view'),
  ('ai.data_all'),
  ('ai.tasks.create'),
  ('ai.tasks.control'),
  ('ai.tasks.delete'),
  ('ai.results.view'),
  ('ai.results.review'),
  ('ai.usage.view'),
  ('ai.usage.view_all'),
  ('ai.cost_summary.view')
) as permissions(permission_code)
on conflict (role_code, permission_code) do update
set enabled = excluded.enabled,
    updated_at = now();
