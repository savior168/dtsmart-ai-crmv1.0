-- Separate terminal execution state from business conclusion state. A
-- completed review must never be counted as a pending analysis.

alter table public.ai_screening_tasks
  add column if not exists review_count integer not null default 0;

create or replace function public.refresh_ai_screening_task_totals(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_screening_tasks t
  set success_count = x.success_count,
      review_count = x.review_count,
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
      select i.*, r.target_decision, coalesce(r.is_latest_valid, false) as has_valid_result
      from public.ai_screening_task_items i
      left join lateral (
        select result.target_decision, result.is_latest_valid
        from public.ai_screening_results result
        where result.task_item_id = i.id and result.writeback_status = 'COMPLETED'
        order by result.completed_at desc nulls last, result.created_at desc
        limit 1
      ) r on true
      where i.task_id = p_task_id
    ), calls as (
      select coalesce(sum(input_tokens), 0)::bigint input_tokens,
             coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
             coalesce(sum(output_tokens), 0)::bigint output_tokens,
             coalesce(sum(total_tokens), 0)::bigint total_tokens,
             coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd,
             count(*)::integer call_count
      from public.ai_screening_model_calls where task_id = p_task_id
    ), totals as (
      select
        count(*) filter (where analysis_status = 'COMPLETED' and writeback_status = 'COMPLETED' and has_valid_result and target_decision in ('VALID','INVALID'))::integer success_count,
        count(*) filter (where analysis_status = 'COMPLETED' and writeback_status = 'COMPLETED' and has_valid_result and coalesce(target_decision, 'REVIEW') = 'REVIEW')::integer review_count,
        count(*) filter (where analysis_status = 'FAILED' or writeback_status = 'FAILED')::integer failed_count,
        count(*) filter (where analysis_status = 'COMPLETED' or analysis_status = 'FAILED' or writeback_status = 'FAILED')::integer processed_count,
        count(*) filter (where analysis_status in ('PENDING','RUNNING') and writeback_status not in ('COMPLETED','FAILED'))::integer pending_count,
        coalesce(sum(input_tokens), 0)::bigint input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint output_tokens,
        coalesce(sum(total_tokens), 0)::bigint total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd
      from items
    )
    select totals.success_count, totals.review_count, totals.failed_count, totals.processed_count, totals.pending_count,
           case when calls.call_count > 0 then calls.input_tokens else totals.input_tokens end input_tokens,
           case when calls.call_count > 0 then calls.cached_input_tokens else totals.cached_input_tokens end cached_input_tokens,
           case when calls.call_count > 0 then calls.output_tokens else totals.output_tokens end output_tokens,
           case when calls.call_count > 0 then calls.total_tokens else totals.total_tokens end total_tokens,
           case when calls.call_count > 0 then calls.total_cost_usd else totals.total_cost_usd end total_cost_usd
    from totals cross join calls
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid) from public, anon, authenticated;

do $$
declare task_row record;
begin
  for task_row in select id from public.ai_screening_tasks loop
    perform public.refresh_ai_screening_task_totals(task_row.id);
  end loop;
end;
$$;
