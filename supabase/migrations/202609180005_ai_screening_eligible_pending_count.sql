begin;

-- Keep the task-center KPI identical to the create-task eligibility rule
-- without transferring every customer and task item through the API.  This is
-- intentionally a single anti-join so the count remains cheap at large scale.
create or replace function public.count_eligible_pending_ai_customers(p_owner_ids uuid[] default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::bigint
  from public.customers c
  where c.deleted_at is null
    and c.ai_score is null
    and (p_owner_ids is null or c.owner_id = any(p_owner_ids))
    and not exists (
      select 1
      from public.ai_screening_task_items i
      join public.ai_screening_tasks t on t.id = i.task_id
      where i.customer_id = c.id
        and t.status in ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED')
        and i.status in ('PENDING', 'RUNNING')
    );
$$;

revoke execute on function public.count_eligible_pending_ai_customers(uuid[])
  from public, anon, authenticated;
grant execute on function public.count_eligible_pending_ai_customers(uuid[])
  to service_role;

commit;
