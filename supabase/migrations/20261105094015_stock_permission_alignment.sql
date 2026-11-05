begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Replace only the exact legacy role gate in known stock RPCs. The function
-- body, validation, locking, audit and grants otherwise remain unchanged.
-- Fail the migration atomically if production has a different definition.
do $$
declare
  signature text;
  fn regprocedure;
  definition text;
  needle text := 'actor.role not in (''WAREHOUSE'',''ADMIN'')';
  scoped_guard text := '(not public.current_user_has_business_permission(''stock.data_all'') and not exists (select 1 from public.stock_orders scope where scope.id=p_stock_order_id and scope.sales_user_id=actor.id))';
begin
  foreach signature in array array[
    'public.warehouse_prepare_stock_draft(uuid,text,timestamptz,jsonb)',
    'public.warehouse_submit_stock_draft(uuid)',
    'public.record_stock_progress(uuid,text,jsonb,timestamptz,text)',
    'public.correct_stock_item_progress(uuid,jsonb,timestamptz,text)',
    'public.complete_stock_items_batch(uuid,text,uuid[],timestamptz)',
    'public.record_stock_shipment(uuid,uuid[],timestamptz,text,numeric,numeric,numeric)',
    'public.update_stock_order_status(uuid,text,text,numeric,numeric,numeric)',
    'public.record_supplier_receipt(uuid,uuid,uuid,text,date,integer,numeric,timestamptz,text,numeric)',
    'public.reverse_supplier_receipt(uuid,uuid,integer,timestamptz,text)'
  ] loop
    fn := to_regprocedure(signature);
    if fn is null then raise exception 'Required stock function is missing: %', signature; end if;
    definition := pg_get_functiondef(fn);
    if position(needle in definition)=0
      or position(needle in substring(definition from position(needle in definition)+length(needle)))>0 then
      raise exception 'Unexpected stock role guard: %', signature;
    end if;
    execute replace(definition, needle, scoped_guard);
  end loop;

  fn := to_regprocedure('public.save_stock_order_procurement_costs(uuid,jsonb)');
  if fn is null then raise exception 'Required stock procurement function is missing'; end if;
  definition := pg_get_functiondef(fn);
  needle := 'actor.role <> ''WAREHOUSE''';
  if position(needle in definition)=0
    or position(needle in substring(definition from position(needle in definition)+length(needle)))>0 then
    raise exception 'Unexpected stock procurement role guard';
  end if;
  execute replace(definition, needle, scoped_guard);

  fn := to_regprocedure('public.decide_direct_pi_amendment(uuid,boolean,text)');
  if fn is null then raise exception 'Required PI amendment function is missing'; end if;
  definition := pg_get_functiondef(fn);
  needle := 'actor.role not in (''WAREHOUSE'',''ADMIN'')';
  if position(needle in definition)=0
    or position(needle in substring(definition from position(needle in definition)+length(needle)))>0 then
    raise exception 'Unexpected PI amendment role guard';
  end if;
  execute replace(definition, needle,
    '(not public.current_user_has_business_permission(''stock.data_all'') and stock.sales_user_id is distinct from actor.id)');

  fn := to_regprocedure('public.stock_order_dashboard()');
  if fn is null then raise exception 'Required stock dashboard function is missing'; end if;
  definition := pg_get_functiondef(fn);
  needle := 'scope_id:=case when actor.role in (''ADMIN'',''WAREHOUSE'',''ORDER_CLERK'') then null else actor.id end;';
  if position(needle in definition)=0 then
    raise exception 'Unexpected stock dashboard scope';
  end if;
  definition := replace(definition, needle,
    'scope_id:=case when actor.role=''SUPERVISOR'' then actor.id when public.current_user_has_business_permission(''stock.data_all'') then null else actor.id end;');
  needle := 'if actor.id is null then raise exception ''当前账号无效''; end if;';
  if position(needle in definition)=0 then raise exception 'Unexpected stock dashboard auth guard'; end if;
  execute replace(definition, needle,
    needle||E'\n  if not public.current_user_has_business_permission(''stock.view'') then raise exception ''FORBIDDEN''; end if;');
end $$;

-- Keep direct Data API reads in sync with the configurable page/data grants.
-- The old permissive policies remain for backward compatibility; restrictive
-- gates ensure a revoked grant actually takes effect, including for warehouse.
create or replace function public.can_read_stock_order(
  p_sales_user_id uuid, p_status text, p_sales_order_id uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_user_has_business_permission('stock.view')
    and (p_sales_user_id=auth.uid() or
      (public.current_user_has_business_permission('stock.data_all')
        and (public.current_user_role()<>'WAREHOUSE' or p_status<>'DRAFT'
          or public.is_legacy_stock_sales_order(p_sales_order_id))))
$$;
revoke all on function public.can_read_stock_order(uuid,text,uuid) from public,anon;
grant execute on function public.can_read_stock_order(uuid,text,uuid) to authenticated;

create policy stock_orders_configurable_read on public.stock_orders
  for select to authenticated
  using (public.can_read_stock_order(sales_user_id,status,sales_order_id));
create policy stock_orders_configurable_gate on public.stock_orders
  as restrictive for select to authenticated
  using (public.can_read_stock_order(sales_user_id,status,sales_order_id));

create policy stock_items_configurable_read on public.stock_order_items
  for select to authenticated
  using (exists (select 1 from public.stock_orders s
    where s.id=stock_order_id and public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));
create policy stock_items_configurable_gate on public.stock_order_items
  as restrictive for select to authenticated
  using (exists (select 1 from public.stock_orders s
    where s.id=stock_order_id and public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));

create policy stock_events_configurable_read on public.stock_order_events
  for select to authenticated
  using (exists (select 1 from public.stock_orders s
    where s.id=stock_order_id and public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));
create policy stock_events_configurable_gate on public.stock_order_events
  as restrictive for select to authenticated
  using (exists (select 1 from public.stock_orders s
    where s.id=stock_order_id and public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));

-- Shipment/expense rows are operational data. A read-only stock grant never
-- reveals them; a granted stock updater may read them only inside its scope.
create policy stock_expenses_configurable_read on public.stock_order_expenses
  for select to authenticated
  using (public.current_user_has_business_permission('stock.update') and
    exists (select 1 from public.stock_orders s where s.id=stock_order_id and
      public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));
create policy stock_expenses_configurable_gate on public.stock_order_expenses
  as restrictive for select to authenticated
  using (public.current_user_has_business_permission('stock.update') and
    exists (select 1 from public.stock_orders s where s.id=stock_order_id and
      public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));
create policy stock_shipments_configurable_read on public.stock_order_shipments
  for select to authenticated
  using (public.current_user_has_business_permission('stock.update') and
    exists (select 1 from public.stock_orders s where s.id=stock_order_id and
      public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));
create policy stock_shipments_configurable_gate on public.stock_order_shipments
  as restrictive for select to authenticated
  using (public.current_user_has_business_permission('stock.update') and
    exists (select 1 from public.stock_orders s where s.id=stock_order_id and
      public.can_read_stock_order(s.sales_user_id,s.status,s.sales_order_id)));

commit;
