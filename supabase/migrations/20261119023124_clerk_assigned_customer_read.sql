begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The older permissive clerk policy allows every owned customer. Intersect
-- every SELECT path with the administrator-maintained seller assignment, so
-- direct PostgREST reads and revoked assignments fail closed as well.
drop policy if exists customers_order_clerk_assigned_boundary on public.customers;
create policy customers_order_clerk_assigned_boundary on public.customers as restrictive
  for select to authenticated using (
    coalesce((select public.current_user_role()) <> 'ORDER_CLERK', false)
    or (deleted_at is null and owner_id is not null
      and public.order_clerk_has_sales_scope(owner_id))
  );

commit;
