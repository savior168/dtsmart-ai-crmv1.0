begin;

-- Large acquisition tasks can contain thousands of screening items.  The old
-- totals function performed one lateral result lookup per item every time a
-- customer completed, which eventually exceeded statement_timeout and left
-- both progress and terminal task state stale.  Task-item terminal states are
-- already written only after the durable result/writeback boundary, so they
-- are the authoritative and substantially cheaper source for progress.
create index if not exists ai_screening_task_items_task_status_updated_idx
  on public.ai_screening_task_items(task_id, status, updated_at desc);

create or replace function public.refresh_ai_screening_task_totals(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_screening_tasks t
  set total_count = x.total_count,
      success_count = x.success_count,
      review_count = 0,
      failed_count = x.failed_count,
      processed_count = x.success_count + x.failed_count,
      pending_count = greatest(0, x.total_count - x.success_count - x.failed_count),
      input_tokens = x.input_tokens,
      cached_input_tokens = x.cached_input_tokens,
      output_tokens = x.output_tokens,
      total_tokens = x.total_tokens,
      total_cost_usd = x.total_cost_usd,
      updated_at = now()
  from (
    with item_totals as (
      select
        count(*)::integer as total_count,
        count(*) filter (
          where status = 'COMPLETED'
            and analysis_status = 'COMPLETED'
            and writeback_status in ('COMPLETED', 'WARNING')
        )::integer as success_count,
        count(*) filter (
          where status = 'FAILED'
             or analysis_status = 'FAILED'
             or writeback_status = 'FAILED'
        )::integer as failed_count,
        coalesce(sum(input_tokens), 0)::bigint as item_input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint as item_cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as item_output_tokens,
        coalesce(sum(total_tokens), 0)::bigint as item_total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) as item_total_cost_usd
      from public.ai_screening_task_items
      where task_id = p_task_id
    ), call_totals as (
      select
        count(*)::integer as call_count,
        coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) as total_cost_usd
      from public.ai_screening_model_calls
      where task_id = p_task_id
    )
    select
      i.total_count,
      i.success_count,
      i.failed_count,
      case when c.call_count > 0 then c.input_tokens else i.item_input_tokens end as input_tokens,
      case when c.call_count > 0 then c.cached_input_tokens else i.item_cached_input_tokens end as cached_input_tokens,
      case when c.call_count > 0 then c.output_tokens else i.item_output_tokens end as output_tokens,
      case when c.call_count > 0 then c.total_tokens else i.item_total_tokens end as total_tokens,
      case when c.call_count > 0 then c.total_cost_usd else i.item_total_cost_usd end as total_cost_usd
    from item_totals i cross join call_totals c
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid)
  from public, anon, authenticated;

commit;
