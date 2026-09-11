-- AI screening now has one production execution environment. Historical
-- executor fields are retained for audit, but no local process may claim new
-- or unfinished work.

update public.cost_center_settings
set ai_default_dispatch_policy = 'VERCEL_ONLY', updated_at = now()
where id = true;

-- Safely return unfinished local leases to the durable queue. Completed
-- results are not touched, and a Vercel workflow will claim only pending rows.
update public.ai_screening_task_items i
set status = 'PENDING',
    analysis_status = 'PENDING',
    writeback_status = 'PENDING',
    progress = 0,
    current_step = 'WAITING',
    pipeline_stage = 'NORMALIZED',
    lease_owner = null,
    lease_token = null,
    lease_expires_at = null,
    executor_heartbeat_at = null,
    executor_type = null,
    started_at = null,
    updated_at = now()
from public.ai_screening_tasks t
where t.id = i.task_id
  and i.status = 'RUNNING'
  and i.executor_type = 'LOCAL_NODE'
  and t.status in ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED');

-- Existing active local/hybrid tasks are made cloud-only. They are picked up
-- once by the atomic stalled-task rescue after their short dispatch window.
update public.ai_screening_tasks
set execution_mode = 'VERCEL_ONLY',
    dispatch_policy = 'VERCEL_ONLY',
    active_executor = null,
    executor_heartbeat_at = null,
    workflow_run_id = null,
    last_dispatch_at = null,
    dispatch_error = null,
    status = case when status in ('RUNNING', 'PAUSING') then 'QUEUED' else status end,
    started_at = case when status in ('RUNNING', 'PAUSING') then null else started_at end,
    updated_at = now()
where status in ('QUEUED', 'RUNNING', 'PAUSING', 'PAUSED')
  and (execution_mode <> 'VERCEL_ONLY' or active_executor = 'LOCAL_NODE');

-- Old Windows workers use these RPCs. Revoking their service-role grants
-- prevents a stale installed binary from sending heartbeats or claiming work.
revoke execute on function public.heartbeat_ai_worker(text,text,text,text,integer,integer,jsonb) from service_role;
revoke execute on function public.stop_ai_worker(text) from service_role;
revoke execute on function public.claim_next_ai_screening_item(text,integer) from service_role;

-- Reserve a workflow start before calling Vercel. This eliminates duplicate
-- runs from double-clicks, concurrent retry requests, or repeated API calls.
create or replace function public.reserve_ai_cloud_task_dispatch(p_task_id uuid)
returns boolean
language plpgsql security definer set search_path=public as $$
declare v_updated integer;
begin
  update public.ai_screening_tasks
  set execution_mode = 'VERCEL_ONLY',
      dispatch_policy = 'VERCEL_ONLY',
      active_executor = 'VERCEL_DISPATCHING',
      last_dispatch_at = now(),
      dispatch_error = null,
      updated_at = now()
  where id = p_task_id
    and status in ('QUEUED', 'RUNNING')
    and not coalesce(cancel_requested, false)
    and active_executor is null;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end $$;

revoke all on function public.reserve_ai_cloud_task_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.reserve_ai_cloud_task_dispatch(uuid) to service_role;

-- Cloud recovery only considers cloud-only tasks. The atomic transition to
-- VERCEL_DISPATCHING ensures page refreshes cannot start duplicate workflows.
create or replace function public.claim_stalled_ai_tasks_for_vercel(p_limit integer default 3)
returns table(task_id uuid, strategy text, scheduled_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  return query
  with candidates as (
    select t.id
    from public.ai_screening_tasks t
    where t.execution_mode = 'VERCEL_ONLY'
      and t.status in ('QUEUED', 'RUNNING')
      and not coalesce(t.cancel_requested, false)
      and (t.scheduled_at is null or t.scheduled_at <= now())
      and coalesce(t.executor_heartbeat_at, t.last_dispatch_at, t.created_at) < now() - interval '75 seconds'
      and coalesce(t.active_executor, '') <> 'VERCEL_DISPATCHING'
    order by t.created_at
    for update skip locked
    limit least(10, greatest(1, p_limit))
  ), claimed as (
    update public.ai_screening_tasks t
    set active_executor = 'VERCEL_DISPATCHING', last_dispatch_at = now(), updated_at = now()
    from candidates c
    where t.id = c.id
    returning t.id, t.strategy, t.scheduled_at
  )
  select c.id, c.strategy, c.scheduled_at from claimed c;
end $$;

revoke all on function public.claim_stalled_ai_tasks_for_vercel(integer) from public, anon, authenticated;
grant execute on function public.claim_stalled_ai_tasks_for_vercel(integer) to service_role;
