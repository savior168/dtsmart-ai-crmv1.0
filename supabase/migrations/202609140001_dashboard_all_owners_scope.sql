begin;

-- “全部归属人” is the aggregate of customers that have an owner.  Public-pool
-- customers are deliberately excluded, because their operational list is
-- 客户公海 rather than 我的客户.  Keep a selected individual owner unchanged.
do $$
declare
  definition text;
  previous_scope text := 'and (effective_scope is null or c.owner_id = effective_scope)';
  assigned_scope text := 'and ((effective_scope is null and c.owner_id is not null) or c.owner_id = effective_scope)';
begin
  select pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure)
    into definition;
  if definition is null then
    raise exception 'dashboard_overview function does not exist';
  end if;
  if position(previous_scope in definition) = 0 then
    raise exception 'dashboard_overview scope predicate was not found';
  end if;
  execute replace(definition, previous_scope, assigned_scope);
end;
$$;

commit;
