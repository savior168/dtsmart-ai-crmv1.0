begin;

-- dashboard_overview is SECURITY DEFINER. An aggregate team request must be
-- narrowed inside the function, not merely by the API or a client-side option.
do $scope$
declare
  definition text;
  original_branch text := 'if p_scope_user_id is null or p_scope_user_id = actor.id then';
  team_branch text := 'if p_scope_user_id is null and actor.supervisor_can_view_subordinates
      and public.current_user_has_business_permission(''dashboard.data_all'') then
      effective_scope := null;
    elsif p_scope_user_id is null or p_scope_user_id = actor.id then';
  original_predicate text := 'and ((effective_scope is null and c.owner_id is not null) or c.owner_id = effective_scope)';
  team_predicate text := 'and ((effective_scope is null and c.owner_id is not null) or c.owner_id = effective_scope)
      and (actor.role <> ''SUPERVISOR'' or public.supervisor_can_read_user(c.owner_id))';
  selected_branch text := 'elsif public.supervisor_can_read_user(p_scope_user_id) then';
  original_guard text := 'if actor.id is null or actor.role = ''WAREHOUSE'' then';
begin
  definition := pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure);
  if position(original_branch in definition) = 0 or position(original_predicate in definition) = 0
    or position(selected_branch in definition) = 0 or position(original_guard in definition) = 0 then
    raise exception 'dashboard_overview owner scope definition changed';
  end if;
  definition := replace(definition, original_guard,
    'if actor.id is null or actor.role = ''WAREHOUSE'' or not public.current_user_has_business_permission(''dashboard.view'') then');
  definition := replace(definition, original_branch, team_branch);
  definition := replace(definition, selected_branch,
    'elsif public.current_user_has_business_permission(''dashboard.data_all'') and public.supervisor_can_read_user(p_scope_user_id) then');
  execute replace(definition, original_predicate, team_predicate);
end;
$scope$;

-- The sales report is another SECURITY DEFINER aggregate. Every source in
-- the report (including trends) must use the same team boundary.
do $report$
declare
  definition text;
  old_parts text[] := array[
    'if p_user_id is null or p_user_id=actor.id then',
    'elsif public.supervisor_can_read_user(p_user_id) then',
    'if actor.id is null or actor.role=''WAREHOUSE'' then',
    '(scope_id is null or c.owner_id=scope_id)',
    '(scope_id is null or user_id=scope_id)',
    '(scope_id is null or owner_id=scope_id)',
    '(scope_id is null or sales_user_id=scope_id)',
    '(scope_id is null or f.user_id=scope_id)',
    '(scope_id is null or q.owner_id=scope_id)'
  ];
  new_parts text[] := array[
    'if p_user_id is null and actor.supervisor_can_view_subordinates
      and public.current_user_has_business_permission(''reports.data_all'') then
      scope_id:=null;
    elsif p_user_id is null or p_user_id=actor.id then',
    'elsif public.current_user_has_business_permission(''reports.data_all'') and public.supervisor_can_read_user(p_user_id) then',
    'if actor.id is null or actor.role=''WAREHOUSE'' or not public.current_user_has_business_permission(''reports.view'') then',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(c.owner_id))) or c.owner_id=scope_id)',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(user_id))) or user_id=scope_id)',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(owner_id))) or owner_id=scope_id)',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(sales_user_id))) or sales_user_id=scope_id)',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(f.user_id))) or f.user_id=scope_id)',
    '((scope_id is null and (actor.role<>''SUPERVISOR'' or public.supervisor_can_read_user(q.owner_id))) or q.owner_id=scope_id)'
  ];
begin
  definition := pg_get_functiondef('public.sales_report_breakdowns(timestamptz,timestamptz,uuid)'::regprocedure);
  for i in 1..array_length(old_parts, 1) loop
    if position(old_parts[i] in definition) = 0 then
      raise exception 'sales_report_breakdowns owner scope definition changed at %', i;
    end if;
    definition := replace(definition, old_parts[i], new_parts[i]);
  end loop;
  execute definition;
end;
$report$;

-- Ranking is read by the report center. A direct RPC call must not expose
-- subordinate rows when the report data grant has been revoked.
do $ranking$
declare
  definition text;
  old_scope text := '(a.role=''SUPERVISOR'' and public.supervisor_can_read_user(u.id))';
  old_actor text := 'where id=auth.uid() and status=''ACTIVE'' and role<>''WAREHOUSE''';
begin
  definition := pg_get_functiondef('public.sales_performance_report(timestamptz,timestamptz)'::regprocedure);
  if position(old_scope in definition) = 0 or position(old_actor in definition) = 0 then
    raise exception 'sales_performance_report owner scope definition changed';
  end if;
  definition := replace(definition, old_actor,
    'where id=auth.uid() and status=''ACTIVE'' and role<>''WAREHOUSE''
      and public.current_user_has_business_permission(''reports.view'')');
  execute replace(definition, old_scope,
    '(a.role=''SUPERVISOR'' and public.current_user_has_business_permission(''reports.view'')
      and (u.id=a.id or (public.current_user_has_business_permission(''reports.data_all'')
        and public.supervisor_can_read_user(u.id))))');
end;
$ranking$;

-- The stock-order gate is also used by a security-invoker list view. Keep
-- stock.data_all on a supervisor within the authorized descendant tree.
create or replace function public.can_read_stock_order(
  p_sales_user_id uuid, p_status text, p_sales_order_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_has_business_permission('stock.view')
    and (p_sales_user_id = auth.uid() or
      (public.current_user_has_business_permission('stock.data_all')
        and (public.current_user_role() <> 'SUPERVISOR'
          or public.supervisor_can_read_user(p_sales_user_id))
        and (public.current_user_role() <> 'WAREHOUSE' or p_status <> 'DRAFT'
          or public.is_legacy_stock_sales_order(p_sales_order_id))))
$$;

commit;
