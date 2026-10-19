-- A forced logout or role change must also invalidate the old JWT for direct
-- Data API calls. Supabase JWTs remain cryptographically valid until expiry;
-- this database gate checks the server-managed revocation timestamp.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.current_session_is_current(p_force_logout_at timestamptz)
returns boolean
language sql stable
set search_path = ''
as $$
  select case
    when p_force_logout_at is null then true
    when coalesce(auth.jwt()->>'iat', '') ~ '^[0-9]{1,12}$' then
      pg_catalog.to_timestamp((auth.jwt()->>'iat')::double precision) >= p_force_logout_at
    else false
  end
$$;
revoke all on function public.current_session_is_current(timestamptz) from public, anon;
grant execute on function public.current_session_is_current(timestamptz) to authenticated, service_role;

create or replace function public.current_user_is_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= pg_catalog.now())
      and public.current_session_is_current(u.force_logout_at)
  ), false)
$$;

create or replace function public.current_user_role()
returns text
language sql stable security definer
set search_path = ''
as $$
  select u.role from public.users u
  where u.id = auth.uid() and u.status = 'ACTIVE'
    and (u.locked_until is null or u.locked_until <= pg_catalog.now())
    and public.current_session_is_current(u.force_logout_at)
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
      and (u.locked_until is null or u.locked_until <= pg_catalog.now())
      and public.current_session_is_current(u.force_logout_at)
  ), false)
$$;

create or replace function public.current_user_is_warehouse()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'WAREHOUSE' and u.status = 'ACTIVE'
      and (u.locked_until is null or u.locked_until <= pg_catalog.now())
      and public.current_session_is_current(u.force_logout_at)
  ), false)
$$;
commit;
