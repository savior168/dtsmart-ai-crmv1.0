-- Run only on the isolated local fixture database.
set test.actor_id = '11111111-1111-4111-8111-111111111111';
insert into public.users(id, role, status)
values ('11111111-1111-4111-8111-111111111111', 'WAREHOUSE', 'ACTIVE');
insert into public.suppliers(id, system_code, short_name, main_products, settlement_cycle)
values ('22222222-2222-4222-8222-222222222222', public.next_supplier_cash_code(), 'Test cash supplier', 'LCD', 'CASH');
insert into public.suppliers(id, system_code, legacy_code, short_name, main_products, settlement_cycle)
values ('22222222-2222-4222-8222-222222222225', '1006', '1006', 'Coded cash supplier', 'LCD', 'CASH');
insert into public.suppliers(id, system_code, main_products, settlement_cycle, settlement_days)
values ('22222222-2222-4222-8222-222222222224', 'TEST-NAMELESS', 'Battery', 'NET_DAYS', 15);
insert into public.sales_orders(id, order_number, warehouse_reference_number) values
('33333333-3333-4333-8333-333333333331', 'PI-TEST-1', 'D-TEST-1'),
('33333333-3333-4333-8333-333333333332', 'PI-TEST-2', null);
insert into public.stock_orders(id, sales_order_id) values
('44444444-4444-4444-8444-444444444441', '33333333-3333-4333-8333-333333333331'),
('44444444-4444-4444-8444-444444444442', '33333333-3333-4333-8333-333333333332');
insert into public.stock_order_items(id, stock_order_id, line_number, item_name, quantity) values
('55555555-5555-4555-8555-555555555551', '44444444-4444-4444-8444-444444444441', 1, 'Test product A', 10),
('55555555-5555-4555-8555-555555555552', '44444444-4444-4444-8444-444444444442', 1, 'Test product B', 10);

do $$
declare
  first_version timestamptz;
  second_version timestamptz;
  report jsonb;
  code text;
begin
  if not has_table_privilege('service_role','public.suppliers','SELECT')
    or not has_table_privilege('service_role','public.suppliers','INSERT')
    or not has_table_privilege('service_role','public.supplier_receipt_allocations','SELECT')
    or has_table_privilege('authenticated','public.supplier_receipt_allocations','SELECT')
    or has_table_privilege('authenticated','public.supplier_receipt_allocations','INSERT')
    or has_table_privilege('authenticated','public.supplier_receipt_allocations','UPDATE')
    or has_table_privilege('authenticated','public.supplier_receipt_allocations','DELETE')
    or has_table_privilege('anon','public.suppliers','SELECT') then
    raise exception 'supplier ledger Data API privileges are unsafe or incomplete';
  end if;
  if (select quantity from public.supplier_receipt_legacy_baselines
      where stock_order_item_id='66666666-6666-4666-8666-666666666663') <> 2 then
    raise exception 'legacy physical receipt baseline not preserved';
  end if;
  select system_code into code from public.suppliers where id='22222222-2222-4222-8222-222222222222';
  if code !~ '^CASH-[0-9]{6,}$' then raise exception 'invalid cash code: %', code; end if;
  if (select system_code from public.suppliers
      where id='22222222-2222-4222-8222-222222222225') <> '1006' then
    raise exception 'existing cash supplier code was replaced';
  end if;
  update public.stock_order_items set warehouse_supplier_code='TEST-NAMELESS'
    where id='55555555-5555-4555-8555-555555555552';
  begin
    update public.suppliers set system_code='TEST-CHANGED'
      where id='22222222-2222-4222-8222-222222222224';
    raise exception 'planned PI supplier code was changed';
  exception when others then
    if sqlerrm = 'planned PI supplier code was changed' then raise; end if;
  end;
  if (select system_code from public.suppliers
      where id='22222222-2222-4222-8222-222222222224') <> 'TEST-NAMELESS' then
    raise exception 'planned PI supplier identity was not preserved';
  end if;
  select updated_at into first_version from public.stock_orders where id='44444444-4444-4444-8444-444444444441';
  perform public.record_supplier_receipt(
    '44444444-4444-4444-8444-444444444441', '55555555-5555-4555-8555-555555555551',
    '22222222-2222-4222-8222-222222222222', 'CASH-PAPER-001', current_date,
    4, 12.50, first_version, 'first PI allocation', 20.00);
  select updated_at into second_version from public.stock_orders where id='44444444-4444-4444-8444-444444444442';
  perform public.record_supplier_receipt(
    '44444444-4444-4444-8444-444444444442', '55555555-5555-4555-8555-555555555552',
    '22222222-2222-4222-8222-222222222222', 'CASH-PAPER-001', current_date,
    2, 15.00, second_version, 'second PI allocation');
  if (select count(*) from public.supplier_delivery_notes) <> 1
    or (select count(*) from public.supplier_receipt_allocations) <> 2
    or (select sum(amount_cny) from public.supplier_receipt_allocations) <> 80.00 then
    raise exception 'multi-PI delivery note allocation mismatch';
  end if;
  begin
    update public.suppliers set system_code='CASH-999999'
      where id='22222222-2222-4222-8222-222222222222';
    raise exception 'linked supplier code was changed';
  exception when others then
    if sqlerrm = 'linked supplier code was changed' then raise; end if;
  end;
  if (select system_code from public.suppliers
      where id='22222222-2222-4222-8222-222222222222') <> code then
    raise exception 'linked supplier identity was not preserved';
  end if;
  begin
    update public.suppliers set legacy_code='OLD-CHANGED'
      where id='22222222-2222-4222-8222-222222222222';
    raise exception 'linked historical supplier code was changed';
  exception when others then
    if sqlerrm = 'linked historical supplier code was changed' then raise; end if;
  end;
  if exists (select 1 from public.suppliers
      where id='22222222-2222-4222-8222-222222222222' and legacy_code is not null) then
    raise exception 'linked historical supplier code was not preserved';
  end if;
  report := public.supplier_reconciliation_report(current_date, current_date, null, 50, 0);
  if (report #>> '{summary,allocated_cny}')::numeric <> 80.00
    or (report #>> '{summary,cash_paid_reported_cny}')::numeric <> 20.00
    or (report #>> '{supplier_summary,0,allocated_cny}')::numeric <> 80.00
    or (report #>> '{monthly_summary,0,allocated_cny}')::numeric <> 80.00
    or (report #>> '{legacy_unlinked,line_count}')::integer <> 1
    or (report #>> '{legacy_unlinked,quantity}')::integer <> 2
    or jsonb_array_length(report->'notes'->0->'allocations') <> 2 then
    raise exception 'reconciliation report mismatch: %', report;
  end if;
  perform public.confirm_supplier_note_paper_total(
    (select id from public.supplier_delivery_notes limit 1), 81.00,
    (select updated_at from public.supplier_delivery_notes limit 1),
    'paper invoice checked');
  report := public.supplier_reconciliation_report(current_date, current_date, null, 50, 0);
  if (report #>> '{notes,0,paper_total_cny}')::numeric <> 81.00
    or nullif(report #>> '{notes,0,updated_at}','') is null then
    raise exception 'paper total/version not present in reconciliation report';
  end if;
  -- This fixture applies only the supplier-ledger migration. The separate PI
  -- amendment migration installs the physical-line identity guard; here we
  -- verify the paper-note snapshot survives even if the live row changes.
  update public.stock_order_items set model='Later replacement model'
    where id='55555555-5555-4555-8555-555555555551';
  report := public.supplier_reconciliation_report(current_date, current_date, null, 50, 0);
  if not exists(select 1 from jsonb_array_elements(report->'notes'->0->'allocations') a
    where a->>'pi_number'='D-TEST-1'
      and a->>'system_pi_number'='PI-TEST-1'
      and a->>'pi_id'='33333333-3333-4333-8333-333333333331'
      and a->>'product'='Test product A'
      and a #>> '{product_snapshot,item_name}'='Test product A'
      and a #>> '{product_snapshot,model}' is null) then
    raise exception 'historical delivery-note product snapshot changed with live stock row';
  end if;
  update public.stock_order_items set model=null
    where id='55555555-5555-4555-8555-555555555551';
  begin
    update public.stock_order_items set received_quantity=5
      where id='55555555-5555-4555-8555-555555555551';
    raise exception 'orphan receipt update was accepted';
  exception when others then
    if sqlerrm = 'orphan receipt update was accepted' then raise; end if;
  end;
  update public.stock_order_items set prepared_quantity=3
    where id='55555555-5555-4555-8555-555555555551';
  begin
    perform public.reverse_supplier_receipt(
      '44444444-4444-4444-8444-444444444441',
      (select id from public.supplier_receipt_allocations where quantity=4),
      2, (select updated_at from public.stock_orders
        where id='44444444-4444-4444-8444-444444444441'), 'test over prepared quantity');
    raise exception 'prepared stock was reversed';
  exception when others then
    if sqlerrm = 'prepared stock was reversed' then raise; end if;
  end;
  if (select count(*) from public.supplier_receipt_allocations) <> 2 then
    raise exception 'failed reversal left ledger residue';
  end if;
  update public.stock_order_items set prepared_quantity=0
    where id='55555555-5555-4555-8555-555555555551';
  perform public.reverse_supplier_receipt(
    '44444444-4444-4444-8444-444444444441',
    (select id from public.supplier_receipt_allocations where quantity=4),
    1, (select updated_at from public.stock_orders
      where id='44444444-4444-4444-8444-444444444441'), 'physical return confirmed');
  if (select received_quantity from public.stock_order_items
      where id='55555555-5555-4555-8555-555555555551') <> 3
    or (select sum(amount_cny) from public.supplier_receipt_allocations) <> 67.50
    or (select count(*) from public.supplier_receipt_allocations where correction_of is not null) <> 1 then
    raise exception 'reversal stock and ledger were not atomic';
  end if;
  report := public.supplier_reconciliation_report(current_date, current_date, null, 50, 0);
  if (report #>> '{summary,allocated_cny}')::numeric <> 67.50
    or not exists(select 1 from jsonb_array_elements(report->'notes'->0->'allocations') a
      where a->>'correction_reason' = 'physical return confirmed'
        and a->>'correction_of' is not null and (a->>'quantity')::integer = -1) then
    raise exception 'reconciliation did not retain reversal reference and reason';
  end if;
  perform public.record_supplier_payment(
    (select id from public.supplier_delivery_notes limit 1), 50.00,
    current_date, 'CASH', 'TEST-CASH-PAY-001');
  begin
    perform public.record_supplier_payment(
      (select id from public.supplier_delivery_notes limit 1), 18.00,
      current_date, 'CASH', 'TEST-CASH-PAY-002');
    raise exception 'overpayment was accepted';
  exception when others then
    if sqlerrm = 'overpayment was accepted' then raise; end if;
  end;
  report := public.supplier_reconciliation_report(current_date, current_date, null, 50, 0);
  if (report #>> '{summary,paid_cny}')::numeric <> 50.00
    or (report #>> '{summary,unpaid_cny}')::numeric <> 17.50
    or (report #>> '{supplier_summary,0,paid_cny}')::numeric <> 50.00
    or (report #>> '{monthly_summary,0,unpaid_cny}')::numeric <> 17.50 then
    raise exception 'payment balance mismatch: %', report;
  end if;
  begin
    perform public.reverse_supplier_receipt(
      '44444444-4444-4444-8444-444444444441',
      (select id from public.supplier_receipt_allocations where quantity=4),
      2, (select updated_at from public.stock_orders
        where id='44444444-4444-4444-8444-444444444441'),
      'would make paid amount exceed remaining payable');
    raise exception 'paid delivery note was reversed into a negative balance';
  exception when others then
    if sqlerrm = 'paid delivery note was reversed into a negative balance' then raise; end if;
  end;
  if (select sum(amount_cny) from public.supplier_receipt_allocations
      where delivery_note_id=(select id from public.supplier_delivery_notes
        where note_number='CASH-PAPER-001')) <> 67.50
    or (select count(*) from public.supplier_receipt_allocations
      where correction_of is not null) <> 1 then
    raise exception 'rejected overpaid reversal changed receipt ledger';
  end if;
  perform public.record_supplier_receipt(
    '66666666-6666-4666-8666-666666666662', '66666666-6666-4666-8666-666666666663',
    '22222222-2222-4222-8222-222222222222', 'LEGACY-LATER-001', current_date,
    1, 9.00, (select updated_at from public.stock_orders
      where id='66666666-6666-4666-8666-666666666662'), 'new documented receipt');
  if (select received_quantity from public.stock_order_items
      where id='66666666-6666-4666-8666-666666666663') <> 3
    or (select count(*) from public.supplier_receipt_allocations
      where stock_order_item_id='66666666-6666-4666-8666-666666666663') <> 1 then
    raise exception 'new receipt did not respect historical baseline';
  end if;
  insert into public.suppliers(id,system_code,short_name,main_products,settlement_cycle)
  values('22222222-2222-4222-8222-222222222223','TEST-1011','Test credit supplier','Battery','MONTHLY');
  perform public.record_supplier_receipt(
    '44444444-4444-4444-8444-444444444441','55555555-5555-4555-8555-555555555551',
    '22222222-2222-4222-8222-222222222223','CREDIT-PAPER-002',current_date,
    2, 11.00, (select updated_at from public.stock_orders
      where id='44444444-4444-4444-8444-444444444441'), 'second supplier for same PI line');
  perform public.record_supplier_receipt(
    '44444444-4444-4444-8444-444444444441','55555555-5555-4555-8555-555555555551',
    '22222222-2222-4222-8222-222222222222','CASH-PAPER-003',current_date,
    1, 13.00, (select updated_at from public.stock_orders
      where id='44444444-4444-4444-8444-444444444441'), 'second paper note for same supplier and PI line');
  perform public.record_supplier_receipt(
    '44444444-4444-4444-8444-444444444441','55555555-5555-4555-8555-555555555551',
    '22222222-2222-4222-8222-222222222222','CASH-PAPER-001',current_date,
    1, 12.50, (select updated_at from public.stock_orders
      where id='44444444-4444-4444-8444-444444444441'), 'another batch under original paper note');
  if (select received_quantity from public.stock_order_items
      where id='55555555-5555-4555-8555-555555555551') <> 7
    or (select count(distinct d.supplier_id) from public.supplier_receipt_allocations a
      join public.supplier_delivery_notes d on d.id=a.delivery_note_id
      where a.stock_order_item_id='55555555-5555-4555-8555-555555555551') <> 2
    or (select count(distinct a.delivery_note_id) from public.supplier_receipt_allocations a
      where a.stock_order_item_id='55555555-5555-4555-8555-555555555551') <> 3 then
    raise exception 'one PI product line was not split accurately across two suppliers and three paper notes';
  end if;
  report := public.supplier_reconciliation_report(current_date,current_date,null,50,0);
  if (report #>> '{summary,supplier_count}')::integer <> 2
    or (report #>> '{summary,note_count}')::integer <> 4
    or not exists(select 1 from jsonb_array_elements(report->'notes') n
      where n->>'note_number'='CREDIT-PAPER-002'
        and n->>'supplier_code'='TEST-1011'
        and (n->>'allocated_quantity')::integer=2
        and (n->>'allocated_cny')::numeric=22.00
        and exists(select 1 from jsonb_array_elements(n->'allocations') a
          where a->>'pi_number'='D-TEST-1' and (a->>'quantity')::integer=2)) then
    raise exception 'supplier paper note did not reverse-map to the correct PI item and amount';
  end if;
  -- One real transfer can settle several paper notes from the same supplier.
  perform public.record_supplier_payment(
    (select id from public.supplier_delivery_notes where note_number='CASH-PAPER-003'),
    5.00,current_date,'CASH','TEST-CASH-PAY-001');
  begin
    perform public.record_supplier_payment(
      (select id from public.supplier_delivery_notes where note_number='CASH-PAPER-003'),
      1.00,current_date,'CASH','test-cash-pay-001');
    raise exception 'same voucher was duplicated on the same paper note';
  exception when others then
    if sqlerrm = 'same voucher was duplicated on the same paper note' then raise; end if;
  end;
  begin
    perform public.record_supplier_payment(
      (select id from public.supplier_delivery_notes where note_number='CREDIT-PAPER-002'),
      1.00,current_date,'CASH','TEST-CASH-PAY-001');
    raise exception 'one payment voucher was shared across suppliers';
  exception when others then
    if sqlerrm = 'one payment voucher was shared across suppliers' then raise; end if;
  end;
  if (select count(*) from public.supplier_payments
      where upper(payment_reference)='TEST-CASH-PAY-001') <> 2 then
    raise exception 'batch payment allocations were not recorded on exactly two supplier notes';
  end if;
end;
$$;
