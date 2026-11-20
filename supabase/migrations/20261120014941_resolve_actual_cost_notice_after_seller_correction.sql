-- A seller correction can make an earlier warehouse cost-rise reminder stale.
-- Resolve it only after the commercial cost catches up with verified cost.
create or replace function public.resolve_actual_cost_notice_after_seller_correction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  stock_line public.stock_order_items;
begin
  if new.estimated_unit_cost_cny is not distinct from old.estimated_unit_cost_cny
    or new.pi_amendment_cancelled_at is not null then
    return new;
  end if;
  select i.* into stock_line
    from public.stock_order_items i
    join public.stock_orders s on s.id = i.stock_order_id
    where s.sales_order_id = new.sales_order_id
      and i.line_number = new.line_number
      and i.pi_amendment_cancelled_at is null
    limit 1;
  if stock_line.id is not null
    and stock_line.warehouse_actual_unit_cost_cny is not null
    and new.estimated_unit_cost_cny >= stock_line.warehouse_actual_unit_cost_cny then
    update public.system_notifications set action_status = 'RESOLVED',
      read_at = coalesce(read_at, now())
    where dedupe_key like 'pi-actual-cost-rise:' || stock_line.id || ':%'
      and action_status = 'PENDING';
  end if;
  return new;
end;
$$;
revoke all on function public.resolve_actual_cost_notice_after_seller_correction()
  from public, anon, authenticated;
create trigger resolve_actual_cost_notice_after_seller_correction
after update of estimated_unit_cost_cny on public.sales_order_items
for each row execute function public.resolve_actual_cost_notice_after_seller_correction();
