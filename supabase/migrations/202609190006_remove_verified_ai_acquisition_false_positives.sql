-- Remove verified historical AI-acquisition false positives from the public
-- pool without destroying their evidence trail. Only unclaimed/unprotected
-- AVAILABLE customers are eligible; assigned customer records are untouched.
begin;

create temporary table tmp_ai_false_positives (
  candidate_id uuid primary key,
  verified_industry text not null,
  reason text not null
) on commit drop;

insert into tmp_ai_false_positives (candidate_id, verified_industry, reason) values
('d56fd277-686a-4ff3-b57b-6c1a0ba5af4f','其他','官网与Google商家均显示汽车配件业务，不经营手机或电脑维修内配件'),
('1e7bf84c-7b37-44d2-990e-fccc3af8d5b6','其他','官网与Google商家均显示汽车配件及汽车电池业务'),
('b20d214e-3691-4be3-bdc6-e991ada76e09','其他','官网与Google商家均显示汽车配件业务'),
('bcaf6e8a-5ff4-4707-8f1a-f0d1ec870c74','其他','Google商家明确分类为汽车配件店'),
('3b3916f1-2d92-4538-9e8f-37324a3b770b','其他','Google商家明确分类为电气设备与太阳能设备供应商'),
('75f8d24b-4342-4324-bf17-60b7074affd7','其他','官网明确经营电子烟、烟草及水烟产品批发'),
('4677b1a1-5629-46f6-95a4-f0417e7291b6','软件或IT服务','官网与Google商家显示数字营销、网站及电信服务业务'),
('9284aa94-f197-4565-a369-8ccbae4a803e','其他','官网与Google商家均显示汽车配件业务'),
('ea41ea32-4e59-4705-b2d4-17976ce84cca','其他','官网明确经营废旧电脑回收、IT资产处置及清运服务'),
('12adf15e-6b06-4cb2-aa1a-db85c7e8baf6','其他','Google商家明确分类为汽车配件业务'),
('c06005ec-ba59-4a7b-b910-0be71a4d8770','其他','Google商家明确分类为汽车配件业务'),
('cedbc55f-0fba-45dd-8205-e4e74ae31314','其他','Google商家明确分类为汽车配件业务'),
('557bf26d-bf89-45f8-804f-ab86c0e6f14a','其他','Google商家明确分类为汽车配件业务'),
('3e6f853b-3a0d-4810-8ea4-aa7f6aa64ef8','其他','Google商家明确分类为汽车配件业务'),
('4b908d94-0e24-4a06-b891-a36b50a08675','其他','Google商家明确分类为电气及照明产品批发商'),
('5f0cc5c7-1f8a-4a34-bacc-596af4a2adc4','其他','官网与Google商家均显示汽车配件业务'),
('860747ed-a110-4272-b565-e6a7b98af341','其他','官网与Google商家均显示汽车配件业务'),
('1a3310ea-9a0e-4762-8de1-97664e88df8f','其他','官网与Google商家均显示汽车配件业务'),
('fb60a8a9-bcc5-41c4-9db2-d936019bb5d0','其他','官网与Google商家均显示汽车配件业务'),
('7a0d20bb-07b5-47b3-a649-32f08a8ebcd3','其他','官网与Google商家均显示汽车配件业务'),
('e2efbc39-b7c2-45e8-a853-2ed599c5fe6c','其他','官网与Google商家显示卡车、农机及汽车配件业务'),
('4013c298-39b7-4bd8-b55e-ef5b02a967a6','其他','官网明确经营汽车配件业务'),
('ae90ec1e-fccf-4681-b404-779bfacdf6f7','食品批发或餐饮供应','官网与Google商家均明确显示果蔬及生鲜食品批发业务'),
('0b57224d-25d0-464c-929f-f7020dd1a872','其他','Google商家显示电子产品及家居用品批发，未核验到目标维修内配件业务'),
('9d890ce4-cf32-472c-9038-5e47762ec157','其他','官网与Google商家显示紧固件、船舶、工具及焊接用品业务'),
('3a116c71-bd33-470d-b64b-9b1016c1d83e','其他','官网与Google商家均显示轮胎及汽车配件业务');

-- Preserve a complete recovery trail before changing any business state.
insert into public.audit_logs (user_id, organization_id, action, target_type, target_id, content, before_data, after_data, result)
select t.user_id, cu.organization_id, 'AI_ACQUISITION_FALSE_POSITIVE_REMOVED', 'customer', cu.id,
       jsonb_build_object('candidate_id', c.id, 'task_id', c.task_id, 'task_number', t.task_number,
                          'verified_industry', fp.verified_industry, 'reason', fp.reason),
       jsonb_build_object('pool_status', cu.pool_status, 'deleted_at', cu.deleted_at, 'ai_score', cu.ai_score,
                          'ai_level', cu.ai_level, 'is_target_customer', cu.is_target_customer),
       jsonb_build_object('pool_status', 'INVALID', 'deleted_at', now(), 'ai_level', 'D',
                          'is_target_customer', false),
       'SUCCESS'
from tmp_ai_false_positives fp
join public.ai_acquisition_candidates c on c.id = fp.candidate_id
join public.ai_acquisition_tasks t on t.id = c.task_id
join public.customers cu on cu.id = c.imported_customer_id
where c.decision = 'ACCEPTED'
  and cu.pool_status = 'AVAILABLE' and cu.deleted_at is null
  and cu.owner_id is null and cu.owner_user_id is null and cu.current_protection_id is null;

-- Scores are recalculated from the non-target-safe evidence dimensions only;
-- product-fit values produced by the historical false-positive analysis are
-- deliberately excluded. This keeps scores evidence-dependent, not clustered.
with corrected as (
  select r.id, fp.verified_industry, fp.reason,
         greatest(5, least(39, round(
           coalesce((r.score_breakdown->>'entity_consistency')::numeric,0) * .05 +
           coalesce((r.score_breakdown->>'company_authenticity')::numeric,0) * .05 +
           coalesce((r.score_breakdown->>'business_activity')::numeric,0) * .03 +
           coalesce((r.score_breakdown->>'contactability')::numeric,0) * .02 +
           coalesce((r.score_breakdown->>'evidence_completeness')::numeric,0) * .03
         )))::integer as corrected_score
  from tmp_ai_false_positives fp
  join public.ai_acquisition_candidates c on c.id = fp.candidate_id
  join public.ai_screening_results r on r.task_item_id = c.screening_task_item_id and r.is_latest_valid = true
)
update public.ai_screening_results r
set score = corrected.corrected_score, grade = 'D', target_decision = 'INVALID',
    automation_status = 'AUTO_REJECT', decision_status = 'AUTO_REJECT', target_fit = 'NOT_TARGET',
    industry_type = corrected.verified_industry, customer_type = corrected.verified_industry,
    primary_industry = case corrected.verified_industry
      when '食品批发或餐饮供应' then 'FOOD_WHOLESALE'
      when '软件或IT服务' then 'SOFTWARE_IT_SERVICES'
      else 'OTHER_NON_TARGET' end,
    verified_industry = case corrected.verified_industry
      when '食品批发或餐饮供应' then 'FOOD_WHOLESALE'
      when '软件或IT服务' then 'SOFTWARE_IT_SERVICES'
      else 'OTHER_NON_TARGET' end,
    short_reason = corrected.reason,
    ai_reason = corrected.reason,
    business_relevance = '已核验主营行业与本次任务所需的手机、电脑维修内配件目标业务不匹配。',
    customer_value = '非本次任务目标客户，已从客户公海退出。',
    summary = '历史误判已纠正：' || corrected.reason || '。',
    lead_priority = 'LOW', priority = 'LOW', is_latest_valid = true, writeback_status = 'COMPLETED'
from corrected where r.id = corrected.id;

with corrected as (
  select c.id candidate_id, c.imported_customer_id customer_id, fp.verified_industry, fp.reason,
         coalesce(r.score, 5) corrected_score
  from tmp_ai_false_positives fp
  join public.ai_acquisition_candidates c on c.id = fp.candidate_id
  left join public.ai_screening_results r on r.task_item_id = c.screening_task_item_id and r.is_latest_valid = true
)
update public.customers cu
set industry = corrected.verified_industry, customer_type = corrected.verified_industry,
    ai_score = corrected.corrected_score, ai_level = 'D', is_target_customer = false,
    ai_reason = corrected.reason,
    business_relevance = '已核验主营行业与本次任务目标业务不匹配。',
    customer_value = '非本次任务目标客户，已从客户公海退出。',
    pool_status = 'INVALID', acquisition_scope = 'PRIVATE', deleted_at = coalesce(cu.deleted_at, now()),
    updated_at = now()
from corrected
where cu.id = corrected.customer_id and cu.pool_status = 'AVAILABLE' and cu.deleted_at is null
  and cu.owner_id is null and cu.owner_user_id is null and cu.current_protection_id is null;

with corrected as (
  select c.id, fp.reason, coalesce(r.score, 5) corrected_score
  from tmp_ai_false_positives fp
  join public.ai_acquisition_candidates c on c.id = fp.candidate_id
  left join public.ai_screening_results r on r.task_item_id = c.screening_task_item_id and r.is_latest_valid = true
)
update public.ai_acquisition_candidates c
set decision = 'REJECTED', decision_reason = '历史误判复核：' || corrected.reason,
    imported_customer_id = null, ai_score = corrected.corrected_score, ai_level = 'D',
    is_target_customer = false, processed_at = now(), updated_at = now()
from corrected where c.id = corrected.id and c.decision = 'ACCEPTED';

update public.ai_acquisition_tasks task
set accepted_count = counts.accepted_count, rejected_count = counts.rejected_count,
    duplicate_count = counts.duplicate_count, review_count = counts.review_count,
    processed_count = counts.processed_count, updated_at = now()
from (
  select c.task_id,
    count(*) filter (where c.decision = 'ACCEPTED')::integer accepted_count,
    count(*) filter (where c.decision = 'REJECTED')::integer rejected_count,
    count(*) filter (where c.decision = 'DUPLICATE')::integer duplicate_count,
    count(*) filter (where c.decision = 'REVIEW')::integer review_count,
    count(*) filter (where c.decision in ('ACCEPTED','REJECTED','DUPLICATE','REVIEW','FAILED'))::integer processed_count
  from public.ai_acquisition_candidates c
  where c.task_id in (select distinct c2.task_id from tmp_ai_false_positives fp join public.ai_acquisition_candidates c2 on c2.id=fp.candidate_id)
  group by c.task_id
) counts where task.id = counts.task_id;

commit;
