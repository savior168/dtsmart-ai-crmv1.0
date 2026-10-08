begin;

-- Keep the original author's historical reporting access while allowing the
-- current owner to see interactions recorded by another user for their customer.
drop policy if exists followups_scope_select_v3 on public.followups;
drop policy if exists followups_current_owner_select on public.followups;
drop policy if exists followups_author_or_current_owner_select on public.followups;
create policy followups_author_or_current_owner_select on public.followups
for select to authenticated using (
  public.current_user_is_elevated()
  or user_id = auth.uid()
  or exists (
    select 1 from public.customers c
    where c.id = customer_id
      and c.deleted_at is null
      and c.owner_id = auth.uid()
  )
);

commit;
