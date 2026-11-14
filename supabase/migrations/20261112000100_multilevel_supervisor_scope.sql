begin;

-- Manager assignments form a tree. Serialize changes so concurrent updates
-- cannot introduce a cycle that application-side checks would miss.
create or replace function public.prevent_manager_cycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.manager_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.manager_id is not distinct from old.manager_id then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20261112, 1);
  if new.manager_id = new.id then
    raise exception '用户不能设置自己为上级';
  end if;
  if exists (
    with recursive ancestors(id, manager_id, visited) as (
      select u.id, u.manager_id, array[u.id] from public.users u where u.id = new.manager_id
      union all
      select u.id, u.manager_id, a.visited || u.id
      from public.users u join ancestors a on u.id = a.manager_id
      where not u.id = any(a.visited)
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception '上级关系不能形成循环';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_manager_cycle on public.users;
create trigger prevent_manager_cycle
before insert or update of manager_id on public.users
for each row execute function public.prevent_manager_cycle();

-- This remains a read-only grant. Existing owner-only write policies are not
-- changed, and a disabled supervisor switch still restricts access to self.
create or replace function public.supervisor_can_read_user(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    with recursive descendants(id, visited) as (
      select actor.id, array[actor.id]
      from public.users actor
      where actor.id = auth.uid() and actor.role = 'SUPERVISOR' and actor.status = 'ACTIVE'
        and not actor.must_change_password
        and (actor.locked_until is null or actor.locked_until <= now())
        and public.current_session_is_current(actor.force_logout_at)
      union all
      -- Inactive users remain hierarchy nodes. Do not stop traversal at an
      -- inactive manager; active grandchildren still belong to the subtree.
      select child.id, d.visited || child.id
      from public.users child join descendants d on child.manager_id = d.id
      where not child.id = any(d.visited)
        and (select supervisor_can_view_subordinates from public.users where id = auth.uid())
    )
    select 1 from descendants where id = p_user_id
  );
$$;

revoke all on function public.supervisor_can_read_user(uuid) from public, anon;
grant execute on function public.supervisor_can_read_user(uuid) to authenticated, service_role;

-- Reporting RPCs are SECURITY DEFINER, so their internal scope checks must
-- use the same hierarchy rule as RLS. Abort if an upstream definition drifted.
do $scope$
declare definition text; updated text; old_fragment text;
begin
  definition := pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure);
  old_fragment := 'elsif actor.supervisor_can_view_subordinates and exists (select 1 from public.users u where u.id = p_scope_user_id and u.manager_id = actor.id and u.status = ''ACTIVE'') then';
  if position(old_fragment in definition) = 0 then raise exception 'dashboard_overview scope definition changed'; end if;
  execute replace(definition, old_fragment, 'elsif public.supervisor_can_read_user(p_scope_user_id) then');

  definition := pg_get_functiondef('public.sales_report_breakdowns(timestamptz,timestamptz,uuid)'::regprocedure);
  old_fragment := 'elsif actor.supervisor_can_view_subordinates and exists (select 1 from public.users u where u.id=p_user_id and u.manager_id=actor.id and u.status=''ACTIVE'') then';
  if position(old_fragment in definition) = 0 then raise exception 'sales_report_breakdowns scope definition changed'; end if;
  execute replace(definition, old_fragment, 'elsif public.supervisor_can_read_user(p_user_id) then');

  definition := pg_get_functiondef('public.sales_performance_report(timestamptz,timestamptz)'::regprocedure);
  old_fragment := '(a.role=''SUPERVISOR'' and (u.id=a.id or (a.supervisor_can_view_subordinates and u.manager_id=a.id)))';
  if position(old_fragment in definition) = 0 then raise exception 'sales_performance_report scope definition changed'; end if;
  execute replace(definition, old_fragment, '(a.role=''SUPERVISOR'' and public.supervisor_can_read_user(u.id))');

  definition := pg_get_functiondef('public.sales_performance_detail(timestamptz,timestamptz)'::regprocedure);
  old_fragment := 'status=''ACTIVE'' and (id=actor.id or manager_id=actor.id)';
  if position(old_fragment in definition) = 0 then raise exception 'sales_performance_detail scope definition changed'; end if;
  execute replace(definition, old_fragment, 'status=''ACTIVE'' and public.supervisor_can_read_user(id)');
end;
$scope$;

commit;
