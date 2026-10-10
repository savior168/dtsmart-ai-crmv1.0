begin;

-- The customer detail API returns the approved business summary to sales.
-- Raw task logs, model results and source evidence must remain admin-only,
-- including direct authenticated PostgREST requests that bypass the UI.
-- Restrictive policies are ANDed with every existing permissive policy.
create policy ai_tasks_admin_read_boundary
  on public.ai_screening_tasks as restrictive
  for select to authenticated
  using (public.current_user_is_admin());

create policy ai_task_items_admin_read_boundary
  on public.ai_screening_task_items as restrictive
  for select to authenticated
  using (public.current_user_is_admin());

create policy ai_results_admin_read_boundary
  on public.ai_screening_results as restrictive
  for select to authenticated
  using (public.current_user_is_admin());

create policy ai_evidence_admin_read_boundary
  on public.ai_screening_evidence as restrictive
  for select to authenticated
  using (public.current_user_is_admin());

commit;
