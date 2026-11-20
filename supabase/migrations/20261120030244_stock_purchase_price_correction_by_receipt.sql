begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Price and warehouse notes are metadata. Physical quantities and product
-- identity remain frozen after shipment.
create or replace function public.prevent_shipped_stock_line_amendment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.shipped_quantity > 0 then
      raise exception '第%项已有交货代数量，不能删除产品记录', old.line_number;
    end if;
    if old.received_quantity > 0 or old.prepared_quantity > 0 then
      raise exception '第%项已有回货或理货记录，须先核对实物并冲正后才能删除', old.line_number;
    end if;
    return old;
  end if;
  if current_setting('app.pi_amendment_apply', true) = '1'
    and to_jsonb(new) - 'estimated_unit_cost_cny'
      = to_jsonb(old) - 'estimated_unit_cost_cny' then return new; end if;
  if current_setting('app.warehouse_actual_cost_apply', true) = '1'
    and to_jsonb(new) - 'warehouse_actual_unit_cost_cny'
      - 'warehouse_actual_cost_updated_at' - 'warehouse_actual_cost_updated_by'
      = to_jsonb(old) - 'warehouse_actual_unit_cost_cny'
      - 'warehouse_actual_cost_updated_at' - 'warehouse_actual_cost_updated_by' then return new; end if;
  if current_setting('app.stock_procurement_price_apply', true) = '1'
    and to_jsonb(new) - 'procurement_cost' - 'procurement_cost_confirmed' - 'warehouse_note'
      = to_jsonb(old) - 'procurement_cost' - 'procurement_cost_confirmed' - 'warehouse_note' then return new; end if;
  if old.shipped_quantity > 0 and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception '第%项已有交货代数量，不能变更已发货产品记录', old.line_number;
  end if;
  if current_setting('app.pi_amendment_apply', true) = '1'
    and old.shipped_quantity = 0 and new.quantity >= old.received_quantity
    and new.quantity >= old.prepared_quantity then return new; end if;
  if old.received_quantity > 0 and (
    new.quantity is distinct from old.quantity
    or new.item_name is distinct from old.item_name
    or new.brand is distinct from old.brand
    or new.model is distinct from old.model
    or new.quality is distinct from old.quality
    or new.description is distinct from old.description
    or new.product_type_snapshot is distinct from old.product_type_snapshot
    or new.estimated_unit_cost_cny is distinct from old.estimated_unit_cost_cny
  ) then
    raise exception '第%项已有实物回货，须先由仓库核对并冲正或重新分配，才能生效PI产品变更', old.line_number;
  end if;
  return new;
end;
$$;

-- This is a line-level default for future receipts. Once a receipt exists,
-- its own purchase price is the payable source of truth and must be corrected
-- through the dedicated audited RPC below.
create or replace function public.save_stock_order_procurement_costs(p_stock_order_id uuid, p_items jsonb)
returns public.stock_orders language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  expected_count integer;
  changed_lines jsonb;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role in ('SALES', 'ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.procurement.edit')
  then raise exception '无采购核价权限'; end if;
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null or target.archived_at is not null or target.status in ('DRAFT', 'CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all') and target.sales_user_id is distinct from actor.id)
  then raise exception '备货单不存在或当前状态不可核价'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception '采购信息明细格式不正确'; end if;
  select count(*) into expected_count from public.stock_order_items
    where stock_order_id = target.id and pi_amendment_cancelled_at is null;
  if (select count(*) from jsonb_array_elements(p_items)) <> expected_count
    or (select count(distinct x.line_number) from jsonb_to_recordset(p_items) as x(line_number integer)) <> expected_count
    or exists (select 1 from jsonb_to_recordset(p_items) as x(line_number integer)
      where not exists (select 1 from public.stock_order_items i
        where i.stock_order_id = target.id and i.line_number = x.line_number
          and i.pi_amendment_cancelled_at is null))
  then raise exception '采购信息明细与备货单产品不一致'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(procurement_cost numeric, warehouse_note text)
    where x.procurement_cost < 0 or x.procurement_cost > 999999999999.99
      or x.procurement_cost <> round(x.procurement_cost, 2)
      or char_length(coalesce(x.warehouse_note, '')) > 1000)
  then raise exception '采购价必须为非负金额且最多两位小数；仓库备注最多1000字'; end if;
  -- Lock active rows before checking receipt allocations to keep the status
  -- check and write in one transaction with receipt creation.
  perform 1 from public.stock_order_items i where i.stock_order_id = target.id
    and i.pi_amendment_cancelled_at is null order by i.id for update;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(line_number integer, procurement_cost numeric)
    join public.stock_order_items i on i.stock_order_id = target.id and i.line_number = x.line_number
    where x.procurement_cost is not null
      and (i.procurement_cost_confirmed is not true or x.procurement_cost is distinct from i.procurement_cost)
      and exists (select 1 from public.supplier_receipt_allocations a
        where a.stock_order_item_id = i.id group by a.stock_order_item_id having sum(a.quantity) > 0)
  ) then raise exception '已有回货送货单，请在对应送货单记录中更正采购价'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('line_number', i.line_number,
    'before_cny', case when i.procurement_cost_confirmed then i.procurement_cost else null end,
    'after_cny', x.procurement_cost)), '[]'::jsonb) into changed_lines
  from public.stock_order_items i
  join jsonb_to_recordset(p_items) as x(line_number integer, procurement_cost numeric)
    on x.line_number = i.line_number
  where i.stock_order_id = target.id and i.pi_amendment_cancelled_at is null
    and x.procurement_cost is not null
    and (i.procurement_cost_confirmed is not true or x.procurement_cost is distinct from i.procurement_cost);
  perform set_config('app.stock_procurement_price_apply', '1', true);
  update public.stock_order_items i set
    procurement_cost = coalesce(x.procurement_cost, i.procurement_cost),
    procurement_cost_confirmed = case when x.procurement_cost is null
      then i.procurement_cost_confirmed else true end,
    warehouse_note = case when exists (
      select 1 from jsonb_array_elements(p_items) supplied(value)
      where (supplied.value->>'line_number')::integer = i.line_number and supplied.value ? 'warehouse_note'
    ) then nullif(btrim(coalesce(x.warehouse_note, '')), '') else i.warehouse_note end
  from jsonb_to_recordset(p_items) as x(line_number integer, procurement_cost numeric, warehouse_note text)
  where i.stock_order_id = target.id and i.line_number = x.line_number and i.pi_amendment_cancelled_at is null;
  perform set_config('app.stock_procurement_price_apply', '0', true);
  update public.stock_orders set updated_by = actor.id, updated_at = now()
    where id = target.id returning * into target;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values (actor.id, 'STOCK_PROCUREMENT_COST_UPDATE', 'stock_order', target.id,
    jsonb_build_object('price_changes', changed_lines,
      'confirmed_lines', (select count(*) from public.stock_order_items
        where stock_order_id = target.id and procurement_cost_confirmed and pi_amendment_cancelled_at is null)));
  return target;
end;
$$;
revoke all on function public.save_stock_order_procurement_costs(uuid, jsonb) from public, anon;
grant execute on function public.save_stock_order_procurement_costs(uuid, jsonb) to authenticated;

-- Correct the financial source row, not just the stock-line default. A paid
-- note requires a separate finance decision and must never be silently repriced.
create function public.correct_supplier_receipt_purchase_price(
  p_stock_order_id uuid, p_allocation_id uuid, p_expected_price_cny numeric,
  p_new_price_cny numeric, p_reason text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  stock public.stock_orders;
  line public.stock_order_items;
  allocation public.supplier_receipt_allocations;
  note public.supplier_delivery_notes;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role in ('SALES', 'ORDER_CLERK')
    or not public.current_user_has_business_permission('stock.procurement.edit')
  then raise exception '无采购核价权限'; end if;
  if p_new_price_cny is null or p_new_price_cny < 0 or p_new_price_cny > 999999999999.99
    or p_new_price_cny <> round(p_new_price_cny, 2)
    or char_length(btrim(coalesce(p_reason, ''))) not between 2 and 500
  then raise exception '请填写有效采购价及2至500字更正原因'; end if;
  select * into allocation from public.supplier_receipt_allocations where id = p_allocation_id;
  if allocation.id is null then raise exception '送货单产品记录不存在'; end if;
  select s.* into stock from public.stock_orders s
    join public.stock_order_items i on i.stock_order_id = s.id
    where i.id = allocation.stock_order_item_id and s.id = p_stock_order_id for update of s;
  if stock.id is null or stock.archived_at is not null or stock.status in ('DRAFT', 'CANCELLED')
    or (not public.current_user_has_business_permission('stock.data_all') and stock.sales_user_id is distinct from actor.id)
  then raise exception '备货单不存在或当前状态不可核价'; end if;
  select * into line from public.stock_order_items where id = allocation.stock_order_item_id for update;
  select * into allocation from public.supplier_receipt_allocations where id = p_allocation_id for update;
  if allocation.correction_of is not null
    or exists (select 1 from public.supplier_receipt_allocations r where r.correction_of = allocation.id)
  then raise exception '此回货记录已有冲正，请由财务核对后处理'; end if;
  select * into note from public.supplier_delivery_notes where id = allocation.delivery_note_id for update;
  if exists (select 1 from public.supplier_payments where delivery_note_id = note.id)
  then raise exception '此送货单已有付款，不能直接修改采购价；请由财务处理差额'; end if;
  if allocation.purchase_unit_price_cny is distinct from p_expected_price_cny
  then raise exception '送货单采购价已变化，请刷新后重试'; end if;
  if allocation.purchase_unit_price_cny = p_new_price_cny
  then raise exception '采购价没有变化'; end if;
  if coalesce(allocation.cash_paid_reported_cny, 0) > allocation.quantity * p_new_price_cny
  then raise exception '更正后金额低于仓库登记的现场已付现金，请先由财务核对'; end if;
  update public.supplier_receipt_allocations set purchase_unit_price_cny = p_new_price_cny
    where id = allocation.id;
  -- The stock-line price is a default for future receipts. Keep it aligned
  -- only if it still equals the corrected price; other receipts may differ.
  if line.procurement_cost = allocation.purchase_unit_price_cny then
    perform set_config('app.stock_procurement_price_apply', '1', true);
    update public.stock_order_items set procurement_cost = p_new_price_cny,
      procurement_cost_confirmed = true where id = line.id;
    perform set_config('app.stock_procurement_price_apply', '0', true);
  end if;
  update public.supplier_delivery_notes set updated_at = now() where id = note.id;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values (actor.id, 'SUPPLIER_RECEIPT_PRICE_CORRECTED', 'supplier_delivery_note', note.id,
    jsonb_build_object('allocation_id', allocation.id, 'stock_order_item_id', line.id,
      'quantity', allocation.quantity, 'before_cny', allocation.purchase_unit_price_cny,
      'after_cny', p_new_price_cny, 'amount_delta_cny', allocation.quantity * (p_new_price_cny - allocation.purchase_unit_price_cny),
      'reason', btrim(p_reason)));
end;
$$;
revoke all on function public.correct_supplier_receipt_purchase_price(uuid, uuid, numeric, numeric, text)
  from public, anon;
grant execute on function public.correct_supplier_receipt_purchase_price(uuid, uuid, numeric, numeric, text)
  to authenticated;

commit;
