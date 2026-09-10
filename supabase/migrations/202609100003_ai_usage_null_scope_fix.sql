-- 全系统历史汇总以 NULL 表示不限制归属人；此前生产函数把 NULL 当成
-- user_id = NULL，导致完成次数、Token 和 OpenAI 台账金额全部错误显示为 0。
create or replace function public.ai_screening_usage_totals(p_user_id uuid)
returns table (
  processed bigint,
  input_tokens numeric,
  cached_input_tokens numeric,
  output_tokens numeric,
  total_tokens numeric,
  cost_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with completion as (
    select count(*)::bigint as processed
    from public.ai_screening_completion_ledger c
    where p_user_id is null or c.user_id = p_user_id
  ), usage as (
    select
      coalesce(sum(u.input_tokens), 0)::numeric as input_tokens,
      coalesce(sum(u.cached_input_tokens), 0)::numeric as cached_input_tokens,
      coalesce(sum(u.output_tokens), 0)::numeric as output_tokens,
      coalesce(sum(u.total_tokens), 0)::numeric as total_tokens,
      coalesce(sum(u.cost_usd), 0)::numeric as cost_usd
    from public.ai_screening_usage_ledger u
    where p_user_id is null or u.user_id = p_user_id
  )
  select completion.processed, usage.input_tokens, usage.cached_input_tokens,
    usage.output_tokens, usage.total_tokens, usage.cost_usd
  from completion cross join usage;
$$;

revoke all on function public.ai_screening_usage_totals(uuid) from public;
grant execute on function public.ai_screening_usage_totals(uuid) to service_role;
