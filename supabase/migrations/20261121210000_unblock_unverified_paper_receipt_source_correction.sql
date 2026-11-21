begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Recording an amount is not the same as paying or confirming a paper note.
-- Preserve the existing atomic correction and permission checks, but protect
-- both notes against actual settlements, packaging costs and human verification.
do $$
declare definition text;
  source_guard text := 'if source_note.paper_total_cny is not null
    or exists(select 1 from public.supplier_payments where delivery_note_id=source_note.id)';
  destination_guard text := 'or destination_note.paper_total_cny is not null then';
begin
  definition := pg_get_functiondef('public.correct_shipped_receipt_source(uuid,uuid,integer,uuid,text,date,timestamptz,text)'::regprocedure);
  if strpos(definition,source_guard)=0 or strpos(definition,destination_guard)=0 then
    raise exception '回货来源更正函数已变化，请人工复核后迁移';
  end if;
  definition := replace(definition,source_guard,
    'if exists(select 1 from app_private.supplier_note_paper_verifications where delivery_note_id=source_note.id)
    or exists(select 1 from public.supplier_payments where delivery_note_id=source_note.id)');
  definition := replace(definition,destination_guard,
    'or exists(select 1 from app_private.supplier_note_paper_verifications where delivery_note_id=destination_note.id)
    or exists(select 1 from public.supplier_payments where delivery_note_id=destination_note.id)
    or exists(select 1 from public.supplier_account_payment_allocations
      where delivery_note_id=destination_note.id and reversed_at is null)
    or exists(select 1 from public.stock_order_expense_entries
      where delivery_note_id=destination_note.id)
    or exists(select 1 from public.stock_order_shipment_expense_corrections
      where delivery_note_id=destination_note.id)
    or exists(select 1 from public.supplier_receipt_allocations
      where delivery_note_id=destination_note.id and coalesce(cash_paid_reported_cny,0)>0) then');
  definition := replace(definition,
    '原送货单已有付款、包装费用或纸单金额核对，请先由财务核对后处理',
    '原送货单已有付款、包装费用或人工纸单核对记录，请先由财务核对后处理');
  definition := replace(definition,
    '目标送货单日期不符、待补号或已核对纸单金额，请先核对',
    '目标送货单日期不符、待补号或已有付款、费用、人工核对记录，请先核对');
  execute definition;
end $$;

commit;
