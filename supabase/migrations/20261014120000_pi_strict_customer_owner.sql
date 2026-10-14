-- The administrator may manage the system, but PI creation is deliberately
-- limited to customers currently owned by the actor. No creator fallback.
begin;

-- Preserve reciprocal precision for currencies whose CNY exchange rate is
-- large (for example, 1 payment currency = hundreds of CNY).
alter table public.quotes alter column fx_rate_cny_to_payment type numeric(22,12);
alter table public.sales_orders alter column fx_rate_cny_to_payment type numeric(22,12);

do $$
declare
  create_definition text;
  submit_definition text;
  old_create_guard text := 'if customer.id is null or (actor.role<>''ADMIN'' and coalesce(customer.owner_user_id,customer.owner_id,customer.created_by)<>actor.id) then';
  old_submit_guard text := 'and (actor.role=''ADMIN'' or coalesce(c.owner_user_id,c.owner_id,c.created_by)=target.sales_user_id)) then';
begin
  create_definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  submit_definition := pg_get_functiondef('public.submit_direct_pi_order(uuid,integer)'::regprocedure);
  if position(old_create_guard in create_definition)=0 or position(old_submit_guard in submit_definition)=0 then
    raise exception 'PI owner guard changed; review before applying';
  end if;
  execute replace(create_definition,old_create_guard,
    'if customer.id is null or customer.owner_id is distinct from actor.id then');
  execute replace(submit_definition,old_submit_guard,
    'and c.owner_id=target.sales_user_id) then');
end $$;

commit;
