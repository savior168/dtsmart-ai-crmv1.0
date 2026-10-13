-- Permit the platform administrator to create and submit a PI for any active
-- customer without changing that customer's ownership. Keep sales restrictions.
begin;

do $$
declare
  create_definition text;
  submit_definition text;
  create_guard text := 'if customer.id is null or coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id then';
  submit_guard text := 'and coalesce(c.owner_user_id,c.owner_id,c.created_by)=target.sales_user_id) then';
begin
  create_definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  submit_definition := pg_get_functiondef('public.submit_direct_pi_order(uuid,integer)'::regprocedure);
  if position(create_guard in create_definition)=0 or position(submit_guard in submit_definition)=0 then
    raise exception 'PI function signature or owner guard changed; review migration before applying';
  end if;
  execute replace(create_definition, create_guard,
    'if customer.id is null or (actor.role<>''ADMIN'' and coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id) then');
  execute replace(submit_definition, submit_guard,
    'and (actor.role=''ADMIN'' or coalesce(c.owner_user_id,c.owner_id,c.created_by)=target.sales_user_id)) then');
end $$;

commit;
