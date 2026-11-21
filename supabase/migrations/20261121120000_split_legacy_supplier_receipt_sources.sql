begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Attribute one or several historical product lines to multiple real paper
-- notes atomically. The existing single-line RPC owns all permission,
-- balance, supplier, note, purchase-price and audit checks.
create function public.link_legacy_supplier_receipt_sources_split(
  p_expected_stock_updated_at timestamptz, p_lines jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  line jsonb;
  item_id uuid;
  order_id uuid;
  current_order_id uuid;
  version_at_call timestamptz := p_expected_stock_updated_at;
  linked jsonb;
  note_ids uuid[] := array[]::uuid[];
  total_quantity integer := 0;
  line_count integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception '请选择 1 至 50 条历史回货来源';
  end if;
  for line in select value from jsonb_array_elements(p_lines) as entry(value) loop
    if jsonb_typeof(line) <> 'object' then raise exception '来源行格式无效'; end if;
    item_id := (line->>'stock_order_item_id')::uuid;
    if item_id is null then raise exception '产品项无效'; end if;
    select stock_order_id into current_order_id
      from public.stock_order_items where id=item_id;
    if current_order_id is null then raise exception '产品项不存在或无权查看'; end if;
    if order_id is null then order_id := current_order_id;
    elsif order_id <> current_order_id then
      raise exception '一次只能补录同一张 PI 的产品';
    end if;
    linked := public.link_legacy_supplier_receipt_source(
      item_id,(line->>'supplier_id')::uuid,line->>'note_number',
      (line->>'document_date')::date,(line->>'quantity')::integer,
      (line->>'purchase_unit_price_cny')::numeric,version_at_call
    );
    if not (linked->>'delivery_note_id')::uuid = any(note_ids) then
      note_ids := array_append(note_ids,(linked->>'delivery_note_id')::uuid);
    end if;
    total_quantity := total_quantity + (line->>'quantity')::integer;
    line_count := line_count + 1;
    select updated_at into version_at_call
      from public.stock_orders where id=order_id;
    if version_at_call is null then raise exception '备货单已变更，请刷新后重试'; end if;
  end loop;
  return jsonb_build_object('stock_order_id',order_id,
    'delivery_note_ids',to_jsonb(note_ids),'line_count',line_count,
    'total_quantity',total_quantity);
end;
$$;
revoke all on function public.link_legacy_supplier_receipt_sources_split(timestamptz,jsonb)
  from public,anon;
grant execute on function public.link_legacy_supplier_receipt_sources_split(timestamptz,jsonb)
  to authenticated;

commit;
