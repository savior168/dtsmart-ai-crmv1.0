-- Candidate writes are staged through multiple workflow branches. Keep the
-- database invariant self-contained so a partial or older worker cannot make
-- a nullable boolean break an otherwise safe discovery batch.
alter table public.ai_acquisition_candidates
  alter column has_actionable_contact set default false,
  alter column evidence_complete set default false;

update public.ai_acquisition_candidates
set has_actionable_contact = false
where has_actionable_contact is null;

update public.ai_acquisition_candidates
set evidence_complete = false
where evidence_complete is null;

alter table public.ai_acquisition_candidates
  alter column has_actionable_contact set not null,
  alter column evidence_complete set not null;
