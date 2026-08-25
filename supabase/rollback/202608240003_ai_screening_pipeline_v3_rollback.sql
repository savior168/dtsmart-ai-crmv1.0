-- Compatibility rollback for AI screening v3.
-- This intentionally preserves newly collected evidence/stage data and only restores
-- the previous task totals behavior. Roll application code back to the recorded
-- production commit before running this file.

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
    select
      count(*) filter (where status = 'COMPLETED')::integer success_count,
      count(*) filter (where status = 'FAILED')::integer failed_count,
      count(*) filter (where status in ('COMPLETED','FAILED'))::integer processed_count,
      count(*) filter (where status in ('PENDING','RUNNING'))::integer pending_count,
      coalesce(sum(input_tokens), 0)::bigint input_tokens,
      coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint output_tokens,
      coalesce(sum(total_tokens), 0)::bigint total_tokens,
      coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd
    from public.ai_screening_task_items where task_id = p_task_id
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid) from public, anon, authenticated;
