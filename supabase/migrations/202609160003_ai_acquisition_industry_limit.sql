begin;

alter table public.ai_acquisition_tasks
  drop constraint if exists ai_acquisition_tasks_industries_check;
alter table public.ai_acquisition_tasks
  add constraint ai_acquisition_tasks_industries_check
  check (cardinality(industries) between 1 and 20);

commit;
