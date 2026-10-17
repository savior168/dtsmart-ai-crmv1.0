-- Clerk: read every assigned customer, every PI and stock order; only PIs
-- they prepared may be edited or submitted by the existing RPC guards.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into public.role_permission_settings(role_code,permission_code,enabled)
values ('ORDER_CLERK','customers.view',true),
  ('ORDER_CLERK','customers.data_all',true),
  ('ORDER_CLERK','orders.data_all',true),
  ('ORDER_CLERK','stock.view',true),
  ('ORDER_CLERK','stock.data_all',true)
on conflict (role_code,permission_code) do update set enabled=excluded.enabled;

create policy customers_order_clerk_assigned_read on public.customers
  for select to authenticated using (
    deleted_at is null and owner_id is not null
    and exists (select 1 from public.users actor where actor.id=auth.uid()
      and actor.role='ORDER_CLERK' and actor.status='ACTIVE'));

create policy sales_orders_clerk_read_all_pi on public.sales_orders
  for select to authenticated using (
    confirmation_method='DIRECT_PI' and exists (select 1 from public.users actor
      where actor.id=auth.uid() and actor.role='ORDER_CLERK' and actor.status='ACTIVE'));
create policy sales_items_clerk_read_all_pi on public.sales_order_items
  for select to authenticated using (
    exists (select 1 from public.sales_orders pi where pi.id=sales_order_id
      and pi.confirmation_method='DIRECT_PI'
      and exists (select 1 from public.users actor where actor.id=auth.uid()
        and actor.role='ORDER_CLERK' and actor.status='ACTIVE')));

create policy stock_orders_clerk_read_all on public.stock_orders
  for select to authenticated using (
    exists (select 1 from public.users actor where actor.id=auth.uid()
      and actor.role='ORDER_CLERK' and actor.status='ACTIVE'));
create policy stock_items_clerk_read_all on public.stock_order_items
  for select to authenticated using (
    exists (select 1 from public.stock_orders stock where stock.id=stock_order_id
      and exists (select 1 from public.users actor where actor.id=auth.uid()
        and actor.role='ORDER_CLERK' and actor.status='ACTIVE')));
create policy stock_events_clerk_read_all on public.stock_order_events
  for select to authenticated using (
    exists (select 1 from public.stock_orders stock where stock.id=stock_order_id
      and exists (select 1 from public.users actor where actor.id=auth.uid()
        and actor.role='ORDER_CLERK' and actor.status='ACTIVE')));

do $$
declare definition text; previous text;
begin
  definition := pg_get_functiondef('public.create_direct_pi_order(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'id = customer.owner_id and role = ''SALES'' and status = ''ACTIVE''',
    'id = customer.owner_id and role in (''SALES'',''SUPERVISOR'') and status = ''ACTIVE''');
  if definition=previous then raise exception 'PI salesperson/manager owner guard changed'; end if;
  execute definition;

  definition := pg_get_functiondef('public.create_direct_pi_order_with_fees(uuid,text,text,numeric,numeric,text,uuid,date,date,text,text,text,text,text,jsonb,jsonb,uuid)'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'u.role = ''SALES'' and u.status = ''ACTIVE''',
    'u.role in (''SALES'',''SUPERVISOR'') and u.status = ''ACTIVE''');
  if definition=previous then raise exception 'PI fee creator owner guard changed'; end if;
  execute definition;

  definition := pg_get_functiondef('public.stock_order_dashboard()'::regprocedure);
  previous := definition;
  definition := replace(definition,
    'actor.role in (''ADMIN'',''WAREHOUSE'')',
    'actor.role in (''ADMIN'',''WAREHOUSE'',''ORDER_CLERK'')');
  if definition=previous then raise exception 'Stock dashboard scope changed'; end if;
  execute definition;
end $$;
commit;
