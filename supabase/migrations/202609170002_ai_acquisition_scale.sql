begin;

-- One durable acquisition task may cover a whole national market. This is a
-- safety ceiling for real discovered candidates, not a promise or a synthetic
-- target. Provider exhaustion and cost controls still stop work earlier.
alter table public.ai_acquisition_tasks
  drop constraint if exists ai_acquisition_tasks_target_count_check;
alter table public.ai_acquisition_tasks
  add constraint ai_acquisition_tasks_target_count_check
  check (target_count between 1 and 50000);

-- Aggregate progress inside Postgres so task pages remain exact after a task
-- grows beyond PostgREST's default 1,000-row response limit.
create or replace function public.get_ai_acquisition_discovery_progress(p_task_ids uuid[])
returns table (
  task_id uuid,
  total_count bigint,
  terminal_count bigint,
  fresh_completed_count bigint,
  skipped_recent_count bigint,
  skipped_active_count bigint,
  reused_count bigint,
  raw_hit_count bigint,
  current_country text,
  current_query text,
  current_status text,
  current_updated_at timestamptz,
  blocked_periods text[]
)
language sql
stable
security definer
set search_path = public
as $$
  with aggregate_progress as (
    select
      checkpoint.task_id,
      count(*)::bigint as total_count,
      count(*) filter (where checkpoint.status in ('COMPLETED','BUDGET_LIMITED','SKIPPED_RECENT','SKIPPED_ACTIVE','REUSED_RECENT','REUSED_ACTIVE'))::bigint as terminal_count,
      count(*) filter (where checkpoint.status in ('COMPLETED','BUDGET_LIMITED'))::bigint as fresh_completed_count,
      count(*) filter (where checkpoint.status = 'SKIPPED_RECENT')::bigint as skipped_recent_count,
      count(*) filter (where checkpoint.status = 'SKIPPED_ACTIVE')::bigint as skipped_active_count,
      count(*) filter (where checkpoint.status in ('REUSED_RECENT','REUSED_ACTIVE'))::bigint as reused_count,
      coalesce(sum(checkpoint.result_count), 0)::bigint as raw_hit_count,
      coalesce(array_agg(distinct checkpoint.stop_reason) filter (where checkpoint.status = 'BUDGET_LIMITED' and checkpoint.stop_reason is not null), '{}'::text[]) as blocked_periods
    from public.ai_acquisition_discovery_checkpoints checkpoint
    where checkpoint.task_id = any(p_task_ids)
    group by checkpoint.task_id
  )
  select
    aggregate_progress.task_id,
    aggregate_progress.total_count,
    aggregate_progress.terminal_count,
    aggregate_progress.fresh_completed_count,
    aggregate_progress.skipped_recent_count,
    aggregate_progress.skipped_active_count,
    aggregate_progress.reused_count,
    aggregate_progress.raw_hit_count,
    active_checkpoint.country,
    active_checkpoint.query_text,
    active_checkpoint.status,
    active_checkpoint.updated_at,
    aggregate_progress.blocked_periods
  from aggregate_progress
  left join lateral (
    select checkpoint.country, checkpoint.query_text, checkpoint.status, checkpoint.updated_at
    from public.ai_acquisition_discovery_checkpoints checkpoint
    where checkpoint.task_id = aggregate_progress.task_id
      and checkpoint.status in ('RUNNING','PAUSED')
    order by checkpoint.updated_at desc
    limit 1
  ) active_checkpoint on true;
$$;

revoke all on function public.get_ai_acquisition_discovery_progress(uuid[]) from public, anon, authenticated;
grant execute on function public.get_ai_acquisition_discovery_progress(uuid[]) to service_role;

commit;
