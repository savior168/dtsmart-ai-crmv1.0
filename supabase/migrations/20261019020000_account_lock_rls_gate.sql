-- A lock must revoke direct Data API access for an existing JWT as well as
-- application API access. Keep this gate separate from business RLS policies:
-- permissive policies continue to decide *which* rows an active user sees.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.current_user_is_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= now())
  ), false)
$$;
revoke all on function public.current_user_is_active() from public, anon;
grant execute on function public.current_user_is_active() to authenticated, service_role;

create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select u.role from public.users u
  where u.id = auth.uid()
    and u.status = 'ACTIVE'
    and (u.locked_until is null or u.locked_until <= now())
$$;

create or replace function public.current_user_has_business_permission(p_permission text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when u.role = 'ADMIN' then true
      when exists (
        select 1 from public.user_permission_overrides o
        where o.user_id = u.id and o.permission_code = p_permission and o.effect = 'DENY'
      ) then false
      when exists (
        select 1 from public.user_permission_overrides o
        where o.user_id = u.id and o.permission_code = p_permission and o.effect = 'ALLOW'
      ) then true
      else coalesce((
        select r.enabled from public.role_permission_settings r
        where r.role_code = u.role and r.permission_code = p_permission
      ), false)
    end
    from public.users u
    where u.id = auth.uid() and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= now())
  ), false)
$$;

create or replace function public.current_user_is_warehouse()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'WAREHOUSE'
      and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= now())
  ), false)
$$;

-- RESTRICTIVE policies are AND-ed with the existing per-table policies. This
-- covers even owner_id=auth.uid() policies that do not call the helper above.
do $$
declare t record;
begin
  for t in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid and 'authenticated'::regrole::oid = any(p.polroles)
      )
  loop
    execute format('drop policy if exists account_active_gate on %I.%I', t.nspname, t.relname);
    execute format(
      'create policy account_active_gate on %I.%I as restrictive for all to authenticated '
      || 'using ((select public.current_user_is_active())) '
      || 'with check ((select public.current_user_is_active()))',
      t.nspname, t.relname
    );
  end loop;
end $$;
commit;
