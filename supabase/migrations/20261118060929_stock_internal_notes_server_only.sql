begin;
set local lock_timeout = '5s';

-- Even if an administrator grants a supplier permission by mistake, sales
-- and order clerks must not access supplier data through direct RPC calls.
do $$
declare
  definition text := pg_get_functiondef('public.current_user_has_business_permission(text)'::regprocedure);
  old_guard text := 'if actor.role in (''SALES'',''ORDER_CLERK'') and p_permission like ''supplier.documents.%'' then return false; end if;';
begin
  if position(old_guard in definition) = 0 then
    raise exception 'Expected supplier permission guard is missing';
  end if;
  execute replace(definition, old_guard,
    'if actor.role in (''SALES'',''ORDER_CLERK'') and (p_permission like ''supplier.%'' or p_permission like ''suppliers.%'') then return false; end if;');
end $$;

-- Warehouse notes are free text and may contain procurement identifiers.
-- Browser roles may read the operational columns, while the API reads notes
-- with the server role only after an RLS-scoped order lookup.
revoke select on public.stock_orders, public.stock_order_events
  from public, anon, authenticated;
grant select (
  id, quote_id, quote_number, stock_number, sales_user_id,
  customer_short_name, destination_country, status, stocking_requirements,
  expected_ready_at, ready_at, updated_by, created_at, updated_at,
  sales_order_id, order_number, warehouse_reference_number,
  delivery_recipient, delivery_phone, delivery_email, delivery_address,
  archived_at, archived_by, archive_reason, archive_batch_id
) on public.stock_orders to authenticated;
grant select (id, stock_order_id, from_status, to_status, created_by, created_at)
  on public.stock_order_events to authenticated;

-- Supplier paper images can be connected to an otherwise visible PI. The
-- attachment row itself must not be readable by sales or order clerks.
drop policy if exists attachments_supplier_paper_private on public.attachments;
create policy attachments_supplier_paper_private on public.attachments as restrictive
  for select to authenticated using (
    supplier_delivery_note_id is null
    or (public.current_user_role() not in ('SALES','ORDER_CLERK')
      and public.current_user_has_business_permission('supplier.documents.view'))
  );

-- Existing security-invoker list views keep their shape for consumers but
-- never expose the internal note through a direct PostgREST view query.
create or replace view public.stock_orders_with_pi_preparer
  with (security_invoker = true) as
select stock.id, stock.quote_id, stock.quote_number, stock.stock_number,
  stock.sales_user_id, stock.customer_short_name, stock.destination_country,
  stock.status, stock.stocking_requirements, null::text as status_note,
  stock.expected_ready_at, stock.ready_at, stock.updated_by,
  stock.created_at, stock.updated_at, stock.sales_order_id, stock.order_number,
  stock.warehouse_reference_number, stock.delivery_recipient,
  stock.delivery_phone, stock.delivery_email, stock.delivery_address,
  pi.prepared_by as pi_prepared_by, pi.updated_at as pi_updated_at
from public.stock_orders stock
left join public.sales_orders pi on pi.id = stock.sales_order_id;

create or replace view public.stock_orders_with_archive
  with (security_invoker = true) as
select stock.id, stock.quote_id, stock.quote_number, stock.stock_number,
  stock.sales_user_id, stock.customer_short_name, stock.destination_country,
  stock.status, stock.stocking_requirements, null::text as status_note,
  stock.expected_ready_at, stock.ready_at, stock.updated_by,
  stock.created_at, stock.updated_at, stock.sales_order_id, stock.order_number,
  stock.warehouse_reference_number, stock.delivery_recipient,
  stock.delivery_phone, stock.delivery_email, stock.delivery_address,
  stock.archived_at, stock.archived_by, stock.archive_reason,
  stock.archive_batch_id, pi.prepared_by as pi_prepared_by,
  pi.updated_at as pi_updated_at
from public.stock_orders stock
left join public.sales_orders pi on pi.id = stock.sales_order_id;

commit;
