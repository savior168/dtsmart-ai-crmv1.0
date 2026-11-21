-- One-off, audited correction requested for D60021104 line 1.
-- The shipped-line guard is relaxed only inside this transaction, for this
-- exact item and model transition, and restored before commit.
do $$
declare
  original_guard text;
  temporary_guard text;
  old_pi jsonb;
  old_stock jsonb;
  old_quote jsonb;
  new_stock jsonb;
begin
  perform 1 from public.sales_orders
    where id = '92463eb4-6fa6-4d92-bab0-353a3d049f1c'
      and warehouse_reference_number = 'D60021104' for update;
  -- Other environments need not contain this production order.
  if not found then return; end if;
  if exists (select 1 from public.sales_order_items
      where id = 'e97d00b6-980c-4ba0-a09e-5244181c7917' and model = '3241') then
    return;
  end if;

  select to_jsonb(i) into old_pi from public.sales_order_items i
    where i.id = 'e97d00b6-980c-4ba0-a09e-5244181c7917'
      and i.sales_order_id = '92463eb4-6fa6-4d92-bab0-353a3d049f1c'
      and i.line_number = 1 and i.model = '3448' for update;
  select to_jsonb(i) into old_stock from public.stock_order_items i
    where i.id = 'af89aaf2-f627-45ae-bf9f-3a56c01472e3'
      and i.stock_order_id = '757b6ca9-3c8f-43de-94d8-cc283e003188'
      and i.line_number = 1 and i.model = '3448' for update;
  select to_jsonb(i) into old_quote from public.quote_items i
    where i.id = 'b84b6a25-eac5-4448-a04f-f21d5261ada1'
      and i.quote_id = '77d1368e-76e3-4778-a3f7-7d4fcfc44d61'
      and i.line_number = 1 and i.model = '3448' for update;
  if old_pi is null or old_stock is null or old_quote is null then
    raise exception 'D60021104 source item changed; correction aborted';
  end if;
  if exists (select 1 from public.supplier_receipt_allocations
      where stock_order_item_id = 'af89aaf2-f627-45ae-bf9f-3a56c01472e3'
        and product_snapshot->>'model' = '3448') then
    raise exception 'D60021104 has historical receipt snapshots; review before correction';
  end if;

  select pg_get_functiondef('public.prevent_shipped_stock_line_amendment()'::regprocedure)
    into original_guard;
  temporary_guard := replace(original_guard,
    '  if old.shipped_quantity > 0 and to_jsonb(new) is distinct from to_jsonb(old) then',
    $guard$  if old.id = 'af89aaf2-f627-45ae-bf9f-3a56c01472e3'::uuid
    and old.model = '3448' and new.model = '3241'
    and (to_jsonb(new) - 'model') = (to_jsonb(old) - 'model') then
    return new;
  end if;
  if old.shipped_quantity > 0 and to_jsonb(new) is distinct from to_jsonb(old) then$guard$);
  if temporary_guard = original_guard then raise exception 'Shipped item guard changed'; end if;
  execute temporary_guard;
  update public.quote_items set model = '3241'
    where id = 'b84b6a25-eac5-4448-a04f-f21d5261ada1';
  update public.sales_order_items set model = '3241'
    where id = 'e97d00b6-980c-4ba0-a09e-5244181c7917';
  update public.stock_order_items set model = '3241'
    where id = 'af89aaf2-f627-45ae-bf9f-3a56c01472e3';
  execute original_guard;

  select to_jsonb(i) into new_stock from public.stock_order_items i
    where i.id = 'af89aaf2-f627-45ae-bf9f-3a56c01472e3';
  if (new_stock - 'model') is distinct from (old_stock - 'model')
    or new_stock->>'model' <> '3241' then
    raise exception 'Stock item fields changed beyond model; correction aborted';
  end if;
  if not exists (select 1 from public.sales_order_items
      where id = 'e97d00b6-980c-4ba0-a09e-5244181c7917' and model = '3241')
    or not exists (select 1 from public.quote_items
      where id = 'b84b6a25-eac5-4448-a04f-f21d5261ada1' and model = '3241') then
    raise exception 'D60021104 correction incomplete';
  end if;
  insert into public.audit_logs(action,target_type,target_id,content,before_data,after_data)
  values ('PRODUCT_MODEL_CORRECTION','sales_order',
    '92463eb4-6fa6-4d92-bab0-353a3d049f1c',
    jsonb_build_object('order_number','D60021104','line_number',1,
      'reason','User-requested model typo correction; no quantity or price change'),
    jsonb_build_object('pi',old_pi,'stock',old_stock,'quote',old_quote),
    jsonb_build_object('model','3241','pi_item_id','e97d00b6-980c-4ba0-a09e-5244181c7917',
      'stock_item_id','af89aaf2-f627-45ae-bf9f-3a56c01472e3',
      'quote_item_id','b84b6a25-eac5-4448-a04f-f21d5261ada1'));
end;
$$;
