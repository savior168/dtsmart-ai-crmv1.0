begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Correct provenance without changing any physical receipt, sorting or handoff
-- quantity. Both ledger entries and the audit record commit as one transaction.
create function public.correct_shipped_receipt_source(
  p_stock_order_id uuid, p_allocation_id uuid, p_quantity integer,
  p_supplier_id uuid, p_note_number text, p_document_date date,
  p_expected_updated_at timestamptz, p_reason text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  stock public.stock_orders;
  original public.supplier_receipt_allocations;
  source_note public.supplier_delivery_notes;
  destination_note public.supplier_delivery_notes;
  destination_supplier public.suppliers;
  line public.stock_order_items;
  remaining integer;
  normalized_number text := btrim(coalesce(p_note_number, ''));
  correction_id uuid;
  replacement_id uuid;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit') then
    raise exception '无仓库回货更正权限';
  end if;
  if p_quantity is null or p_quantity<=0 or p_supplier_id is null
    or normalized_number='' or char_length(normalized_number)>100
    or left(normalized_number,11)='__PENDING__'
    or p_document_date is null or p_document_date>current_date
    or char_length(btrim(coalesce(p_reason,''))) not between 2 and 500 then
    raise exception '请填写有效的转移数量、供应商、真实送货单号、日期及更正原因';
  end if;
  select * into stock from public.stock_orders where id=p_stock_order_id for update;
  if stock.id is null or stock.archived_at is not null
    or stock.status in ('DRAFT','CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all')
      and stock.sales_user_id is distinct from actor.id) then
    raise exception '备货单不存在或无更正权限';
  end if;
  if stock.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已变更，请刷新后重试';
  end if;
  select * into original from public.supplier_receipt_allocations
    where id=p_allocation_id for update;
  select * into line from public.stock_order_items
    where id=original.stock_order_item_id and stock_order_id=stock.id for update;
  if original.id is null or original.correction_of is not null or line.id is null
    or line.shipped_quantity=0 then
    raise exception '请选择本备货单已交货代产品的原始回货记录';
  end if;
  select coalesce(sum(-r.quantity),0) into remaining
    from public.supplier_receipt_allocations r where r.correction_of=original.id;
  remaining := original.quantity-remaining;
  if p_quantity>remaining then raise exception '更正数量超过原来源未冲正数量'; end if;
  select * into source_note from public.supplier_delivery_notes
    where id=original.delivery_note_id for update;
  select * into destination_supplier from public.suppliers
    where id=p_supplier_id and is_active for share;
  if destination_supplier.id is null then raise exception '请选择有效供应商'; end if;
  if source_note.supplier_id=p_supplier_id
    and upper(btrim(source_note.note_number))=upper(normalized_number) then
    raise exception '更正后的来源与原来源相同';
  end if;
  -- Payments and supplier packaging charges must be resolved by finance first.
  -- A paid or verified paper note must never silently change its payable total.
  if source_note.paper_total_cny is not null
    or exists(select 1 from public.supplier_payments where delivery_note_id=source_note.id)
    or exists(select 1 from public.supplier_account_payment_allocations
      where delivery_note_id=source_note.id and reversed_at is null)
    or exists(select 1 from public.stock_order_expense_entries
      where delivery_note_id=source_note.id)
    or exists(select 1 from public.stock_order_shipment_expense_corrections
      where delivery_note_id=source_note.id)
    or coalesce(original.cash_paid_reported_cny,0)>0 then
    raise exception '原送货单已有付款、包装费用或纸单金额核对，请先由财务核对后处理';
  end if;
  insert into public.supplier_delivery_notes(supplier_id,note_number,document_date,created_by)
    values(p_supplier_id,normalized_number,p_document_date,actor.id)
    on conflict do nothing;
  select * into destination_note from public.supplier_delivery_notes
    where supplier_id=p_supplier_id and upper(btrim(note_number))=upper(normalized_number)
    for update;
  if destination_note.id is null or destination_note.number_pending
    or destination_note.document_date is distinct from p_document_date
    or destination_note.paper_total_cny is not null then
    raise exception '目标送货单日期不符、待补号或已核对纸单金额，请先核对';
  end if;
  insert into public.supplier_receipt_allocations(
    delivery_note_id,stock_order_item_id,product_snapshot,quantity,
    purchase_unit_price_cny,recorded_by,correction_of,correction_reason)
    values(source_note.id,line.id,original.product_snapshot,-p_quantity,
      original.purchase_unit_price_cny,actor.id,original.id,btrim(p_reason))
    returning id into correction_id;
  insert into public.supplier_receipt_allocations(
    delivery_note_id,stock_order_item_id,product_snapshot,quantity,
    purchase_unit_price_cny,recorded_by)
    values(destination_note.id,line.id,original.product_snapshot,p_quantity,
      original.purchase_unit_price_cny,actor.id)
    returning id into replacement_id;
  update public.stock_orders set updated_at=now(),updated_by=actor.id where id=stock.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'SHIPPED_RECEIPT_SOURCE_CORRECTED','stock_order',stock.id,
      jsonb_build_object('original_allocation_id',original.id,
        'correction_id',correction_id,'replacement_id',replacement_id,
        'from_note_id',source_note.id,'to_note_id',destination_note.id,
        'item_id',line.id,'quantity',p_quantity,'reason',btrim(p_reason)));
  return jsonb_build_object('correction_id',correction_id,
    'replacement_id',replacement_id,'destination_note_id',destination_note.id);
end;
$$;
revoke all on function public.correct_shipped_receipt_source(uuid,uuid,integer,uuid,text,date,timestamptz,text)
  from public,anon;
grant execute on function public.correct_shipped_receipt_source(uuid,uuid,integer,uuid,text,date,timestamptz,text)
  to authenticated;
commit;
