-- `protection_rows` exposes company_name.  The JSON aggregate previously
-- ordered by a nonexistent customer_name identifier, which prevented the
-- whole dashboard overview from loading.  Replace only that identifier in
-- the existing function definition so the deployed function remains in sync
-- with the source migration without changing its data scope.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure)
  into definition;
  if definition is null then
    raise exception 'dashboard_overview function does not exist';
  end if;
  definition := replace(definition, 'order by days,customer_name)', 'order by days,company_name)');
  execute definition;
end;
$$;
