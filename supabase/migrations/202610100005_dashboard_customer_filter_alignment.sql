begin;

-- Keep the dashboard's base customer set and country predicate identical to
-- the "我的客户" list. The RPC signature, grants and security boundary stay
-- unchanged; fail closed if a prior migration has changed the function body.
do $$
declare
  definition text;
  old_scope text := 'where c.deleted_at is null' || chr(10) || '      and c.created_at >= p_from';
  new_scope text := 'where c.deleted_at is null' || chr(10) || '      and c.status <> ''RELEASED''' || chr(10) || '      and c.created_at >= p_from';
  old_predicate text := 'lower(coalesce(c.country,'''')) like ''%'' || lower(trim(p_country)) || ''%''';
  new_predicate text := 'c.country = any (string_to_array(p_country, chr(31)))';
begin
  select pg_get_functiondef('public.dashboard_overview(timestamptz,timestamptz,uuid,text,text)'::regprocedure)
    into definition;
  if definition is null then
    raise exception 'dashboard_overview function does not exist';
  end if;
  if position(new_scope in definition) > 0 and position(new_predicate in definition) > 0 then
    return;
  end if;
  if position(old_scope in definition) = 0 or position(old_predicate in definition) = 0 then
    raise exception 'dashboard_overview predicates changed; inspect the live function before migrating';
  end if;
  definition := replace(definition, old_scope, new_scope);
  definition := replace(definition, old_predicate, new_predicate);
  execute definition;
end;
$$;

commit;
