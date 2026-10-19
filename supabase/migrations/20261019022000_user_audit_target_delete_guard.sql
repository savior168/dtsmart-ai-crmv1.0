-- An account referenced as the target of an audit event also has history.
-- Keep that identity available for traceability even when it never acted as
-- audit_logs.user_id and has no other business rows.
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
  if exists (
    select 1 from public.audit_logs log where log.target_id = p_user_id
  ) then return true; end if;
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
commit;
