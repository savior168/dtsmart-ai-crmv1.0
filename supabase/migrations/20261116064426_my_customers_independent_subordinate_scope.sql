begin;

-- Customer visibility is an explicit per-user grant. The general supervisor
-- switch never authorizes a subordinate's private customer records.
create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.supervisor_can_read_customer_owner(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null
    and public.current_user_has_business_permission('customers.data_all')
    and exists (
      select 1 from public.user_permission_overrides o
      where o.user_id = auth.uid() and o.permission_code = 'customers.data_all'
        and o.effect = 'ALLOW'
    )
    and exists (
      with recursive descendants(id, visited) as (
        select actor.id, array[actor.id]
        from public.users actor
        where actor.id = auth.uid() and actor.role = 'SUPERVISOR'
          and actor.status = 'ACTIVE' and not actor.must_change_password
          and (actor.locked_until is null or actor.locked_until <= now())
          and public.current_session_is_current(actor.force_logout_at)
        union all
        select child.id, d.visited || child.id
        from public.users child join descendants d on child.manager_id = d.id
        where not child.id = any(d.visited)
      )
      select 1 from descendants where id = p_user_id
    );
$$;

revoke all on function app_private.supervisor_can_read_customer_owner(uuid) from public, anon;
grant execute on function app_private.supervisor_can_read_customer_owner(uuid) to authenticated, service_role;

drop policy if exists customers_supervisor_data_scope on public.customers;
create policy customers_supervisor_data_scope on public.customers as restrictive
for select to authenticated using (
  public.current_user_role() <> 'SUPERVISOR'
  or coalesce(owner_id, owner_user_id, created_by) = auth.uid()
  or app_private.supervisor_can_read_customer_owner(coalesce(owner_id, owner_user_id, created_by))
  or (owner_id is null and acquisition_scope = 'PUBLIC_POOL'
    and pool_status = 'AVAILABLE' and status = 'UNCLAIMED')
);

commit;
