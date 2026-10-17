-- Keep the preparer rule consistent across every PI write path. A clerk who
-- used to own a customer must not regain legacy quote/order mutations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  entry record;
  definition text;
  updated_definition text;
begin
  for entry in
    select * from (values
      ('public.save_direct_pi_customer_text(uuid,integer,jsonb)',
       '(target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
       '((actor.role=''ORDER_CLERK'' and target.prepared_by is distinct from actor.id) or (actor.role<>''ORDER_CLERK'' and target.sales_user_id<>actor.id and actor.role<>''ADMIN''))'),
      ('public.recall_direct_pi_order(uuid,text)',
       'target.confirmation_method<>''DIRECT_PI'' or (target.sales_user_id<>actor.id and actor.role<>''ADMIN'')',
       'target.confirmation_method<>''DIRECT_PI'' or actor.role=''ORDER_CLERK'' or (target.sales_user_id<>actor.id and actor.role<>''ADMIN'')'),
      ('public.cancel_sales_order(uuid,text)',
       'if actor.id is null or target.id is null then',
       'if actor.id is null or target.id is null or actor.role=''ORDER_CLERK'' then'),
      ('public.update_sales_order_details(uuid,date,text)',
       'if actor.id is null or target.id is null then',
       'if actor.id is null or target.id is null or actor.role=''ORDER_CLERK'' then'),
      ('public.confirm_quote_create_sales_order(uuid,text,text,text)',
       'if actor.id is null then',
       'if actor.id is null or actor.role=''ORDER_CLERK'' then'),
      ('public.create_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)',
       'actor.role in (''WAREHOUSE'',''ADMIN'')',
       'actor.role in (''WAREHOUSE'',''ADMIN'',''ORDER_CLERK'')'),
      ('public.revise_quote(uuid)',
       'if actor.id is null or target.id is null then',
       'if actor.id is null or target.id is null or actor.role=''ORDER_CLERK'' then'),
      ('public.update_legacy_quote_with_items(uuid,text,text,date,text,date,text,text,text,numeric,text,jsonb)',
       'if actor.id is null or target.id is null then',
       'if actor.id is null or target.id is null or actor.role=''ORDER_CLERK'' then')
    ) as guards(signature, old_guard, new_guard)
  loop
    definition := pg_get_functiondef(entry.signature::regprocedure);
    updated_definition := replace(definition, entry.old_guard, entry.new_guard);
    if updated_definition = definition then
      raise exception 'Expected write guard missing in %', entry.signature;
    end if;
    execute updated_definition;
  end loop;
end $$;

commit;
