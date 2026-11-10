-- Split navigation permissions without changing any existing user's effective access.
-- Independent settings are seeded from the corresponding legacy settings once.
insert into public.role_permission_settings (role_code, permission_code, enabled)
select role_code, replacement, enabled
from public.role_permission_settings
cross join lateral (
  select unnest(case permission_code
    when 'customers.view' then array['customers.pool.view', 'customers.mine.view']
    when 'reports.view' then array['sales.performance.view']
    when 'reports.data_all' then array['sales.performance.data_all']
    when 'reports.actual_profit.view' then array['sales.performance.actual_profit.view']
    else array[]::text[] end) as replacement
) aliases
on conflict (role_code, permission_code) do nothing;

insert into public.user_permission_overrides (user_id, permission_code, effect)
select user_id, replacement, effect
from public.user_permission_overrides
cross join lateral (
  select unnest(case permission_code
    when 'customers.view' then array['customers.pool.view', 'customers.mine.view']
    when 'reports.view' then array['sales.performance.view']
    when 'reports.data_all' then array['sales.performance.data_all']
    when 'reports.actual_profit.view' then array['sales.performance.actual_profit.view']
    else array[]::text[] end) as replacement
) aliases
on conflict (user_id, permission_code) do nothing;

-- Keep the database permission gate aligned with the application catalog.
-- Fail closed if an earlier migration changed the expected function body.
do $$
declare
  function_sql text;
  old_customer_rule constant text := 'when p_permission like ''customers.%'' then ''customers.view''';
  new_customer_rule constant text :=
    'when p_permission like ''customers.pool.%'' or p_permission in (''customers.claim'',''customers.assign'') then ''customers.pool.view''' || E'\n    ' ||
    'when p_permission like ''customers.mine.%'' or p_permission in (''customers.create'',''customers.edit'',''customers.delete'',''customers.export'',''customers.batch_edit'',''customers.release'',''customers.renew'',''customers.renew.review'',''customers.data_all'') then ''customers.mine.view''' || E'\n    ' ||
    old_customer_rule;
  old_report_rule constant text := 'when p_permission like ''reports.%'' then ''reports.view''';
  new_report_rule constant text :=
    'when p_permission like ''sales.performance.%'' then ''sales.performance.view''' || E'\n    ' || old_report_rule;
  old_guard constant text := 'if p_permission is null or p_permission like ''quotes.%'' then return false; end if;';
  new_guard constant text := old_guard || E'\n  ' ||
    'if p_permission like ''customers.%'' and p_permission <> ''customers.view'' ' ||
    'and not public.current_user_has_business_permission(''customers.view'') then return false; end if;';
begin
  select pg_get_functiondef('public.current_user_has_business_permission(text)'::regprocedure)
    into function_sql;
  if function_sql is null or position(old_customer_rule in function_sql) = 0
    or position(old_report_rule in function_sql) = 0
    or position(old_guard in function_sql) = 0 then
    raise exception 'Expected business permission parent mapping not found; migration aborted';
  end if;
  function_sql := replace(function_sql, old_customer_rule, new_customer_rule);
  function_sql := replace(function_sql, old_report_rule, new_report_rule);
  function_sql := replace(function_sql, old_guard, new_guard);
  execute function_sql;
end $$;
