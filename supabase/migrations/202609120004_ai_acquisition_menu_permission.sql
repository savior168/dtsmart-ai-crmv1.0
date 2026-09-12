begin;

-- Record the independent menu switch explicitly.  The item remains a clearly
-- marked planning entry until the separate acquisition product is delivered;
-- it must not inherit the unrelated import permission.
insert into public.role_permission_settings(role_code, permission_code, enabled)
values
  ('SUPERVISOR','ai.acquisition.view',false),
  ('SALES','ai.acquisition.view',false),
  ('WAREHOUSE','ai.acquisition.view',false)
on conflict(role_code, permission_code) do nothing;

commit;
