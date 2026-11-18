begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This is an attribution correction, not a new physical receipt. Transfer an
-- explicitly verified quantity from the legacy baseline to the immutable
-- supplier allocation ledger without changing received/prepared/shipped stock.
create function public.link_legacy_supplier_receipt_source(
  p_stock_order_item_id uuid, p_supplier_id uuid, p_note_number text,
  p_document_date date, p_quantity integer, p_purchase_unit_price_cny numeric,
  p_expected_stock_updated_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  item public.stock_order_items;
  baseline public.supplier_receipt_legacy_baselines;
  supplier public.suppliers;
  delivery public.supplier_delivery_notes;
  allocation_id uuid;
  normalized_number text := btrim(coalesce(p_note_number,''));
  remaining integer;
begin
  select * into actor from public.users where id=auth.uid() and status='ACTIVE';
  if actor.id is null or actor.role <> 'WAREHOUSE'
    or not public.current_user_has_business_permission('stock.view')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit')
    or not public.current_user_has_business_permission('supplier.documents.view')
    or not public.current_user_has_business_permission('supplier.documents.manage') then
    raise exception '无补全历史送货单来源权限';
  end if;
  if p_quantity is null or p_quantity <= 0
    or p_purchase_unit_price_cny is null or p_purchase_unit_price_cny < 0
    or p_purchase_unit_price_cny > 999999999999.99
    or p_purchase_unit_price_cny <> round(p_purchase_unit_price_cny,2)
    or p_document_date is null or p_document_date > current_date
    or normalized_number = '' or char_length(normalized_number) > 100
    or left(normalized_number,11) = '__PENDING__' then
    raise exception '请按纸单填写有效供应商、单号、日期、数量和采购单价';
  end if;
  select o.* into target from public.stock_orders o
    join public.stock_order_items i on i.stock_order_id=o.id
    where i.id=p_stock_order_item_id for update of o;
  if target.id is null or target.updated_at is distinct from p_expected_stock_updated_at
    or target.status='CANCELLED' then
    raise exception '备货单已变更或不可补录，请刷新后重试';
  end if;
  select * into item from public.stock_order_items
    where id=p_stock_order_item_id and stock_order_id=target.id for update;
  select * into baseline from public.supplier_receipt_legacy_baselines
    where stock_order_item_id=item.id for update;
  if baseline.stock_order_item_id is null or p_quantity > baseline.quantity then
    raise exception '待补来源数量已变更或超出历史回货数量';
  end if;
  select * into supplier from public.suppliers where id=p_supplier_id for share;
  if supplier.id is null then raise exception '请选择真实供应商档案代码'; end if;
  insert into public.supplier_delivery_notes(supplier_id,note_number,document_date,created_by)
    values(supplier.id,normalized_number,p_document_date,actor.id) on conflict do nothing;
  select * into delivery from public.supplier_delivery_notes
    where supplier_id=supplier.id and upper(btrim(note_number))=upper(normalized_number) for update;
  if delivery.id is null or delivery.document_date is distinct from p_document_date
    or delivery.number_pending then
    raise exception '供应商纸单号已存在但日期或状态不一致，请核对原件';
  end if;
  insert into public.supplier_receipt_allocations(
    delivery_note_id,stock_order_item_id,product_snapshot,quantity,
    purchase_unit_price_cny,recorded_by)
  values(delivery.id,item.id,jsonb_build_object(
    'line_number',item.line_number,
    'product_type',coalesce(item.product_type_snapshot,item.item_name),
    'item_name',item.item_name,'brand',item.brand,'model',item.model,
    'quality',item.quality,'description',item.description,
    'description_zh',item.description_zh),
    p_quantity,p_purchase_unit_price_cny,actor.id)
  returning id into allocation_id;
  remaining := baseline.quantity-p_quantity;
  if remaining=0 then
    delete from public.supplier_receipt_legacy_baselines where stock_order_item_id=item.id;
  else
    update public.supplier_receipt_legacy_baselines set quantity=remaining
      where stock_order_item_id=item.id;
  end if;
  update public.stock_orders set updated_at=clock_timestamp(),updated_by=actor.id
    where id=target.id;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
    values(actor.id,'LEGACY_SUPPLIER_SOURCE_LINKED','stock_order',target.id,
      jsonb_build_object('stock_order_item_id',item.id,'supplier_id',supplier.id,
        'delivery_note_id',delivery.id,'allocation_id',allocation_id,
        'quantity',p_quantity,'remaining_legacy_quantity',remaining,
        'purchase_unit_price_cny',p_purchase_unit_price_cny));
  return jsonb_build_object('stock_order_id',target.id,'delivery_note_id',delivery.id,
    'allocation_id',allocation_id,'remaining_quantity',remaining);
end;
$$;
revoke all on function public.link_legacy_supplier_receipt_source(uuid,uuid,text,date,integer,numeric,timestamptz)
  from public,anon;
grant execute on function public.link_legacy_supplier_receipt_source(uuid,uuid,text,date,integer,numeric,timestamptz)
  to authenticated;

commit;
