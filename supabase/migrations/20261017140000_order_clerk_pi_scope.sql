-- A clerk prepares PI orders for a selected active salesperson. Ownership of
-- the customer, quote and order remains with that salesperson; the preparer
-- can read and edit only PI orders they themselves prepared.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.users drop constraint users_role_v4_check;
alter table public.users add constraint users_role_v5_check
  check (role in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE'));
alter table public.role_permission_settings drop constraint role_permission_settings_role_code_v4_check;
alter table public.role_permission_settings add constraint role_permission_settings_role_code_v5_check
  check (role_code in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK','WAREHOUSE'));
alter table public.sales_orders add column prepared_by uuid references public.users(id) default auth.uid();
create index sales_orders_prepared_by_idx on public.sales_orders(prepared_by, updated_at desc)
  where confirmation_method = 'DIRECT_PI';

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('ORDER_CLERK','orders.view',true), ('ORDER_CLERK','orders.create',true),
  ('ORDER_CLERK','orders.edit',true), ('ORDER_CLERK','orders.export',true),
  ('ORDER_CLERK','notifications.view',true)
on conflict (role_code,permission_code) do update set enabled = excluded.enabled;

drop policy if exists pi_payment_accounts_read on public.pi_payment_accounts;
create policy pi_payment_accounts_read on public.pi_payment_accounts for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE'
    and u.role in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK')));
drop policy if exists pi_exchange_rate_rules_read on public.pi_exchange_rate_rules;
create policy pi_exchange_rate_rules_read on public.pi_exchange_rate_rules for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE'
    and u.role in ('ADMIN','SUPERVISOR','SALES','ORDER_CLERK')));

-- Existing PI functions contain all line validation and stock-side effects.
-- Patch narrowly with fail-closed assertions so a changed upstream function
-- aborts this migration instead of silently weakening ownership checks.
do $$
declare
  original text; definition text;
  old_text text; new_text text;
begin
  definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  old_text := 'actor public.users; customer public.customers;';
  new_text := 'actor public.users; sales_owner public.users; customer public.customers;';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI creator declaration changed; review role migration'; end if;
  old_text := 'actor.role not in (''SALES'',''SUPERVISOR'',''ADMIN'')';
  new_text := 'actor.role not in (''SALES'',''SUPERVISOR'',''ADMIN'',''ORDER_CLERK'')';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI creator role guard changed; review role migration'; end if;
  old_text := 'select * into customer from public.customers where id=p_customer_id and deleted_at is null for update;';
  new_text := old_text || E'\n  sales_owner := actor;\n  if actor.role = ''ORDER_CLERK'' then\n    select * into sales_owner from public.users where id = customer.owner_id and role = ''SALES'' and status = ''ACTIVE'';\n  end if;';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI creator customer lock changed; review role migration'; end if;
  old_text := 'if customer.id is null or customer.owner_id is distinct from actor.id then';
  new_text := 'if customer.id is null or (actor.role = ''ORDER_CLERK'' and sales_owner.id is null) or (actor.role <> ''ORDER_CLERK'' and customer.owner_id is distinct from actor.id) then';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI creator ownership guard changed; review role migration'; end if;
  old_text := 'values(customer.id,actor.id,actor.id,pi_no';
  new_text := 'values(customer.id,actor.id,sales_owner.id,pi_no';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI quote ownership changed; review role migration'; end if;
  old_text := 'pi_no,customer.id,actor.id,customer.company_name';
  new_text := 'pi_no,customer.id,sales_owner.id,customer.company_name';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI sales order ownership changed; review role migration'; end if;
  old_text := '''https://www.dt-smart.com/'',actor.name,';
  new_text := '''https://www.dt-smart.com/'',sales_owner.name,';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI salesperson snapshot changed; review role migration'; end if;
  old_text := 'where p.id=actor.id)';
  new_text := 'where p.id=sales_owner.id)';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI salesperson contact snapshot changed; review role migration'; end if;
  old_text := 'actor.email)';
  new_text := 'sales_owner.email)';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI salesperson email snapshot changed; review role migration'; end if;
  execute definition;

  definition := pg_get_functiondef('public.update_direct_pi_draft(uuid,integer,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  old_text := '(target.sales_user_id<>actor.id and actor.role<>''ADMIN'')';
  new_text := '(target.sales_user_id<>actor.id and actor.role<>''ADMIN'' and not (actor.role=''ORDER_CLERK'' and target.prepared_by=actor.id))';
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI draft edit guard changed; review role migration'; end if;
  execute definition;

  definition := pg_get_functiondef('public.submit_direct_pi_order(uuid,integer)'::regprocedure);
  original := definition; definition := replace(definition,old_text,new_text);
  if definition = original then raise exception 'PI submit guard changed; review role migration'; end if;
  execute definition;
end $$;

drop policy if exists sales_orders_scope_select_v7 on public.sales_orders;
create policy sales_orders_scope_select_v8 on public.sales_orders for select to authenticated
  using(sales_user_id=auth.uid() or public.current_user_is_admin()
    or (public.current_user_role()='ORDER_CLERK' and prepared_by=auth.uid()));
drop policy if exists sales_order_items_scope_select_v7 on public.sales_order_items;
create policy sales_order_items_scope_select_v8 on public.sales_order_items for select to authenticated
  using(exists(select 1 from public.sales_orders o where o.id=sales_order_id
    and (o.sales_user_id=auth.uid() or public.current_user_is_admin()
      or (public.current_user_role()='ORDER_CLERK' and o.prepared_by=auth.uid()))));
drop policy if exists quotes_scope_select_v5 on public.quotes;
create policy quotes_scope_select_v6 on public.quotes for select to authenticated
  using(owner_id=auth.uid() or public.current_user_is_elevated()
    or (public.current_user_role()='ORDER_CLERK' and exists (
      select 1 from public.sales_orders o where o.quote_id=quotes.id and o.prepared_by=auth.uid())));

-- The announcement publisher validates its role list in SQL as well as UI.
do $$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.publish_system_announcement(uuid,text,text,text[])'::regprocedure);
  previous := definition;
  definition := replace(definition, 'cardinality(p_recipient_roles) > 4', 'cardinality(p_recipient_roles) > 5');
  definition := replace(definition, '''ADMIN'', ''SUPERVISOR'', ''SALES'', ''WAREHOUSE''',
    '''ADMIN'', ''SUPERVISOR'', ''SALES'', ''ORDER_CLERK'', ''WAREHOUSE''');
  if definition = previous or position('cardinality(p_recipient_roles) > 5' in definition)=0
    or position('''ORDER_CLERK''' in definition)=0 then
    raise exception 'Announcement role validation changed; review role migration';
  end if;
  execute definition;
end $$;
commit;
