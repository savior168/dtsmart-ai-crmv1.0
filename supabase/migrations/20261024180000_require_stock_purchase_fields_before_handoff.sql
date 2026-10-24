begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.require_costed_stock_shipment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.preparation_status is distinct from old.preparation_status
      or new.shipped_quantity is distinct from old.shipped_quantity)
    and ((new.shipped_quantity = new.quantity and new.preparation_status <> 'SHIPPED')
      or (new.shipped_quantity <> new.quantity and new.preparation_status = 'SHIPPED')) then
    raise exception '产品发货数量与单项状态不一致，请刷新后重试';
  end if;

  if new.shipped_quantity is distinct from old.shipped_quantity
    and current_setting('app.costed_stock_shipment', true) is distinct from '1' then
    raise exception '交货代请刷新页面并通过填写三项人民币费用的发货入口操作';
  end if;

  if new.shipped_quantity > old.shipped_quantity
    and (nullif(btrim(new.warehouse_supplier_code), '') is null
      or new.procurement_cost_confirmed is not true
      or new.procurement_cost is null) then
    raise exception '请先填写并保存供应商编码和有效采购价，再交货代';
  end if;

  return new;
end;
$$;

revoke all on function public.require_costed_stock_shipment() from public, anon, authenticated;

commit;
