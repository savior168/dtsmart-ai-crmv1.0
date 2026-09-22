begin;

create or replace function public.get_ai_acquisition_task_center_usage(p_task_ids uuid[])
returns table (
  task_id uuid,
  google_calls bigint,
  openai_calls bigint,
  total_tokens bigint,
  openai_cost_usd numeric,
  google_cost_usd numeric,
  total_cost_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select distinct unnest(coalesce(p_task_ids, '{}'::uuid[])) as requested_task_id
  ), related as (
    select requested_task_id, requested_task_id as ledger_task_id from requested
    union
    select requested.requested_task_id, screening.id
    from requested
    join public.ai_screening_tasks screening
      on screening.request_key = 'acquisition:' || requested.requested_task_id::text
  ), ledger as (
    select related.requested_task_id, cost.*
    from related
    join public.api_cost_ledger cost on cost.task_id = related.ledger_task_id
  )
  select
    requested.requested_task_id as task_id,
    count(*) filter (where ledger.provider = 'GOOGLE_PLACES')::bigint as google_calls,
    count(*) filter (where ledger.provider = 'OPENAI')::bigint as openai_calls,
    coalesce(sum(coalesce(ledger.input_tokens, 0) + coalesce(ledger.output_tokens, 0)) filter (where ledger.provider = 'OPENAI'), 0)::bigint as total_tokens,
    coalesce(sum(ledger.amount_usd) filter (where ledger.provider = 'OPENAI'), 0)::numeric as openai_cost_usd,
    coalesce(sum(ledger.amount_usd) filter (where ledger.provider = 'GOOGLE_PLACES' and ledger.amount_type in ('FINAL', 'FREE')), 0)::numeric as google_cost_usd,
    (
      coalesce(sum(ledger.amount_usd) filter (where ledger.provider = 'OPENAI'), 0)
      + coalesce(sum(ledger.amount_usd) filter (where ledger.provider = 'GOOGLE_PLACES' and ledger.amount_type in ('FINAL', 'FREE')), 0)
    )::numeric as total_cost_usd
  from requested
  left join ledger on ledger.requested_task_id = requested.requested_task_id
  group by requested.requested_task_id;
$$;

revoke all on function public.get_ai_acquisition_task_center_usage(uuid[]) from public, anon, authenticated;

commit;
