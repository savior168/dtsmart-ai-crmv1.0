-- Store a task-level failure separately from individual customer failures.
alter table if exists public.ai_screening_tasks
  add column if not exists error_message text;
