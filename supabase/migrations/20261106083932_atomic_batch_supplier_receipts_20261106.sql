begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Register multiple PI product allocations against any combination of
-- suppliers and paper delivery notes as one transaction. A failed line rolls
-- back every allocation and every received-quantity change in this batch.
create function public.record_supplier_receipts_batch(
  p_stock_order_id uuid,
  p_lines jsonb,
  p_expected_updated_at timestamptz,
  p_note text default null
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  line record;
  item public.stock_order_items;
  supplier public.suppliers;
  delivery public.supplier_delivery_notes;
  progress_changes jsonb := '[]'::jsonb;
  result public.stock_orders;
  line_count integer;
  line_index integer := 0;
  normalized_number text;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit') then
    raise exception '无仓库回货或采购核价权限';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception '请选择需要登记回货的产品项';
  end if;
  line_count := jsonb_array_length(p_lines);
  if line_count < 1 or line_count > 500 or char_length(coalesce(p_note,'')) > 1000 then
    raise exception '批量产品项须为1至500项，备注最多1000字';
  end if;
  -- The parent order lock serializes receipt, reversal, shipment and amendment.
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null or target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已变更，请刷新核对后重试';
  end if;
  if target.status not in ('WAITING','PREPARING','RECEIVED','SORTING','READY_TO_SHIP') then
    raise exception '当前备货单不能登记回货';
  end if;

  -- A product can be split across suppliers and/or delivery notes in one batch.
  -- Validate and lock each product once against the aggregate requested quantity.
  for line in
    select x.item_id, sum(x.quantity)::bigint as quantity
    from jsonb_to_recordset(p_lines) as x(item_id uuid, quantity integer)
    group by x.item_id order by x.item_id
  loop
    select * into item from public.stock_order_items
      where id = line.item_id and stock_order_id = target.id for update;
    if item.id is null or item.shipped_quantity > 0
      or item.received_quantity + line.quantity > item.quantity then
      raise exception '产品行不存在、已交货代或各来源回货数量合计超过未回货数';
    end if;
  end loop;

  -- Process stable supplier/document/item order to avoid deadlocks between
  -- concurrent batches that contain overlapping delivery-note allocations.
  for line in
    select * from jsonb_to_recordset(p_lines) as x(
      item_id uuid, supplier_id uuid, note_number text, document_date date,
      quantity integer, purchase_unit_price_cny numeric, cash_paid_reported_cny numeric
    ) order by item_id, supplier_id, upper(btrim(note_number))
  loop
    line_index := line_index + 1;
    if line.item_id is null or line.supplier_id is null
      or nullif(btrim(coalesce(line.note_number,'')), '') is null
      or char_length(btrim(line.note_number)) > 100
      or line.document_date is null or line.document_date > current_date
      or line.quantity is null or line.quantity <= 0
      or line.purchase_unit_price_cny is null or line.purchase_unit_price_cny < 0
      or line.purchase_unit_price_cny > 999999999999.99
      or line.purchase_unit_price_cny <> round(line.purchase_unit_price_cny, 2)
      or (line.cash_paid_reported_cny is not null and
        (line.cash_paid_reported_cny < 0
          or line.cash_paid_reported_cny <> round(line.cash_paid_reported_cny, 2)
          or line.cash_paid_reported_cny > line.quantity * line.purchase_unit_price_cny)) then
      raise exception '第%条回货信息无效，请检查供应商、送货单、日期、数量、采购单价和现金实付金额', line_index;
    end if;
    select * into supplier from public.suppliers where id = line.supplier_id and is_active for share;
    if supplier.id is null then raise exception '请选择有效供应商档案代码'; end if;
    if supplier.settlement_cycle <> 'CASH' and line.cash_paid_reported_cny is not null then
      raise exception '只有现金结供应商可以登记现场实付金额';
    end if;
    select * into item from public.stock_order_items
      where id = line.item_id and stock_order_id = target.id for update;
    if item.id is null then raise exception '产品行不存在或不属于此备货单'; end if;

    normalized_number := btrim(line.note_number);
    insert into public.supplier_delivery_notes(supplier_id, note_number, document_date, created_by)
      values(supplier.id, normalized_number, line.document_date, actor.id)
      on conflict do nothing;
    select * into delivery from public.supplier_delivery_notes
      where supplier_id = supplier.id
        and upper(btrim(note_number)) = upper(normalized_number) for update;
    if delivery.id is null or delivery.document_date is distinct from line.document_date then
      raise exception '供应商送货单 % 已存在但日期不一致，请核对纸单', normalized_number;
    end if;

    update public.stock_order_items set procurement_cost = line.purchase_unit_price_cny,
      procurement_cost_confirmed = true where id = item.id;
    insert into public.supplier_receipt_allocations(delivery_note_id, stock_order_item_id,
      product_snapshot, quantity, purchase_unit_price_cny, cash_paid_reported_cny, recorded_by)
    values(delivery.id, item.id, jsonb_build_object(
        'line_number',item.line_number,'product_type',coalesce(item.product_type_snapshot,item.item_name),
        'item_name',item.item_name,'brand',item.brand,'model',item.model,'quality',item.quality,
        'description',item.description,'description_zh',item.description_zh),
      line.quantity, line.purchase_unit_price_cny, line.cash_paid_reported_cny, actor.id);
  end loop;

  -- record_stock_progress accepts one cumulative value per PI product row.
  -- Preserve exact multi-source provenance in the receipt ledger; only retain
  -- the legacy single supplier field when the batch has exactly one supplier.
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_id', i.id,
      'quantity', i.received_quantity + grouped.quantity,
      'supplier_code', case when grouped.supplier_count = 1 then supplier.system_code else null end
    ) order by i.line_number), '[]'::jsonb)
    into progress_changes
  from (
    select x.item_id, sum(x.quantity)::integer as quantity,
      count(distinct x.supplier_id) as supplier_count,
      min(x.supplier_id::text)::uuid as supplier_id
    from jsonb_to_recordset(p_lines) as x(item_id uuid, supplier_id uuid, quantity integer)
    group by x.item_id
  ) grouped
  join public.stock_order_items i on i.id = grouped.item_id
  left join public.suppliers supplier on grouped.supplier_count = 1 and supplier.id = grouped.supplier_id;

  result := public.record_stock_progress(p_stock_order_id, 'RECEIVE', progress_changes,
    p_expected_updated_at, nullif(btrim(coalesce(p_note,'')), ''));
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
    values(actor.id, 'SUPPLIER_RECEIPT_BATCH_RECORDED', 'stock_order', target.id,
      jsonb_build_object('line_count', line_count, 'lines', p_lines, 'note', p_note));
  return result;
end;
$$;

-- Paper delivery notes are one shared business document even when one note
-- allocates quantities across several PI/stock orders.
alter table public.attachments
  add column if not exists supplier_delivery_note_id uuid
  references public.supplier_delivery_notes(id) on delete restrict;
create index if not exists attachments_supplier_delivery_note_idx
  on public.attachments(supplier_delivery_note_id, created_at)
  where supplier_delivery_note_id is not null;

create function public.limit_supplier_delivery_note_images()
returns trigger language plpgsql set search_path = '' as $$
declare
  current_count integer;
begin
  if new.supplier_delivery_note_id is null then return new; end if;
  perform 1 from public.supplier_delivery_notes where id = new.supplier_delivery_note_id for update;
  if not found then raise exception '供应商送货单不存在'; end if;
  select count(*) into current_count from public.attachments
    where supplier_delivery_note_id = new.supplier_delivery_note_id;
  if current_count >= 10 then raise exception '每张供应商送货单最多保存10张照片'; end if;
  if new.mime_type not in ('image/jpeg','image/png','image/webp')
    or new.size_bytes is null or new.size_bytes < 1 or new.size_bytes > 5242880 then
    raise exception '送货单照片须为不超过5MB的JPG、PNG或WebP';
  end if;
  return new;
end;
$$;
create trigger attachments_supplier_delivery_note_image_limit
before insert on public.attachments
for each row when (new.supplier_delivery_note_id is not null)
execute function public.limit_supplier_delivery_note_images();
revoke all on function public.limit_supplier_delivery_note_images() from public, anon, authenticated;

revoke all on function public.record_supplier_receipts_batch(uuid,jsonb,timestamptz,text)
  from public, anon;
grant execute on function public.record_supplier_receipts_batch(uuid,jsonb,timestamptz,text)
  to authenticated;

commit;
