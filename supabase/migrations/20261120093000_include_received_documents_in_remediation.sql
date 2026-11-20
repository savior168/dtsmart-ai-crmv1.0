-- A delivery note can be incomplete as soon as stock is received, before shipment.
-- Keep this queue aligned with the physical receipt and exclude cancelled PI lines.
create or replace function public.list_missing_shipped_pi_documents(p_limit integer default 50, p_offset integer default 0)
returns table(stock_order_id uuid, order_number text, missing_number_count bigint,
  missing_image_count bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.current_user_role() not in ('WAREHOUSE','ADMIN')
    or not public.current_user_has_business_permission('stock.view')
    or not public.current_user_has_business_permission('supplier.documents.view') then
    raise exception '无查看待补送货凭证权限';
  end if;
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    raise exception '分页参数无效';
  end if;
  return query
  with missing as (
    select o.id, coalesce(o.warehouse_reference_number, o.order_number, o.id::text) as display_number,
      count(*) filter (where d.id is null or d.number_pending)::bigint as number_count,
      count(*) filter (where d.id is null or not exists (
        select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
      ))::bigint as image_count
    from public.stock_orders o
    join public.stock_order_items i on i.stock_order_id = o.id
      and i.pi_amendment_cancelled_at is null
      and (i.received_quantity > 0 or i.shipped_quantity > 0)
    left join public.supplier_receipt_allocations a on a.stock_order_item_id = i.id
      and a.quantity > 0 and a.correction_of is null
    left join public.supplier_delivery_notes d on d.id = a.delivery_note_id
    where o.status <> 'CANCELLED'
    group by o.id, o.warehouse_reference_number, o.order_number
    having count(*) filter (where d.id is null or d.number_pending or not exists (
      select 1 from public.attachments f where f.supplier_delivery_note_id = d.id
    )) > 0
  )
  select m.id, m.display_number, m.number_count, m.image_count, count(*) over()::bigint
  from missing m order by m.display_number desc limit p_limit offset p_offset;
end;
$$;
