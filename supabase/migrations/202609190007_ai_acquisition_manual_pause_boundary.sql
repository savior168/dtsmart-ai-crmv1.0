begin;

-- PAUSING is a user-directed control state. It must settle to PAUSED and may
-- only be resumed by an explicit user action, never by the crash watchdog.
create or replace function public.claim_stalled_ai_acquisition_tasks(p_limit integer default 3)
returns table(task_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select t.id
    from public.ai_acquisition_tasks t
    where t.status in ('QUEUED','RUNNING')
      and not t.cancel_requested
      and (t.last_dispatch_at is null or t.last_dispatch_at < now() - interval '3 minutes')
      and (t.executor_heartbeat_at is null or t.executor_heartbeat_at < now() - interval '3 minutes')
    order by t.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ), claimed as (
    update public.ai_acquisition_tasks t
    set elapsed_ms = t.elapsed_ms + case when t.started_at is not null then greatest(0,(extract(epoch from (coalesce(t.executor_heartbeat_at,t.started_at)-t.started_at))*1000)::bigint) else 0 end,
        started_at = null,
        active_executor = 'VERCEL_DISPATCHING',
        last_dispatch_at = now(),
        recovery_count = t.recovery_count + 1,
        updated_at = now()
    from candidates c where t.id=c.id
    returning t.id
  ) select claimed.id from claimed;
end;
$$;

revoke all on function public.claim_stalled_ai_acquisition_tasks(integer) from public, anon, authenticated;
grant execute on function public.claim_stalled_ai_acquisition_tasks(integer) to service_role;

commit;
