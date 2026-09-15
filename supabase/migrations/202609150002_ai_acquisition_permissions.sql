begin;

-- AI获客启用后，权限不再只保留一个菜单开关。每个可产生费用、读取跨用户
-- 数据或影响任务状态的动作都必须有独立权限；所有接口仍由服务端复核。
-- 默认范围遵循现有AI筛选：销售员仅管理本人任务，主管可查看授权范围内数据，
-- 系统管理员拥有全部权限（由应用层 ADMIN 判定，不依赖这张角色默认表）。
insert into public.role_permission_settings(role_code, permission_code, enabled)
values
  ('SUPERVISOR','ai.acquisition.view',true),
  ('SUPERVISOR','ai.acquisition.data_all',true),
  ('SUPERVISOR','ai.acquisition.create',true),
  ('SUPERVISOR','ai.acquisition.control',true),
  ('SUPERVISOR','ai.acquisition.evidence.view',true),
  ('SUPERVISOR','ai.acquisition.usage.view',true),
  ('SUPERVISOR','ai.acquisition.settings.manage',false),
  ('SALES','ai.acquisition.view',true),
  ('SALES','ai.acquisition.create',true),
  ('SALES','ai.acquisition.control',true),
  ('SALES','ai.acquisition.evidence.view',true),
  ('SALES','ai.acquisition.usage.view',true),
  ('WAREHOUSE','ai.acquisition.view',false),
  ('WAREHOUSE','ai.acquisition.data_all',false),
  ('WAREHOUSE','ai.acquisition.create',false),
  ('WAREHOUSE','ai.acquisition.control',false),
  ('WAREHOUSE','ai.acquisition.evidence.view',false),
  ('WAREHOUSE','ai.acquisition.usage.view',false),
  ('WAREHOUSE','ai.acquisition.settings.manage',false)
on conflict(role_code, permission_code) do update
set enabled = excluded.enabled, updated_at = now();

commit;
