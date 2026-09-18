-- Correct a verified false positive: The Toughphone Ltd manufactures/sells
-- finished rugged phones. Customer reviews describing warranty returns are
-- not evidence that the company sells repair services to the public.
update public.ai_screening_evidence
set evidence_type = '中性',
    evidence_strength = 'WEAK_HINT',
    supports = null,
    translated_fact = 'Google评论仅描述该品牌成品手机的返修和售后争议，不能证明企业对外经营手机维修服务。',
    normalized_fact = 'Google评论仅描述该品牌成品手机的返修和售后争议，不能证明企业对外经营手机维修服务。',
    content = 'Google评论仅描述该品牌成品手机的返修和售后争议，不能证明企业对外经营手机维修服务。'
where id = '682d38f6-99cf-431a-ae1a-f729a1de4eed'::uuid;

update public.ai_screening_results
set score = 24,
    grade = 'D',
    target_decision = 'INVALID',
    automation_status = 'AUTO_REJECT',
    decision_status = 'AUTO_REJECT',
    target_fit = 'NOT_TARGET',
    industry_type = '手机成品零售',
    customer_type = '手机成品零售',
    primary_industry = 'MOBILE_PHONE_RETAILER',
    verified_industry = 'MOBILE_PHONE_RETAILER',
    summary = '公开证据显示该企业制造或销售三防手机成品；评论中的返修经历属于成品售后，不能证明其对外经营维修服务。',
    short_reason = '已确认属于手机成品制造或销售，缺少对外维修或维修内配件经营证据。',
    ai_reason = 'Google商家类别为制造商，评论描述的是该品牌手机返修和售后争议，不是顾客购买维修服务的证据。',
    business_relevance = '手机成品制造或销售不属于本任务的维修及维修内配件目标客户。',
    customer_value = '非目标客户，不进入客户公海。',
    business_scope = '主营业务：三防手机成品制造或销售；未核验到对外手机电脑维修或维修内配件销售业务。',
    evidence_sufficiency = '充分',
    evidence_sufficiency_score = 80,
    industry_confidence = 90,
    decision_confidence = 90,
    is_latest_valid = true,
    writeback_status = 'COMPLETED'
where id = '48176f7b-5ce4-4d6b-9cb4-f161f35e1ce8'::uuid;

update public.customers
set industry = '手机成品零售',
    ai_score = 24,
    ai_level = 'D',
    is_target_customer = false,
    business_scope = '主营业务：三防手机成品制造或销售；未核验到对外手机电脑维修或维修内配件销售业务。',
    pool_status = 'INVALID',
    deleted_at = coalesce(deleted_at, now()),
    updated_at = now()
where id = '7f848bf0-d3db-4332-a643-64a95a8c6609'::uuid
  and owner_id is null
  and owner_user_id is null
  and status = 'UNCLAIMED';

update public.ai_acquisition_candidates
set decision = 'REJECTED',
    decision_reason = '已复核为三防手机成品制造或销售；返修评论不构成对外维修业务证据，未进入客户公海',
    imported_customer_id = null,
    ai_score = 24,
    ai_level = 'D',
    is_target_customer = false,
    processed_at = now(),
    updated_at = now()
where place_id = 'ChIJvXDLgBsWd0gRgB-f9zhmh00'
  and decision in ('ACCEPTED', 'DUPLICATE');

update public.ai_acquisition_tasks task
set accepted_count = counts.accepted_count,
    rejected_count = counts.rejected_count,
    duplicate_count = counts.duplicate_count,
    review_count = counts.review_count,
    processed_count = counts.processed_count,
    updated_at = now()
from (
  select task_id,
    count(*) filter (where decision = 'ACCEPTED')::integer as accepted_count,
    count(*) filter (where decision = 'REJECTED')::integer as rejected_count,
    count(*) filter (where decision = 'DUPLICATE')::integer as duplicate_count,
    count(*) filter (where decision = 'REVIEW')::integer as review_count,
    count(*) filter (where decision in ('ACCEPTED','REJECTED','DUPLICATE','REVIEW','FAILED'))::integer as processed_count
  from public.ai_acquisition_candidates
  where task_id in (
    '6ba13d38-8f41-4ec2-804d-d50d4931bb87'::uuid,
    'fd9f6703-b517-46d4-9eda-4997ed9d10af'::uuid
  )
  group by task_id
) counts
where task.id = counts.task_id;
