-- Supabase Auth deletion cascades into public.users. Protect business history
-- at the database boundary, including newly added attribution columns that
-- an application-side fixed checklist could miss.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.user_has_business_history(p_user_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  attribution record;
  present boolean;
begin
  if p_user_id is null then return true; end if;
  for attribution in
    select n.nspname, c.relname, a.attname
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.attnum > 0 and not a.attisdropped
      and a.atttypid = 'uuid'::regtype
      and a.attname ~ '(^user_id$|^owner_id$|^manager_id$|_user_id$|_owner_id$|_by$)'
  loop
    execute format(
      'select exists(select 1 from %I.%I where %I = $1)',
      attribution.nspname, attribution.relname, attribution.attname
    ) into present using p_user_id;
    if present then return true; end if;
  end loop;
  return false;
end
$$;
revoke all on function public.user_has_business_history(uuid) from public, anon, authenticated;
grant execute on function public.user_has_business_history(uuid) to service_role;

create or replace function public.prevent_business_user_delete()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.user_has_business_history(old.id) then
    raise exception '用户已有业务或审计记录，不能物理删除；请标记离职'
      using errcode = '23503';
  end if;
  return old;
end
$$;
revoke all on function public.prevent_business_user_delete() from public, anon, authenticated;

drop trigger if exists prevent_business_user_delete on public.users;
create trigger prevent_business_user_delete
before delete on public.users
for each row execute function public.prevent_business_user_delete();
commit;
