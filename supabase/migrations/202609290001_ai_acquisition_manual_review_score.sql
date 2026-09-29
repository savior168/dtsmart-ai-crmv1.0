begin;

-- Keep the AI assessment immutable. Only REVIEW candidates may receive a
-- separate human assessment; all changes are archived in the same transaction.
alter table public.ai_acquisition_candidates
  add column if not exists manual_score integer check (manual_score between 0 and 100),
  add column if not exists manual_level text check (manual_level in ('A','B','C','D')),
  add column if not exists manual_target_decision text check (manual_target_decision in ('VALID','INVALID')),
  add column if not exists manual_industry text,
  add column if not exists manual_reason text,
  add column if not exists manual_evidence_ids uuid[] not null default '{}',
  add column if not exists manual_reviewed_by uuid references public.users(id) on delete set null,
  add column if not exists manual_reviewed_at timestamptz,
  add column if not exists effective_score integer generated always as (coalesce(manual_score, ai_score)) stored,
  add column if not exists effective_level text generated always as (coalesce(manual_level, ai_level)) stored;

alter table public.customers
  add column if not exists ai_score_source text check (ai_score_source in ('AI','MANUAL_REVIEW'));

create table if not exists public.ai_acquisition_manual_review_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.ai_acquisition_candidates(id) on delete cascade,
  task_id uuid not null references public.ai_acquisition_tasks(id) on delete cascade,
  previous_review jsonb not null,
  current_review jsonb not null,
  changed_by uuid references public.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists ai_acquisition_manual_review_history_candidate_idx
  on public.ai_acquisition_manual_review_history(candidate_id, changed_at desc);
alter table public.ai_acquisition_manual_review_history enable row level security;
revoke all on public.ai_acquisition_manual_review_history from anon, authenticated;

create or replace function public.archive_ai_acquisition_manual_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if row(new.manual_score, new.manual_level, new.manual_target_decision,
         new.manual_industry, new.manual_reason, new.manual_evidence_ids)
     is distinct from
     row(old.manual_score, old.manual_level, old.manual_target_decision,
         old.manual_industry, old.manual_reason, old.manual_evidence_ids) then
    if new.manual_score is not null and (old.decision <> 'REVIEW' or new.decision <> 'REVIEW') then
      raise exception 'Manual scoring is limited to pending-review candidates';
    end if;
    insert into public.ai_acquisition_manual_review_history
      (candidate_id, task_id, previous_review, current_review, changed_by)
    values (
      new.id, new.task_id,
      jsonb_build_object('score', old.manual_score, 'level', old.manual_level,
        'target_decision', old.manual_target_decision, 'industry', old.manual_industry,
        'reason', old.manual_reason, 'evidence_ids', old.manual_evidence_ids),
      jsonb_build_object('score', new.manual_score, 'level', new.manual_level,
        'target_decision', new.manual_target_decision, 'industry', new.manual_industry,
        'reason', new.manual_reason, 'evidence_ids', new.manual_evidence_ids),
      new.manual_reviewed_by
    );
  end if;
  return new;
end;
$$;
drop trigger if exists archive_ai_acquisition_manual_review on public.ai_acquisition_candidates;
create trigger archive_ai_acquisition_manual_review
after update of manual_score, manual_level, manual_target_decision, manual_industry,
  manual_reason, manual_evidence_ids on public.ai_acquisition_candidates
for each row execute function public.archive_ai_acquisition_manual_review();

commit;
