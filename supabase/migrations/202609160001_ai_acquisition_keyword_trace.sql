begin;

alter table public.ai_acquisition_candidates
  add column if not exists matched_keywords text[] not null default '{}';

alter table public.ai_acquisition_tasks
  add column if not exists current_stage text not null default 'WAITING',
  add column if not exists current_stage_detail text;

alter table public.ai_acquisition_tasks drop constraint if exists ai_acquisition_tasks_current_stage_check;
alter table public.ai_acquisition_tasks add constraint ai_acquisition_tasks_current_stage_check
  check (current_stage in ('WAITING','DISCOVERY','DEDUPLICATING','VERIFYING','FINALIZING','FINISHED','FAILED','CANCELLED'));

alter table public.customers
  add column if not exists acquisition_match_keywords text[] not null default '{}';

comment on column public.ai_acquisition_candidates.matched_keywords is
  'Ordered localized search terms that matched this candidate during AI acquisition.';
comment on column public.ai_acquisition_tasks.current_stage is
  'Durable real execution stage shown in acquisition progress; never inferred only in the browser.';
comment on column public.customers.acquisition_match_keywords is
  'Ordered AI acquisition search terms retained after the customer passes the quality gate.';

commit;
