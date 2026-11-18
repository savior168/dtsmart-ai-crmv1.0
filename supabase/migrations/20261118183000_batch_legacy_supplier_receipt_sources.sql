begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- One RPC call is one database transaction: if any selected product fails,
-- all attribution changes roll back. The existing single-line function keeps
-- authority, quantity, purchase-price, note and audit validations centralized.
create function public.link_legacy_supplier_receipt_sources_batch(
  p_supplier_id uuid, p_note_number text, p_document_date date,
  p_expected_stock_updated_at timestamptz, p_lines jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  line jsonb;
  item_id uuid;
  order_id uuid;
  current_order_id uuid;
  seen_ids uuid[] := array[]::uuid[];
  version_at_call timestamptz := p_expected_stock_updated_at;
  linked jsonb;
  delivery_note_id uuid;
  total_quantity integer := 0;
  line_count integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception '请选择 1 至 50 项同一纸单的产品';
  end if;
  for line in select value from jsonb_array_elements(p_lines) as entry(value) loop
    item_id := (line->>'stock_order_item_id')::uuid;
    if item_id is null or item_id = any(seen_ids) then
      raise exception '产品项无效或重复';
    end if;
    seen_ids := array_append(seen_ids,item_id);
    select stock_order_id into current_order_id
      from public.stock_order_items where id=item_id;
    if current_order_id is null then raise exception '产品项不存在或无权查看'; end if;
    if order_id is null then order_id := current_order_id;
    elsif order_id <> current_order_id then
      raise exception '批量补录只能选择同一张 PI 的产品';
    end if;
    linked := public.link_legacy_supplier_receipt_source(
      item_id,p_supplier_id,p_note_number,p_document_date,
      (line->>'quantity')::integer,
      (line->>'purchase_unit_price_cny')::numeric,version_at_call
    );
    if delivery_note_id is null then
      delivery_note_id := (linked->>'delivery_note_id')::uuid;
    elsif delivery_note_id <> (linked->>'delivery_note_id')::uuid then
      raise exception '所选产品未关联同一张供应商纸单';
    end if;
    total_quantity := total_quantity + (line->>'quantity')::integer;
    line_count := line_count + 1;
    select updated_at into version_at_call
      from public.stock_orders where id=order_id;
    if version_at_call is null then raise exception '备货单已变更，请刷新后重试'; end if;
  end loop;
  return jsonb_build_object('stock_order_id',order_id,
    'delivery_note_id',delivery_note_id,'line_count',line_count,
    'total_quantity',total_quantity);
end;
$$;
revoke all on function public.link_legacy_supplier_receipt_sources_batch(uuid,text,date,timestamptz,jsonb)
  from public,anon;
grant execute on function public.link_legacy_supplier_receipt_sources_batch(uuid,text,date,timestamptz,jsonb)
  to authenticated;

commit;
