-- A clerk's access to another person's PI is read-only, even if an older
-- account once happened to own the customer or sales order.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
declare definition text; previous text; old_guard text; new_guard text;
begin
  old_guard := '(target.sales_user_id<>actor.id and actor.role<>''ADMIN'' and not (actor.role=''ORDER_CLERK'' and target.prepared_by=actor.id))';
  new_guard := '(actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN'')';
  definition := pg_get_functiondef('public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  previous := definition;
  definition := replace(definition,old_guard,new_guard);
  if definition=previous then raise exception 'PI draft write guard changed'; end if;
  execute definition;

  definition := pg_get_functiondef('public.submit_direct_pi_order(uuid,integer)'::regprocedure);
  previous := definition;
  definition := replace(definition,old_guard,new_guard);
  if definition=previous then raise exception 'PI submit write guard changed'; end if;
  execute definition;

  definition := pg_get_functiondef('public.set_direct_pi_change_note(uuid,integer,text)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    '(target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',new_guard);
  if definition=previous then raise exception 'PI draft note write guard changed'; end if;
  execute definition;
end $$;
commit;
