-- A clerk may read assigned customers only, including through direct table access.
-- Restrictive policy prevents older permissive owner/creator policies from
-- exposing a public-pool customer created before an account changed roles.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create policy customers_order_clerk_assigned_boundary on public.customers
  as restrictive for select to authenticated using (
    coalesce(public.current_user_role() <> 'ORDER_CLERK', false)
    or (owner_id is not null and deleted_at is null)
  );

commit;
