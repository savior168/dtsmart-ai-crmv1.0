begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- RLS limits customer rows, not columns. Keep full AI source evidence on
-- customers for server-side administrators, but deny it to direct Data API
-- clients even when they own the customer row.
revoke select, insert, update on table public.customers from anon, authenticated;

do $migration$
declare
  allowed_columns text;
begin
  select string_agg(format('%I', a.attname), ', ' order by a.attnum)
    into allowed_columns
  from pg_attribute a
  where a.attrelid = 'public.customers'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attname <> 'company_scale_evidence';

  if allowed_columns is null then
    raise exception 'customers safe column list is empty';
  end if;
  execute format(
    'grant select (%1$s), insert (%1$s), update (%1$s) on table public.customers to authenticated',
    allowed_columns
  );

  if has_column_privilege('authenticated', 'public.customers', 'company_scale_evidence', 'SELECT')
    or has_column_privilege('authenticated', 'public.customers', 'company_scale_evidence', 'INSERT')
    or has_column_privilege('authenticated', 'public.customers', 'company_scale_evidence', 'UPDATE')
    or has_column_privilege('anon', 'public.customers', 'company_scale_evidence', 'SELECT')
    or not has_column_privilege('authenticated', 'public.customers', 'id', 'SELECT')
    or not has_column_privilege('service_role', 'public.customers', 'company_scale_evidence', 'SELECT') then
    raise exception 'customers AI evidence column privilege verification failed';
  end if;
end
$migration$;

-- Future customer columns need an explicit authenticated column grant in
-- their migration; a table-level grant would re-expose this evidence field.
commit;
