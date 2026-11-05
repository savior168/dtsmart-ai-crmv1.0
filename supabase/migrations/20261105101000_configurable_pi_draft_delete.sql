-- The role/user permission registry is the authorization source of truth.
-- Creator ownership and never-submitted-state guards remain in the RPC.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  definition text;
  previous text;
begin
  definition := pg_get_functiondef('public.delete_never_submitted_pi_draft(uuid,integer)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'if actor.id is null or actor.role not in (''SALES'',''ADMIN'')' || chr(10) ||
    '    or not public.current_user_has_business_permission(''orders.delete_draft'') then',
    'if actor.id is null or not public.current_user_has_business_permission(''orders.delete_draft'') then');
  if definition = previous then
    raise exception 'PI草稿删除RPC权限判断已变化；需人工复核后再迁移';
  end if;
  execute definition;
end;
$$;

commit;
