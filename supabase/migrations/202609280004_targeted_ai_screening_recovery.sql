-- Keep maintenance-paused screening tasks excluded without freezing the whole queue.
begin;

create or replace function public.claim_stalled_ai_tasks_for_vercel_excluding(
  p_limit integer, p_excluded_task_ids uuid[]
)
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
      and not (t.id = any(coalesce(p_excluded_task_ids, '{}'::uuid[])))
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

revoke all on function public.claim_stalled_ai_tasks_for_vercel_excluding(integer,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_stalled_ai_tasks_for_vercel_excluding(integer,uuid[]) to service_role;

commit;
