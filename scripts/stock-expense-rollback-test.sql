-- Execute only inside BEGIN with both pending expense migrations loaded;
-- ROLLBACK the same transaction. All rows are synthetic and disposable.
do $test$
declare
  v_actor uuid; v_customer uuid; v_quote uuid; v_sales uuid; v_stock uuid;
  v_item uuid; v_second_item uuid; v_supplier uuid; v_note uuid; v_pending_note uuid; v_shipment uuid;
  v_old_photo uuid; v_new_photo uuid; v_expense_entry uuid;
  v_batch uuid:=gen_random_uuid(); v_result jsonb; v_report jsonb; v_failed boolean:=false;
begin
  select id into v_actor from public.users where role='ADMIN' and status='ACTIVE' order by id limit 1;
  if v_actor is null then raise exception 'no test actor'; end if;
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  insert into public.customers(company_name) values('CODEX_ROLLBACK_EXPENSE_TEST') returning id into v_customer;
  insert into public.quotes(customer_id,created_by,owner_id,quote_number)
    values(v_customer,v_actor,v_actor,'CODEX_ROLLBACK_Q_'||left(gen_random_uuid()::text,8)) returning id into v_quote;
  insert into public.sales_orders(order_number,quote_id,quote_number,customer_id,sales_user_id,customer_short_name,currency,status)
    select 'CODEX_ROLLBACK_SO_'||left(gen_random_uuid()::text,8),q.id,q.quote_number,q.customer_id,v_actor,'CODEX_ROLLBACK','CNY','PREPARING'
    from public.quotes q where q.id=v_quote returning id into v_sales;
  insert into public.stock_orders(quote_id,quote_number,stock_number,sales_user_id,customer_short_name,sales_order_id,order_number,status)
    select q.id,q.quote_number,'CODEX_ROLLBACK_ST_'||left(gen_random_uuid()::text,8),v_actor,'CODEX_ROLLBACK',s.id,s.order_number,'PREPARING'
    from public.quotes q,public.sales_orders s where q.id=v_quote and s.id=v_sales returning id into v_stock;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,quantity,received_quantity)
    values(v_stock,1,'CODEX_ROLLBACK_ITEM',1,1) returning id into v_item;
  insert into public.suppliers(system_code,settlement_cycle,main_products)
    values('T'||upper(left(replace(gen_random_uuid()::text,'-',''),8)),'CASH','CODEX_ROLLBACK') returning id into v_supplier;
  insert into public.supplier_delivery_notes(supplier_id,note_number,document_date,created_by)
    values(v_supplier,'CODEX_ROLLBACK_N_'||left(gen_random_uuid()::text,8),current_date,v_actor) returning id into v_note;
  insert into public.supplier_receipt_allocations(delivery_note_id,stock_order_item_id,product_snapshot,quantity,purchase_unit_price_cny,recorded_by)
    values(v_note,v_item,'{}'::jsonb,1,10,v_actor);
  insert into public.stock_order_expenses(stock_order_id,packaging_cost_cny,shipping_expenses_cny,procurement_expenses_cny,updated_by)
    values(v_stock,3,0,0,v_actor);
  insert into public.stock_order_shipments(stock_order_id,item_ids,packaging_cost_cny,shipping_expenses_cny,procurement_expenses_cny,handoff_note,created_by)
    values(v_stock,array[v_item],3,0,0,'CODEX_ROLLBACK',v_actor) returning id into v_shipment;
  v_result:=public.record_stock_order_expenses_batch(v_stock,jsonb_build_array(
    jsonb_build_object('expense_type','PACKAGING','amount_cny',2,'supplier_id',v_supplier,'delivery_note_id',v_note),
    jsonb_build_object('expense_type','SHIPPING','amount_cny',1),
    jsonb_build_object('expense_type','OTHER','amount_cny',1,'expense_item','测试项目','description','测试说明')),v_batch);
  if jsonb_array_length(v_result)<>3 then raise exception 'batch failed'; end if;
  v_expense_entry:=(v_result->0->>'id')::uuid;
  if public.supplier_note_packaging_cny(v_note)<>2 then raise exception 'packaging total wrong'; end if;
  if public.record_stock_order_expenses_batch(v_stock,jsonb_build_array(
    jsonb_build_object('expense_type','PACKAGING','amount_cny',2,'supplier_id',v_supplier,'delivery_note_id',v_note),
    jsonb_build_object('expense_type','SHIPPING','amount_cny',1),
    jsonb_build_object('expense_type','OTHER','amount_cny',1,'expense_item','测试项目','description','测试说明')),v_batch)<>v_result then
    raise exception 'idempotency failed'; end if;
  v_failed:=false;
  begin
    perform public.record_stock_order_expenses_batch(v_stock,jsonb_build_array(
      jsonb_build_object('expense_type','SHIPPING','amount_cny',4),
      jsonb_build_object('expense_type','PACKAGING','amount_cny',2,'supplier_id',v_supplier)),gen_random_uuid());
  exception when others then v_failed:=true; end;
  if not v_failed or (select count(*) from public.stock_order_expense_entries where stock_order_id=v_stock)<>3 then
    raise exception 'partial batch was saved'; end if;
  perform public.correct_stock_order_shipment_expense(v_stock,v_shipment,'PACKAGING',3,3,v_supplier,v_note,null,null,'核对归属');
  if public.supplier_note_packaging_cny(v_note)<>5 then raise exception 'correction payable wrong'; end if;
  if not exists(select 1 from public.stock_order_expenses where stock_order_id=v_stock
    and packaging_cost_cny=5 and shipping_expenses_cny=1 and procurement_expenses_cny=1) then
    raise exception 'PI expense total wrong'; end if;
  v_report:=public.supplier_reconciliation_report(current_date,current_date,v_supplier,20,0);
  if (v_report->'summary'->>'allocated_cny')::numeric<>15 then raise exception 'report payable wrong'; end if;
  if (v_report->'notes'->0->>'goods_allocated_cny')::numeric<>10 then raise exception 'goods-only paper comparison wrong'; end if;
  perform public.record_supplier_payment(v_note,14,current_date,'CASH','');
  begin
    perform public.correct_stock_order_shipment_expense(v_stock,v_shipment,'PACKAGING',3,1,v_supplier,v_note,null,null,'降低金额');
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'overpaid correction was accepted'; end if;
  v_failed:=false;
  begin
    perform public.correct_stock_order_expense_entry(v_stock,v_expense_entry,2,0,
      null,null,null,null,'测试取消误记包装费');
  exception when others then v_failed:=true; end;
  if not v_failed then raise exception 'overpaid new expense correction was accepted'; end if;
  perform public.correct_stock_order_expense_entry(v_stock,v_expense_entry,2,1,
    v_supplier,v_note,null,null,'测试更正包装金额');
  if public.supplier_note_packaging_cny(v_note)<>4
    or not exists(select 1 from public.stock_order_expenses where stock_order_id=v_stock
      and packaging_cost_cny=4) then
    raise exception 'new expense correction totals wrong'; end if;
  insert into public.stock_order_items(stock_order_id,line_number,item_name,quantity,received_quantity)
    values(v_stock,2,'CODEX_ROLLBACK_SECOND_ITEM',1,1) returning id into v_second_item;
  insert into public.supplier_delivery_notes(supplier_id,note_number,document_date,created_by,number_pending)
    values(v_supplier,'__PENDING__'||replace(gen_random_uuid()::text,'-',''),current_date,v_actor,true)
    returning id into v_pending_note;
  insert into public.supplier_receipt_allocations(delivery_note_id,stock_order_item_id,product_snapshot,quantity,purchase_unit_price_cny,recorded_by)
    values(v_pending_note,v_second_item,'{}'::jsonb,1,7,v_actor);
  v_result:=public.complete_or_reuse_supplier_delivery_note_number(
    v_pending_note,(select note_number from public.supplier_delivery_notes where id=v_note),
    (select updated_at from public.supplier_delivery_notes where id=v_pending_note),false);
  if v_result->>'status'<>'confirm_reuse' then raise exception 'reuse confirmation missing'; end if;
  if (select count(*) from public.supplier_receipt_allocations where delivery_note_id=v_pending_note)<>1 then
    raise exception 'preview mutated receipt'; end if;
  v_result:=public.complete_or_reuse_supplier_delivery_note_number(
    v_pending_note,(select note_number from public.supplier_delivery_notes where id=v_note),
    (select updated_at from public.supplier_delivery_notes where id=v_pending_note),true);
  if v_result->>'status'<>'reused' or exists(select 1 from public.supplier_delivery_notes where id=v_pending_note)
    or (select count(*) from public.supplier_receipt_allocations where delivery_note_id=v_note)<>2
    or not exists(select 1 from public.supplier_delivery_note_merges where pending_note_id=v_pending_note and target_note_id=v_note) then
    raise exception 'pending receipt was not safely reused'; end if;
  perform public.correct_supplier_delivery_note_number(v_note,'CODEX_ROLLBACK_CORRECTED',
    (select updated_at from public.supplier_delivery_notes where id=v_note),'测试号码更正');
  if not exists(select 1 from public.supplier_delivery_note_corrections
    where delivery_note_id=v_note and correction_type='NUMBER') then
    raise exception 'number correction was not audited'; end if;
  insert into public.attachments(supplier_delivery_note_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind)
    values(v_note,v_actor,'old.png','old.png','CODEX_ROLLBACK/old.png','image/png',10,'SUPPLIER_DELIVERY_NOTE')
    returning id into v_old_photo;
  insert into public.attachments(supplier_delivery_note_id,uploaded_by,filename,original_filename,storage_path,mime_type,size_bytes,kind,supplier_photo_replaces_id)
    values(v_note,v_actor,'new.png','new.png','CODEX_ROLLBACK/new.png','image/png',10,'SUPPLIER_DELIVERY_NOTE',v_old_photo)
    returning id into v_new_photo;
  update public.supplier_delivery_notes set paper_total_cny=17 where id=v_note;
  perform public.supersede_supplier_delivery_note_photo(v_note,v_old_photo,v_new_photo,
    (select updated_at from public.supplier_delivery_notes where id=v_note),'原图上传错误');
  if not exists(select 1 from public.attachments where id=v_old_photo
    and supplier_photo_superseded_at is not null and supplier_photo_superseded_by=v_new_photo)
    or exists(select 1 from public.supplier_delivery_notes where id=v_note and paper_total_cny is not null)
    or not exists(select 1 from public.supplier_delivery_note_corrections where delivery_note_id=v_note and correction_type='PHOTO') then
    raise exception 'photo replacement did not invalidate paper check and preserve history'; end if;
end;
$test$;
