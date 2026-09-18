begin;

create or replace function public.get_ai_acquisition_usage_summary(p_task_id uuid)
returns jsonb
language sql security definer set search_path = public
as $$
  with related_tasks as (
    select p_task_id as id
    union
    select screening.id
    from public.ai_screening_tasks screening
    where screening.request_key = 'acquisition:' || p_task_id::text
  ), ledger as (
    select cost.*
    from public.api_cost_ledger cost
    join related_tasks related on related.id = cost.task_id
  ), sku as (
    select provider, coalesce(model_or_sku, '未标记') as model_or_sku, operation,
      count(*)::integer as calls,
      count(*) filter (where amount_type = 'FREE')::integer as free_calls,
      coalesce(sum(amount_usd), 0)::numeric as amount_usd
    from ledger
    group by provider, coalesce(model_or_sku, '未标记'), operation
  )
  select jsonb_build_object(
    'total_calls', (select count(*) from ledger),
    'free_calls', (select count(*) from ledger where amount_type = 'FREE'),
    'google_calls', (select count(*) from ledger where provider = 'GOOGLE_PLACES'),
    'openai_calls', (select count(*) from ledger where provider = 'OPENAI'),
    'total_cost_usd', coalesce((select sum(amount_usd) from ledger), 0),
    'sku_breakdown', coalesce((select jsonb_agg(to_jsonb(sku) order by amount_usd desc, calls desc) from sku), '[]'::jsonb)
  );
$$;

revoke all on function public.get_ai_acquisition_usage_summary(uuid) from public, anon, authenticated;

commit;
