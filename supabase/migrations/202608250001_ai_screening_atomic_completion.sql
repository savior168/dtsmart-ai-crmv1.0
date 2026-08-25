-- AI screening is complete only after result, evidence and customer writeback
-- are all durable. Safe to execute repeatedly.

update public.ai_screening_results r
set is_latest_valid = false
where coalesce(r.is_latest_valid, true)
  and (
    coalesce(r.writeback_status, '') <> 'COMPLETED'
    or not exists (
      select 1 from public.ai_screening_evidence e where e.result_id = r.id
    )
  );

update public.ai_screening_task_items i
set status = 'FAILED',
    analysis_status = 'FAILED',
    writeback_status = 'FAILED',
    automation_status = 'ANALYSIS_FAILED',
    progress = 100,
    current_step = 'FAILED',
    pipeline_stage = 'FAILED',
    error_code = 'INCOMPLETE_ANALYSIS_PIPELINE',
    error_message = '历史分析结果未完成证据保存或客户写回，请重试该客户。',
    retryable = true,
    result_id = null,
    completed_at = now(),
    updated_at = now()
where i.result_id is not null
  and exists (
    select 1 from public.ai_screening_results r
    where r.id = i.result_id and not coalesce(r.is_latest_valid, false)
  );

update public.customers c
set ai_score = null,
    ai_level = null,
    ai_reason = null,
    is_target_customer = null,
    ai_screening_done = false,
    ai_status = 'PENDING',
    ai_last_result_id = null,
    ai_last_screened_at = null,
    updated_at = now()
where c.ai_last_result_id is not null
  and exists (
    select 1 from public.ai_screening_results r
    where r.id = c.ai_last_result_id and not coalesce(r.is_latest_valid, false)
  );

delete from public.ai_analysis_reuse_cache
where rule_version <> '2026.08.25.1'
   or evidence_schema_version <> '2026.08.25.1'
   or source_result_id is null
   or not exists (
     select 1 from public.ai_screening_results r
     where r.id = ai_analysis_reuse_cache.source_result_id
       and coalesce(r.is_latest_valid, false)
       and r.writeback_status = 'COMPLETED'
   );

create or replace function public.refresh_ai_screening_task_totals(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_screening_tasks t
  set success_count = x.success_count,
      failed_count = x.failed_count,
      processed_count = x.processed_count,
      pending_count = x.pending_count,
      input_tokens = x.input_tokens,
      cached_input_tokens = x.cached_input_tokens,
      output_tokens = x.output_tokens,
      total_tokens = x.total_tokens,
      total_cost_usd = x.total_cost_usd,
      updated_at = now()
  from (
    with items as (
      select i.*,
             exists (
               select 1
               from public.ai_screening_results r
               where r.task_item_id = i.id
                 and coalesce(r.is_latest_valid, false)
                 and r.writeback_status = 'COMPLETED'
                 and exists (
                   select 1 from public.ai_screening_evidence e where e.result_id = r.id
                 )
             ) as has_durable_result
      from public.ai_screening_task_items i
      where i.task_id = p_task_id
    ), calls as (
      select
        coalesce(sum(input_tokens), 0)::bigint input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint output_tokens,
        coalesce(sum(total_tokens), 0)::bigint total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd,
        count(*)::integer call_count
      from public.ai_screening_model_calls
      where task_id = p_task_id
    ), item_totals as (
      select
        count(*) filter (where analysis_status = 'COMPLETED' and writeback_status = 'COMPLETED' and has_durable_result)::integer success_count,
        count(*) filter (where analysis_status = 'FAILED' or writeback_status = 'FAILED')::integer failed_count,
        count(*) filter (where (analysis_status = 'COMPLETED' and writeback_status = 'COMPLETED' and has_durable_result) or analysis_status = 'FAILED' or writeback_status = 'FAILED')::integer processed_count,
        count(*) filter (where not ((analysis_status = 'COMPLETED' and writeback_status = 'COMPLETED' and has_durable_result) or analysis_status = 'FAILED' or writeback_status = 'FAILED'))::integer pending_count,
        coalesce(sum(input_tokens), 0)::bigint input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint output_tokens,
        coalesce(sum(total_tokens), 0)::bigint total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd
      from items
    )
    select i.success_count, i.failed_count, i.processed_count, i.pending_count,
           case when c.call_count > 0 then c.input_tokens else i.input_tokens end input_tokens,
           case when c.call_count > 0 then c.cached_input_tokens else i.cached_input_tokens end cached_input_tokens,
           case when c.call_count > 0 then c.output_tokens else i.output_tokens end output_tokens,
           case when c.call_count > 0 then c.total_tokens else i.total_tokens end total_tokens,
           case when c.call_count > 0 then c.total_cost_usd else i.total_cost_usd end total_cost_usd
    from item_totals i cross join calls c
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid) from public, anon, authenticated;

-- Recalculate every historical task after invalidating incomplete results so
-- completed/failed counters cannot keep the old false-success values.
do $$
declare
  task_row record;
begin
  for task_row in select id from public.ai_screening_tasks loop
    perform public.refresh_ai_screening_task_totals(task_row.id);
  end loop;
end;
$$;
