begin;

-- AI获客会消耗受控的第三方免费额度或付费额度，默认仅系统管理员可用。
-- 管理员可通过“用户与权限”按角色或按单用户显式开通；服务端仍会同时
-- 校验页面权限与具体动作权限，不能只依赖菜单隐藏。
insert into public.role_permission_settings(role_code, permission_code, enabled)
select role_code, permission_code, false
from (values
  ('SUPERVISOR'), ('SALES'), ('WAREHOUSE')
) as roles(role_code)
cross join (values
  ('ai.acquisition.view'),
  ('ai.acquisition.data_all'),
  ('ai.acquisition.create'),
  ('ai.acquisition.control'),
  ('ai.acquisition.evidence.view'),
  ('ai.acquisition.usage.view'),
  ('ai.acquisition.settings.manage')
) as permissions(permission_code)
on conflict(role_code, permission_code) do update
set enabled = excluded.enabled, updated_at = now();

commit;
