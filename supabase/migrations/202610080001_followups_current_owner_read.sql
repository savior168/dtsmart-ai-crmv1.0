begin;

-- A current owner must see all interactions in the customer's active cycle,
-- including an administrator's entry. Former owners lose direct read access.
drop policy if exists followups_scope_select_v3 on public.followups;
drop policy if exists followups_current_owner_select on public.followups;
create policy followups_current_owner_select on public.followups
for select to authenticated using (
  public.current_user_is_elevated()
  or exists (
    select 1 from public.customers c
    where c.id = customer_id
      and c.deleted_at is null
      and c.owner_id = auth.uid()
  )
);

commit;
