begin;

-- Historical acquisition reviews used to include customers whose target
-- business, identity and traceable evidence were already confirmed, but for
-- whom no sourced phone/email/WhatsApp was found. A salesperson cannot resolve
-- that technical enrichment gap by reviewing the same evidence. Keep genuine
-- identity/evidence conflicts in REVIEW and archive only deterministic rows.
create temporary table tmp_deterministic_review_resolution on commit drop as
select
  candidate.id as candidate_id,
  candidate.task_id,
  candidate.staging_customer_id as customer_id,
  candidate.is_target_customer,
  result.score,
  result.grade
from public.ai_acquisition_candidates candidate
join public.ai_screening_results result
  on result.task_item_id = candidate.screening_task_item_id
 and result.is_latest_valid = true
where candidate.decision = 'REVIEW'
  and candidate.staging_customer_id is not null
  and result.automation_status = 'AUTO_DEVELOP'
  and result.target_decision = 'VALID'
  and result.score >= 60
  and result.identity_status in ('MATCHED', 'LIKELY_MATCHED')
  and exists (
    select 1
    from public.ai_screening_evidence evidence
    where evidence.task_item_id = candidate.screening_task_item_id
      and evidence.source_url ~* '^https?://'
      and coalesce(evidence.evidence_strength, '') <> 'WEAK_HINT'
  )
  and not exists (
    select 1
    from public.customer_contacts contact
    where contact.customer_id = candidate.staging_customer_id
      and contact.type in ('PHONE', 'EMAIL', 'WHATSAPP')
      and contact.verification_status in ('NEW_VERIFIED', 'SOURCE_CONFIRMED', 'MATCHED_ORIGINAL')
      and contact.exact_source_url ~* '^https?://'
  );

update public.ai_acquisition_candidates candidate
set decision = 'REJECTED',
    decision_reason = case
      when resolution.is_target_customer then '已确认目标行业、主体和经营证据，但公开渠道暂未发现带具体来源的有效联系方式；已自动归档为暂不可触达，不进入人工复核'
      else '已完成主体和经营证据核验，但核验行业与任务目标不一致且无有效联系方式；已自动排除，不进入人工复核'
    end,
    imported_customer_id = null,
    ai_score = resolution.score,
    ai_level = resolution.grade,
    has_actionable_contact = false,
    evidence_complete = true,
    processed_at = now(),
    updated_at = now()
from tmp_deterministic_review_resolution resolution
where candidate.id = resolution.candidate_id
  and candidate.decision = 'REVIEW';

update public.customers customer
set pool_status = 'INVALID',
    acquisition_scope = 'PRIVATE',
    deleted_at = coalesce(customer.deleted_at, now()),
    updated_at = now()
from tmp_deterministic_review_resolution resolution
where customer.id = resolution.customer_id
  and customer.pool_status = 'AI_STAGING'
  and customer.acquisition_scope = 'PRIVATE';

update public.ai_acquisition_tasks task
set processed_count = totals.accepted + totals.review + totals.rejected + totals.duplicate,
    accepted_count = totals.accepted,
    review_count = totals.review,
    rejected_count = totals.rejected,
    duplicate_count = totals.duplicate,
    updated_at = now()
from (
  select candidate.task_id,
    count(*) filter (where candidate.decision = 'ACCEPTED')::integer as accepted,
    count(*) filter (where candidate.decision = 'REVIEW')::integer as review,
    count(*) filter (where candidate.decision = 'REJECTED')::integer as rejected,
    count(*) filter (where candidate.decision = 'DUPLICATE')::integer as duplicate
  from public.ai_acquisition_candidates candidate
  where candidate.task_id in (select distinct task_id from tmp_deterministic_review_resolution)
  group by candidate.task_id
) totals
where task.id = totals.task_id;

commit;
