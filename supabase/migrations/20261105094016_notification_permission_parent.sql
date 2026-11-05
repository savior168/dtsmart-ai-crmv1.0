-- The notification publishing action now lives inside the unified notification page.
-- Preserve the existing admin-only action guard while aligning its parent page.
do $$
declare
  function_sql text;
  old_rule constant text := 'when p_permission like ''system.notifications.%'' then ''system.notifications.view''';
  new_rule constant text := 'when p_permission like ''system.notifications.%'' then ''notifications.view''';
  old_core_pages constant text := '''system.roles.view'',''system.notifications.view''';
  new_core_pages constant text := '''system.roles.view''';
begin
  select pg_get_functiondef('public.current_user_has_business_permission(text)'::regprocedure)
    into function_sql;
  if function_sql is null or position(old_rule in function_sql) = 0
    or position(old_core_pages in function_sql) = 0 then
    raise exception 'Notification permission parent rule not found; migration aborted';
  end if;
  execute replace(replace(function_sql, old_rule, new_rule), old_core_pages, new_core_pages);
end $$;
