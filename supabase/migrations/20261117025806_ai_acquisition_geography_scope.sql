-- Optional per-country state/city targets. Existing tasks keep the original
-- nationwide search plan through the empty-object default.
alter table public.ai_acquisition_tasks
  add column if not exists geography_scopes jsonb not null default '{}'::jsonb;

alter table public.ai_acquisition_tasks
  add constraint ai_acquisition_tasks_geography_scopes_object_check
  check (jsonb_typeof(geography_scopes) = 'object');
