begin;

-- A current owner may see administrator-authored interactions for their
-- customer. After reassignment, the former owner must not read those details.
-- Sales performance counts remain available through the scoped report RPC.
drop policy if exists followups_scope_select_v3 on public.followups;
drop policy if exists followups_current_owner_select on public.followups;
drop policy if exists followups_author_or_current_owner_select on public.followups;
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
