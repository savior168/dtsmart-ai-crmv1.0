-- Cut over only after the document-backed warehouse UI has passed preview
-- validation. Reconcile any receipts entered by the previous UI during the
-- compatibility window before rejecting undocumented future changes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.stock_order_items in share row exclusive mode;
create temporary table supplier_receipt_cutover_balance on commit drop as
select i.id as stock_order_item_id,
  i.received_quantity - coalesce(sum(a.quantity), 0)::integer as legacy_quantity
from public.stock_order_items i
left join public.supplier_receipt_allocations a on a.stock_order_item_id = i.id
group by i.id, i.received_quantity;

do $$ begin
  if exists (select 1 from supplier_receipt_cutover_balance where legacy_quantity < 0) then
    raise exception '回货台账超过实物数量，不能启用送货单强制校验';
  end if;
end $$;

insert into public.supplier_receipt_legacy_baselines(stock_order_item_id, quantity)
select stock_order_item_id, legacy_quantity from supplier_receipt_cutover_balance
where legacy_quantity > 0
on conflict (stock_order_item_id) do update set quantity = excluded.quantity;

delete from public.supplier_receipt_legacy_baselines b
using supplier_receipt_cutover_balance v
where b.stock_order_item_id = v.stock_order_item_id and v.legacy_quantity = 0;

create trigger stock_receipt_requires_supplier_document
before update of received_quantity on public.stock_order_items
for each row execute function public.require_supplier_receipt_context();

commit;
