begin;
set local lock_timeout = '5s';

-- Keep the original report contract intact. The searchable report filters
-- delivery notes before summaries and pagination, so totals match the rows.
do $$
declare
  definition text := pg_get_functiondef('public.supplier_reconciliation_report(date,date,uuid,integer,integer)'::regprocedure);
  original text;
  where_clause text := 'and (p_supplier_id is null or d.supplier_id = p_supplier_id)';
begin
  original := definition;
  definition := replace(definition,
    'FUNCTION public.supplier_reconciliation_report(',
    'FUNCTION public.supplier_reconciliation_report_search(');
  definition := replace(definition,
    'p_offset integer DEFAULT 0)',
    'p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)');
  definition := replace(definition,
    'or p_limit < 1 or p_limit > 100 or p_offset < 0 then',
    'or p_limit < 1 or p_limit > 100 or p_offset < 0' || chr(10) ||
    '    or length(p_search) > 80 then');
  definition := replace(definition, where_clause, where_clause || chr(10) ||
    '        and (p_search is null' || chr(10) ||
    '          or position(lower(p_search) in lower(d.note_number)) > 0' || chr(10) ||
    '          or position(lower(p_search) in lower(s.system_code)) > 0' || chr(10) ||
    '          or exists (select 1 from public.supplier_receipt_allocations sa' || chr(10) ||
    '            join public.stock_order_items si on si.id = sa.stock_order_item_id' || chr(10) ||
    '            join public.stock_orders st on st.id = si.stock_order_id' || chr(10) ||
    '            join public.sales_orders so on so.id = st.sales_order_id' || chr(10) ||
    '            where sa.delivery_note_id = d.id' || chr(10) ||
    '              and (position(lower(p_search) in lower(so.order_number)) > 0' || chr(10) ||
    '                or position(lower(p_search) in lower(coalesce(so.warehouse_reference_number, ''''))) > 0)))');
  if definition = original
    or position('supplier_reconciliation_report_search' in definition) = 0
    or position('p_search text DEFAULT NULL::text' in definition) = 0
    or position('or length(p_search) > 80 then' in definition) = 0
    or position('sa.delivery_note_id = d.id' in definition) = 0 then
    raise exception 'Supplier report definition changed; search migration stopped';
  end if;
  execute definition;
end $$;

revoke all on function public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)
  from public, anon;
grant execute on function public.supplier_reconciliation_report_search(date,date,uuid,integer,integer,text)
  to authenticated;
commit;
