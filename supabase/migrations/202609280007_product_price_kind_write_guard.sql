-- A delegated purchaser may maintain procurement costs without gaining
-- authority to create or replace customer-facing USD sales reference prices.
-- Keep the guard at the table boundary so all existing security-definer price
-- writers (manual save, reviewed import and batch update) obey the same rule.
begin;

create or replace function public.guard_product_price_kind_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.price_kind = 'SALE_REFERENCE'
      and not public.current_user_has_business_permission('pricebooks.sales.view') then
      raise exception '无美元销售参考价维护权限';
    end if;
    if new.price_kind in ('PROCUREMENT', 'PACKAGING', 'OTHER_COST')
      and not public.current_user_has_business_permission('pricebooks.cost.view') then
      raise exception '无采购成本维护权限';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists product_price_kind_write_guard on public.product_prices;
create trigger product_price_kind_write_guard
  before insert or update on public.product_prices
  for each row execute function public.guard_product_price_kind_write();

revoke all on function public.guard_product_price_kind_write() from public, anon, authenticated;

commit;
