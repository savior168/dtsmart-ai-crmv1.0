-- A former salesperson may still own historical customers after becoming an
-- order clerk. Ownership must never grant that role direct customer writes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create policy customers_order_clerk_no_insert on public.customers
  as restrictive for insert to authenticated
  with check (public.current_user_role() is distinct from 'ORDER_CLERK');
create policy customers_order_clerk_no_update on public.customers
  as restrictive for update to authenticated
  using (public.current_user_role() is distinct from 'ORDER_CLERK')
  with check (public.current_user_role() is distinct from 'ORDER_CLERK');
create policy customers_order_clerk_no_delete on public.customers
  as restrictive for delete to authenticated
  using (public.current_user_role() is distinct from 'ORDER_CLERK');

commit;
