-- Compatibility foundation for supplier master and document-to-PI receipts.
-- The strict received-quantity trigger is intentionally deferred to the
-- separately verified cutover migration after the new warehouse UI is ready.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create sequence public.supplier_cash_code_seq;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  system_code text not null unique
    check (system_code ~ '^[A-Z0-9][A-Z0-9_-]{0,39}$'),
  legacy_code text,
  short_name text,
  english_short_name text,
  main_products text,
  settlement_cycle text not null
    check (settlement_cycle in ('CASH','WEEKLY','SEMI_MONTHLY','MONTHLY','NET_DAYS','OTHER','UNSET')),
  settlement_days integer check (settlement_days between 1 and 365),
  settlement_terms_original text,
  cooperation_note text,
  after_sales_note text,
  price_advantage_note text,
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_active_profile_check check (
    not is_active or (nullif(btrim(coalesce(main_products,'')), '') is not null
      and settlement_cycle <> 'UNSET')
  ),
  constraint supplier_net_days_check check (
    (settlement_cycle = 'NET_DAYS' and settlement_days is not null)
    or (settlement_cycle <> 'NET_DAYS' and settlement_days is null)
  )
);
create unique index suppliers_legacy_code_unique
  on public.suppliers(upper(btrim(legacy_code))) where nullif(btrim(legacy_code),'') is not null;
create index suppliers_active_code_idx on public.suppliers(is_active, system_code);

create function public.next_supplier_cash_code()
returns text language plpgsql security definer set search_path = '' as $$
declare
  candidate text;
begin
  loop
    candidate := 'CASH-' || lpad(nextval('public.supplier_cash_code_seq')::text, 6, '0');
    exit when not exists (select 1 from public.suppliers where system_code = candidate);
  end loop;
  return candidate;
end;
$$;
revoke all on function public.next_supplier_cash_code() from public, anon, authenticated;
grant execute on function public.next_supplier_cash_code() to service_role;

create table public.supplier_delivery_notes (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  note_number text not null check (char_length(btrim(note_number)) between 1 and 100),
  document_date date not null,
  paper_total_cny numeric(18,2) check (paper_total_cny >= 0),
  warehouse_note text check (char_length(warehouse_note) <= 1000),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index supplier_delivery_notes_number_unique
  on public.supplier_delivery_notes(supplier_id, upper(btrim(note_number)));
create index supplier_delivery_notes_date_idx
  on public.supplier_delivery_notes(document_date, supplier_id);

-- The parent supplier row is held by FOR SHARE during receipt creation.
-- A PI stock line can also carry a planned supplier code before the first
-- receipt. Neither association may be silently orphaned by a code change.
create function public.prevent_linked_supplier_identity_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.system_code is distinct from old.system_code
    or new.legacy_code is distinct from old.legacy_code
    or new.settlement_cycle is distinct from old.settlement_cycle)
    and (exists (select 1 from public.supplier_delivery_notes d
      where d.supplier_id = old.id)
      or exists (select 1 from public.stock_order_items i
        where upper(btrim(coalesce(i.warehouse_supplier_code,''))) = old.system_code)) then
    raise exception '已有 PI 备货行或送货单关联的供应商代码和结算类型不可修改，请停用后新建档案';
  end if;
  return new;
end;
$$;
create trigger supplier_identity_locked_after_receipt
before update of system_code, legacy_code, settlement_cycle on public.suppliers
for each row execute function public.prevent_linked_supplier_identity_change();
revoke all on function public.prevent_linked_supplier_identity_change()
  from public, anon, authenticated;

create table public.supplier_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  stock_order_item_id uuid not null references public.stock_order_items(id) on delete restrict,
  product_snapshot jsonb not null check (jsonb_typeof(product_snapshot) = 'object'),
  quantity integer not null check (quantity <> 0),
  purchase_unit_price_cny numeric(14,2) not null check (purchase_unit_price_cny >= 0),
  amount_cny numeric(18,2) generated always as (quantity * purchase_unit_price_cny) stored,
  cash_paid_reported_cny numeric(18,2) check (cash_paid_reported_cny >= 0),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default now(),
  transaction_id bigint not null default txid_current(),
  correction_of uuid references public.supplier_receipt_allocations(id) on delete restrict,
  correction_reason text,
  constraint supplier_receipt_correction_check check (
    (correction_of is null and quantity > 0 and correction_reason is null)
    or (correction_of is not null and quantity < 0
      and nullif(btrim(correction_reason),'') is not null)
  )
);
create index supplier_receipts_note_idx on public.supplier_receipt_allocations(delivery_note_id);
create index supplier_receipts_stock_item_idx on public.supplier_receipt_allocations(stock_order_item_id, recorded_at);

-- Existing physical receipts predate the supplier ledger. Preserve their exact
-- starting quantity without rewriting existing stock-order item rows or
-- inventing historical delivery-note allocations.
create table public.supplier_receipt_legacy_baselines (
  stock_order_item_id uuid primary key references public.stock_order_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  captured_at timestamptz not null default now()
);

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.supplier_delivery_notes(id) on delete restrict,
  amount_cny numeric(18,2) not null check (amount_cny > 0),
  paid_on date not null,
  payment_method text not null check (payment_method in ('CASH','BANK','ALIPAY','WECHAT','OTHER')),
  payment_reference text not null check (char_length(btrim(payment_reference)) between 1 and 200),
  recorded_by uuid not null references public.users(id),
  recorded_at timestamptz not null default now()
);
create index supplier_payments_note_idx on public.supplier_payments(delivery_note_id);
create unique index supplier_payments_reference_unique
  on public.supplier_payments(delivery_note_id, payment_method, upper(btrim(payment_reference)));
create index supplier_payments_reference_lookup_idx
  on public.supplier_payments(payment_method, upper(btrim(payment_reference)));

-- A direct call to the older stock-progress RPC must never change physical
-- receipt quantity without matching immutable ledger entries. The all-time
-- balance also supports multiple receipts or reversals within one transaction.
create function public.require_supplier_receipt_context()
returns trigger language plpgsql set search_path = '' as $$
declare
  allocated_total bigint;
  legacy_total integer;
begin
  if new.received_quantity is distinct from old.received_quantity then
    select coalesce(b.quantity, 0) into legacy_total
      from public.supplier_receipt_legacy_baselines b
      where b.stock_order_item_id = old.id;
    legacy_total := coalesce(legacy_total, 0);
    select coalesce(sum(a.quantity), 0) into allocated_total
      from public.supplier_receipt_allocations a
      where a.stock_order_item_id = old.id;
    if new.received_quantity <> legacy_total + allocated_total then
      raise exception '回货数量须等于历史基线加供应商送货单分配净数量';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.require_supplier_receipt_context() from public, anon, authenticated;

-- One parent stock-order lock serializes receipt, shipment and PI amendment.
-- The existing progress RPC remains the authority for physical-status changes;
-- the new allocation and that status update commit or roll back together.
create function public.record_supplier_receipt(
  p_stock_order_id uuid,
  p_stock_order_item_id uuid,
  p_supplier_id uuid,
  p_note_number text,
  p_document_date date,
  p_quantity integer,
  p_purchase_unit_price_cny numeric,
  p_expected_updated_at timestamptz,
  p_note text default null,
  p_cash_paid_reported_cny numeric default null
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  target public.stock_orders;
  item public.stock_order_items;
  supplier public.suppliers;
  delivery public.supplier_delivery_notes;
  updated public.stock_orders;
  normalized_number text;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit') then
    raise exception '无仓库回货或采购核价权限';
  end if;
  if p_quantity is null or p_quantity <= 0
    or p_purchase_unit_price_cny is null or p_purchase_unit_price_cny < 0
    or p_purchase_unit_price_cny > 999999999999.99
    or p_purchase_unit_price_cny <> round(p_purchase_unit_price_cny, 2)
    or p_document_date is null or p_document_date > current_date
    or nullif(btrim(coalesce(p_note_number,'')), '') is null
    or char_length(btrim(p_note_number)) > 100
    or (p_cash_paid_reported_cny is not null and
      (p_cash_paid_reported_cny < 0 or p_cash_paid_reported_cny <> round(p_cash_paid_reported_cny, 2)
        or p_cash_paid_reported_cny > p_quantity * p_purchase_unit_price_cny))
    or char_length(coalesce(p_note,'')) > 1000 then
    raise exception '请填写有效的本次回货数量、采购单价、送货日期和送货单号';
  end if;
  normalized_number := btrim(p_note_number);
  select * into target from public.stock_orders where id = p_stock_order_id for update;
  if target.id is null or target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已变更，请刷新核对后重试';
  end if;
  select * into item from public.stock_order_items
    where id = p_stock_order_item_id and stock_order_id = target.id for update;
  if item.id is null or item.shipped_quantity > 0 or item.received_quantity + p_quantity > item.quantity then
    raise exception '产品行不存在、已交货代或本次回货数超过未回货数';
  end if;
  select * into supplier from public.suppliers where id = p_supplier_id and is_active for share;
  if supplier.id is null then raise exception '请选择有效供应商档案代码'; end if;
  if supplier.settlement_cycle <> 'CASH' and p_cash_paid_reported_cny is not null then
    raise exception '只有现金结供应商可以登记现场实付金额';
  end if;

  insert into public.supplier_delivery_notes(supplier_id, note_number, document_date,
    warehouse_note, created_by)
  values(supplier.id, normalized_number, p_document_date,
    nullif(btrim(coalesce(p_note,'')), ''), actor.id)
  on conflict do nothing;
  select * into delivery from public.supplier_delivery_notes
    where supplier_id = supplier.id and upper(btrim(note_number)) = upper(normalized_number)
    for update;
  if delivery.document_date is distinct from p_document_date then
    raise exception '此供应商送货单号已存在但日期不同，请核对纸单';
  end if;

  update public.stock_order_items set procurement_cost = p_purchase_unit_price_cny,
    procurement_cost_confirmed = true where id = item.id;
  insert into public.supplier_receipt_allocations(delivery_note_id, stock_order_item_id,
    product_snapshot, quantity, purchase_unit_price_cny, cash_paid_reported_cny, recorded_by)
  values(delivery.id, item.id, jsonb_build_object(
      'line_number',item.line_number,'product_type',coalesce(item.product_type_snapshot,item.item_name),
      'item_name',item.item_name,
      'brand',item.brand,'model',item.model,'quality',item.quality,
      'description',item.description,'description_zh',item.description_zh),
    p_quantity, p_purchase_unit_price_cny,
    p_cash_paid_reported_cny, actor.id);
  updated := public.record_stock_progress(target.id, 'RECEIVE',
    jsonb_build_array(jsonb_build_object('item_id', item.id,
      'quantity', item.received_quantity + p_quantity,
      'supplier_code', supplier.system_code)), p_expected_updated_at, p_note);
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values(actor.id, 'SUPPLIER_RECEIPT_RECORDED', 'stock_order', target.id,
    jsonb_build_object('supplier_id', supplier.id, 'delivery_note_id', delivery.id,
      'item_id', item.id, 'quantity', p_quantity, 'unit_price_cny', p_purchase_unit_price_cny,
      'cash_paid_reported_cny', p_cash_paid_reported_cny));
  return updated;
end;
$$;
revoke all on function public.record_supplier_receipt(uuid,uuid,uuid,text,date,integer,numeric,timestamptz,text,numeric)
  from public, anon;
grant execute on function public.record_supplier_receipt(uuid,uuid,uuid,text,date,integer,numeric,timestamptz,text,numeric)
  to authenticated;

-- Reverse a mistaken receipt without erasing its delivery-note allocation.
-- The reversal and physical stock correction are one transaction: either both
-- are visible or neither is. Prepared or shipped stock cannot be reversed.
create function public.reverse_supplier_receipt(
  p_stock_order_id uuid, p_allocation_id uuid, p_quantity integer,
  p_expected_updated_at timestamptz, p_reason text
) returns public.stock_orders
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  allocation public.supplier_receipt_allocations;
  target public.stock_orders;
  item public.stock_order_items;
  already_reversed integer;
  next_received integer;
  due_amount numeric;
  paid_amount numeric;
  result public.stock_orders;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or actor.role not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.update')
    or not public.current_user_has_business_permission('stock.procurement.edit') then
    raise exception '无仓库回货冲正权限';
  end if;
  if p_quantity is null or p_quantity <= 0
    or nullif(btrim(coalesce(p_reason,'')), '') is null
    or char_length(btrim(p_reason)) > 1000 then
    raise exception '请填写有效的冲正数量和原因（最多1000字）';
  end if;
  -- Lock the parent before allocation and item, matching receipt creation.
  select s.* into target from public.stock_orders s
    join public.stock_order_items i on i.stock_order_id = s.id
    join public.supplier_receipt_allocations a on a.stock_order_item_id = i.id
    where a.id = p_allocation_id for update of s;
  if target.id is null or target.id is distinct from p_stock_order_id
    or target.updated_at is distinct from p_expected_updated_at then
    raise exception '备货单已变更，请刷新核对后重试';
  end if;
  select * into allocation from public.supplier_receipt_allocations
    where id = p_allocation_id for update;
  if allocation.correction_of is not null then raise exception '只能冲正原始回货记录'; end if;
  select * into item from public.stock_order_items
    where id = allocation.stock_order_item_id and stock_order_id = target.id for update;
  select coalesce(-sum(quantity),0) into already_reversed
    from public.supplier_receipt_allocations where correction_of = allocation.id;
  if p_quantity > allocation.quantity - already_reversed then
    raise exception '冲正数量超过此笔回货尚未冲正的数量';
  end if;
  next_received := item.received_quantity - p_quantity;
  if next_received < item.prepared_quantity or next_received < item.shipped_quantity then
    raise exception '已理货或已交货代数量不可冲正，请先核对实物进度';
  end if;
  -- Payment registration locks this same note. Keep the payable balance valid
  -- even when a warehouse reversal races with a finance payment.
  perform 1 from public.supplier_delivery_notes
    where id=allocation.delivery_note_id for update;
  select coalesce(sum(amount_cny),0) into due_amount
    from public.supplier_receipt_allocations
    where delivery_note_id=allocation.delivery_note_id;
  select coalesce(sum(amount_cny),0) into paid_amount
    from public.supplier_payments
    where delivery_note_id=allocation.delivery_note_id;
  if due_amount - p_quantity * allocation.purchase_unit_price_cny < paid_amount then
    raise exception '冲正后将出现送货单超付，请先由财务核对付款调整';
  end if;
  insert into public.supplier_receipt_allocations(delivery_note_id,stock_order_item_id,
    product_snapshot,quantity,purchase_unit_price_cny,recorded_by,correction_of,correction_reason)
  values(allocation.delivery_note_id,item.id,allocation.product_snapshot,-p_quantity,
    allocation.purchase_unit_price_cny,actor.id,allocation.id,btrim(p_reason));
  result := public.correct_stock_item_progress(target.id,
    jsonb_build_array(jsonb_build_object('item_id',item.id,
      'received_quantity',next_received,'prepared_quantity',item.prepared_quantity,
      'supplier_code',coalesce(item.warehouse_supplier_code,''))),
    p_expected_updated_at,p_reason);
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_RECEIPT_REVERSED','stock_order',target.id,
    jsonb_build_object('allocation_id',allocation.id,'item_id',item.id,
      'quantity',p_quantity,'reason',btrim(p_reason)));
  return result;
end;
$$;
revoke all on function public.reverse_supplier_receipt(uuid,uuid,integer,timestamptz,text)
  from public,anon;
grant execute on function public.reverse_supplier_receipt(uuid,uuid,integer,timestamptz,text)
  to authenticated;

create function public.record_supplier_payment(
  p_delivery_note_id uuid, p_amount_cny numeric, p_paid_on date,
  p_payment_method text, p_payment_reference text
) returns public.supplier_payments
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  delivery public.supplier_delivery_notes;
  due_amount numeric;
  paid_amount numeric;
  result public.supplier_payments;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商付款登记权限';
  end if;
  if p_amount_cny is null or p_amount_cny <= 0 or p_amount_cny <> round(p_amount_cny, 2)
    or p_paid_on is null or p_paid_on > current_date
    or p_payment_method not in ('CASH','BANK','ALIPAY','WECHAT','OTHER')
    or nullif(btrim(coalesce(p_payment_reference,'')), '') is null
    or char_length(btrim(p_payment_reference)) > 200 then
    raise exception '请填写有效的付款金额、日期、方式和不可重复使用的付款凭证号';
  end if;
  select * into delivery from public.supplier_delivery_notes
    where id = p_delivery_note_id for update;
  if delivery.id is null then raise exception '送货单不存在'; end if;
  -- One bank voucher can settle several notes for the same supplier. Serialize
  -- the voucher across notes so concurrent calls cannot assign it to two
  -- suppliers before either transaction commits.
  perform pg_advisory_xact_lock(hashtextextended(
    p_payment_method || ':' || upper(btrim(p_payment_reference)), 0));
  if exists(select 1 from public.supplier_payments p
    join public.supplier_delivery_notes n on n.id = p.delivery_note_id
    where p.payment_method = p_payment_method
      and upper(btrim(p.payment_reference)) = upper(btrim(p_payment_reference))
      and n.supplier_id is distinct from delivery.supplier_id) then
    raise exception '此付款凭证号已用于另一供应商，请核对凭证';
  end if;
  if exists(select 1 from public.supplier_payments
    where delivery_note_id = delivery.id and payment_method = p_payment_method
      and upper(btrim(payment_reference)) = upper(btrim(p_payment_reference))) then
    raise exception '此送货单已登记该付款凭证号，请核对是否重复付款';
  end if;
  select coalesce(sum(amount_cny),0) into due_amount from public.supplier_receipt_allocations
    where delivery_note_id = delivery.id;
  select coalesce(sum(amount_cny),0) into paid_amount from public.supplier_payments
    where delivery_note_id = delivery.id;
  if paid_amount + p_amount_cny > due_amount then
    raise exception '本次付款超过此送货单已分配的未付金额，请先核对送货单或选择正确的单据';
  end if;
  insert into public.supplier_payments(delivery_note_id,amount_cny,paid_on,payment_method,
    payment_reference,recorded_by)
  values(delivery.id,p_amount_cny,p_paid_on,p_payment_method,btrim(p_payment_reference),actor.id)
  returning * into result;
  insert into public.audit_logs(user_id, action, target_type, target_id, content)
  values(actor.id,'SUPPLIER_PAYMENT_RECORDED','supplier_delivery_note',delivery.id,
    jsonb_build_object('payment_id',result.id,'amount_cny',result.amount_cny,
      'payment_method',result.payment_method,'payment_reference',result.payment_reference));
  return result;
end;
$$;
revoke all on function public.record_supplier_payment(uuid,numeric,date,text,text) from public,anon;
grant execute on function public.record_supplier_payment(uuid,numeric,date,text,text) to authenticated;

create function public.confirm_supplier_note_paper_total(
  p_delivery_note_id uuid, p_paper_total_cny numeric,
  p_expected_updated_at timestamptz, p_reason text
) returns public.supplier_delivery_notes
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  delivery public.supplier_delivery_notes;
  result public.supplier_delivery_notes;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('supplier.reconciliation.manage') then
    raise exception '无供应商送货单金额核对权限';
  end if;
  if p_paper_total_cny is null or p_paper_total_cny < 0
    or p_paper_total_cny > 9999999999999999.99
    or p_paper_total_cny <> round(p_paper_total_cny,2)
    or nullif(btrim(coalesce(p_reason,'')), '') is null
    or char_length(btrim(p_reason)) > 500 then
    raise exception '请填写有效纸单金额和核对说明（最多500字）';
  end if;
  select * into delivery from public.supplier_delivery_notes
    where id = p_delivery_note_id for update;
  if delivery.id is null or delivery.updated_at is distinct from p_expected_updated_at then
    raise exception '送货单已变更，请刷新核对后重试';
  end if;
  if delivery.paper_total_cny is not distinct from p_paper_total_cny then
    raise exception '纸单金额未变化';
  end if;
  update public.supplier_delivery_notes set paper_total_cny=p_paper_total_cny,
    updated_at=clock_timestamp() where id=delivery.id returning * into result;
  insert into public.audit_logs(user_id,action,target_type,target_id,content)
  values(actor.id,'SUPPLIER_PAPER_TOTAL_CONFIRMED','supplier_delivery_note',delivery.id,
    jsonb_build_object('before_cny',delivery.paper_total_cny,
      'after_cny',p_paper_total_cny,'reason',btrim(p_reason)));
  return result;
end;
$$;
revoke all on function public.confirm_supplier_note_paper_total(uuid,numeric,timestamptz,text)
  from public,anon;
grant execute on function public.confirm_supplier_note_paper_total(uuid,numeric,timestamptz,text)
  to authenticated;

create function public.supplier_reconciliation_report(
  p_date_from date, p_date_to date, p_supplier_id uuid default null,
  p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor public.users;
  result jsonb;
begin
  select * into actor from public.users where id = auth.uid() and status = 'ACTIVE';
  if actor.id is null or not public.current_user_has_business_permission('supplier.reconciliation.view') then
    raise exception '无供应商对账权限';
  end if;
  if p_date_from is null or p_date_to is null or p_date_from > p_date_to
    or p_limit < 1 or p_limit > 100 or p_offset < 0 then
    raise exception '查询日期或分页参数不正确';
  end if;
  with filtered_notes as (
    select d.*, s.system_code, s.short_name, s.english_short_name,
      s.settlement_cycle, s.settlement_days from public.supplier_delivery_notes d
      join public.suppliers s on s.id = d.supplier_id
      where d.document_date between p_date_from and p_date_to
        and (p_supplier_id is null or d.supplier_id = p_supplier_id)
  ),
  allocated as (
    select a.delivery_note_id, coalesce(sum(a.amount_cny),0) as amount_cny,
      coalesce(sum(a.quantity),0) as quantity,
      coalesce(sum(a.cash_paid_reported_cny),0) as cash_paid_reported_cny
    from public.supplier_receipt_allocations a join filtered_notes n on n.id=a.delivery_note_id
    group by a.delivery_note_id
  ),
  paid as (
    select p.delivery_note_id, coalesce(sum(p.amount_cny),0) as amount_cny
    from public.supplier_payments p join filtered_notes n on n.id=p.delivery_note_id
    group by p.delivery_note_id
  ),
  report_notes as (
    select n.*, coalesce(a.amount_cny,0) as allocated_cny,
      coalesce(a.quantity,0) as allocated_quantity,
      coalesce(a.cash_paid_reported_cny,0) as cash_paid_reported_cny,
      coalesce(p.amount_cny,0) as paid_cny
    from filtered_notes n left join allocated a on a.delivery_note_id=n.id
      left join paid p on p.delivery_note_id=n.id
  )
  select jsonb_build_object(
    'summary', (select jsonb_build_object('note_count',count(*),
      'supplier_count',count(distinct supplier_id),
      'quantity',coalesce(sum(allocated_quantity),0),
      'allocated_cny',coalesce(sum(allocated_cny),0),
      'cash_paid_reported_cny',coalesce(sum(cash_paid_reported_cny),0),
      'paid_cny',coalesce(sum(paid_cny),0),
      'unpaid_cny',coalesce(sum(allocated_cny-paid_cny),0)) from report_notes),
    'legacy_unlinked',(select jsonb_build_object('line_count',count(*),
      'quantity',coalesce(sum(b.quantity),0))
      from public.supplier_receipt_legacy_baselines b),
    'supplier_summary',coalesce((select jsonb_agg(to_jsonb(x) order by x.system_code)
      from (select supplier_id,system_code,
        coalesce(short_name,english_short_name) as supplier_name,
        settlement_cycle,settlement_days,count(*) as note_count,
        coalesce(sum(allocated_quantity),0) as quantity,
        coalesce(sum(allocated_cny),0) as allocated_cny,
        coalesce(sum(paid_cny),0) as paid_cny,
        coalesce(sum(allocated_cny-paid_cny),0) as unpaid_cny
      from report_notes
      group by supplier_id,system_code,short_name,english_short_name,settlement_cycle,settlement_days) x),'[]'::jsonb),
    'monthly_summary',coalesce((select jsonb_agg(to_jsonb(x) order by x.month,x.system_code)
      from (select date_trunc('month',document_date::timestamp)::date as month,
        supplier_id,system_code,coalesce(sum(allocated_cny),0) as allocated_cny,
        coalesce(sum(paid_cny),0) as paid_cny,
        coalesce(sum(allocated_cny-paid_cny),0) as unpaid_cny
      from report_notes
      group by date_trunc('month',document_date::timestamp)::date,supplier_id,system_code) x),'[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'supplier_id',n.supplier_id,'supplier_code',n.system_code,
      'supplier_name',coalesce(n.short_name,n.english_short_name),
      'settlement_cycle',n.settlement_cycle,'settlement_days',n.settlement_days,
      'note_number',n.note_number,
      'document_date',n.document_date,'paper_total_cny',n.paper_total_cny,
      'updated_at',n.updated_at,
      'allocated_quantity',n.allocated_quantity,'allocated_cny',n.allocated_cny,
      'cash_paid_reported_cny',n.cash_paid_reported_cny,
      'paid_cny',n.paid_cny,'unpaid_cny',n.allocated_cny-n.paid_cny,
      'allocations',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'pi_number',coalesce(nullif(btrim(so.warehouse_reference_number),''),so.order_number),
        'system_pi_number',so.order_number,'pi_id',so.id,
        'product',concat_ws(' · ',nullif(a.product_snapshot->>'product_type',''),
          nullif(a.product_snapshot->>'brand',''),
          nullif(a.product_snapshot->>'model',''),
          nullif(a.product_snapshot->>'quality','')),
        'product_snapshot',a.product_snapshot,
        'stock_order_item_id',i.id,'quantity',a.quantity,
        'unit_price_cny',a.purchase_unit_price_cny,'amount_cny',a.amount_cny,
        'cash_paid_reported_cny',a.cash_paid_reported_cny,
        'correction_of',a.correction_of,'correction_reason',a.correction_reason,
        'recorded_at',a.recorded_at)
        order by a.recorded_at,a.id)
        from public.supplier_receipt_allocations a
        join public.stock_order_items i on i.id=a.stock_order_item_id
        join public.stock_orders st on st.id=i.stock_order_id
        join public.sales_orders so on so.id=st.sales_order_id
        where a.delivery_note_id=n.id),'[]'::jsonb),
      'payments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p.id,'amount_cny',p.amount_cny,'paid_on',p.paid_on,
        'method',p.payment_method,'reference',p.payment_reference)
        order by p.paid_on,p.id) from public.supplier_payments p
        where p.delivery_note_id=n.id),'[]'::jsonb)) order by n.document_date desc,n.id desc)
      from (select * from report_notes order by document_date desc,id desc
        limit p_limit offset p_offset) n),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.supplier_reconciliation_report(date,date,uuid,integer,integer)
  from public,anon;
grant execute on function public.supplier_reconciliation_report(date,date,uuid,integer,integer)
  to authenticated;

alter table public.suppliers enable row level security;
alter table public.supplier_delivery_notes enable row level security;
alter table public.supplier_receipt_allocations enable row level security;
alter table public.supplier_receipt_legacy_baselines enable row level security;
alter table public.supplier_payments enable row level security;
revoke all on public.suppliers, public.supplier_delivery_notes,
  public.supplier_receipt_allocations, public.supplier_receipt_legacy_baselines,
  public.supplier_payments
  from public, anon, authenticated;
-- Supabase no longer exposes new public tables automatically. Only the
-- server-side service role may use PostgREST for supplier management and
-- procurement snapshots; browser roles use checked RPCs instead.
grant select, insert, update on public.suppliers to service_role;
grant select on public.supplier_delivery_notes,
  public.supplier_receipt_allocations, public.supplier_receipt_legacy_baselines,
  public.supplier_payments to service_role;

insert into public.role_permission_settings(role_code, permission_code, enabled)
values ('WAREHOUSE', 'suppliers.view', true),
  ('WAREHOUSE', 'suppliers.manage', true)
on conflict (role_code, permission_code) do nothing;

-- Capture the historical baseline without activating enforcement yet. The
-- preview can use document-backed receipts while the currently deployed
-- warehouse page remains operational during the compatibility window.
-- A later cutover migration refreshes this baseline and enables the guard.
lock table public.stock_order_items in share row exclusive mode;
insert into public.supplier_receipt_legacy_baselines(stock_order_item_id, quantity)
select id, received_quantity from public.stock_order_items where received_quantity > 0;

commit;
