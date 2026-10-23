begin;

create or replace function public.require_confirmed_purchase_price_for_supplier()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(new.warehouse_supplier_code), '') is not null
      and (new.procurement_cost_confirmed is not true or new.procurement_cost is null)
    then
      raise exception '请先录入并保存采购价，再填写供应商编码'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Existing legacy rows may contain a supplier code without a confirmed price.
  -- Let unrelated updates continue; reject only when the supplier/price state changes.
  if nullif(btrim(new.warehouse_supplier_code), '') is not null
    and (new.procurement_cost_confirmed is not true or new.procurement_cost is null)
    and (
      old.warehouse_supplier_code is distinct from new.warehouse_supplier_code
      or old.procurement_cost is distinct from new.procurement_cost
      or old.procurement_cost_confirmed is distinct from new.procurement_cost_confirmed
    )
  then
    raise exception '请先录入并保存采购价，再填写供应商编码'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger stock_supplier_requires_confirmed_purchase_price
before insert or update on public.stock_order_items
for each row
execute function public.require_confirmed_purchase_price_for_supplier();

commit;
