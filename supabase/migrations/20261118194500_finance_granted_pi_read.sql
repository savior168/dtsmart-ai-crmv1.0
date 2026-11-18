-- Finance reads PI only when both the page and cross-user data scope are active.
-- Existing owner/admin/clerk/supervisor policies remain unchanged. This is
-- SELECT-only; no finance write or supplier-sensitive stock policy is added.
drop policy if exists sales_orders_finance_granted_pi_read on public.sales_orders;
create policy sales_orders_finance_granted_pi_read on public.sales_orders
  for select to authenticated
  using (
    confirmation_method = 'DIRECT_PI'
    and public.current_user_role() = 'FINANCE'
    and public.current_user_has_business_permission('orders.data_all')
  );

drop policy if exists sales_order_items_finance_granted_pi_read on public.sales_order_items;
create policy sales_order_items_finance_granted_pi_read on public.sales_order_items
  for select to authenticated
  using (
    public.current_user_role() = 'FINANCE'
    and public.current_user_has_business_permission('orders.data_all')
    and exists (
      select 1 from public.sales_orders pi
      where pi.id = sales_order_id and pi.confirmation_method = 'DIRECT_PI'
    )
  );
