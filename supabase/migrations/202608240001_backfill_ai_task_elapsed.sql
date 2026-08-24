-- Backfill accurate execution duration for tasks created before elapsed_ms was introduced.
-- Idempotent: only tasks without a positive elapsed value are updated.

update public.ai_screening_tasks
set
  elapsed_ms = greatest(
    0,
    floor(extract(epoch from (coalesce(finished_at, completed_at, updated_at) - started_at)) * 1000)::bigint
  ),
  finished_at = coalesce(finished_at, completed_at, updated_at)
where started_at is not null
  and coalesce(finished_at, completed_at, updated_at) is not null
  and coalesce(elapsed_ms, 0) <= 0
  and status in ('COMPLETED', 'FAILED', 'CANCELLED');
