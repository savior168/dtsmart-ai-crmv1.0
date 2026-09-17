begin;

-- target_count is an internal safety ceiling, not a promise that this many
-- qualified customers exist. The previous 500-row constraint prevented broad
-- country/industry discovery even when the workflow was configured higher.
alter table public.ai_acquisition_tasks
  drop constraint if exists ai_acquisition_tasks_target_count_check;
alter table public.ai_acquisition_tasks
  add constraint ai_acquisition_tasks_target_count_check
  check (target_count between 1 and 5000);

-- A recent identical Google search is reused from the durable checkpoint.
-- These states distinguish useful cache reuse from an uncovered skipped scope.
alter table public.ai_acquisition_discovery_checkpoints
  drop constraint if exists ai_acquisition_discovery_checkpoints_status_check;
alter table public.ai_acquisition_discovery_checkpoints
  add constraint ai_acquisition_discovery_checkpoints_status_check
  check (status in (
    'PENDING','RUNNING','PAUSED','COMPLETED','BUDGET_LIMITED',
    'SKIPPED_RECENT','SKIPPED_ACTIVE','REUSED_RECENT','REUSED_ACTIVE'
  ));

commit;
