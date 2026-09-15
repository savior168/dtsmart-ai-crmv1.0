begin;

alter table public.ai_acquisition_tasks
  add column if not exists industries text[] not null default '{}';

update public.ai_acquisition_tasks
set industries = array[industry]
where cardinality(industries) = 0 and nullif(trim(industry), '') is not null;

alter table public.ai_acquisition_tasks
  drop constraint if exists ai_acquisition_tasks_industries_check;
alter table public.ai_acquisition_tasks
  add constraint ai_acquisition_tasks_industries_check
  check (cardinality(industries) between 1 and 12);

create or replace function public.get_ai_acquisition_usage_summary(p_task_id uuid)
returns jsonb
language sql security definer set search_path = public
as $$
  with related_tasks as (
    select p_task_id as id
    union
    select distinct screening_task_id from public.ai_acquisition_candidates
    where task_id=p_task_id and screening_task_id is not null
  ), ledger as (
    select l.* from public.api_cost_ledger l join related_tasks r on r.id=l.task_id
  ), sku as (
    select provider,coalesce(model_or_sku,'未标记') as model_or_sku,operation,
      count(*)::integer as calls,
      count(*) filter (where amount_type='FREE')::integer as free_calls,
      coalesce(sum(amount_usd),0)::numeric as amount_usd
    from ledger group by provider,coalesce(model_or_sku,'未标记'),operation
  )
  select jsonb_build_object(
    'total_calls',(select count(*) from ledger),
    'free_calls',(select count(*) from ledger where amount_type='FREE'),
    'google_calls',(select count(*) from ledger where provider='GOOGLE_PLACES'),
    'openai_calls',(select count(*) from ledger where provider='OPENAI'),
    'total_cost_usd',coalesce((select sum(amount_usd) from ledger),0),
    'sku_breakdown',coalesce((select jsonb_agg(to_jsonb(sku) order by amount_usd desc,calls desc) from sku),'[]'::jsonb)
  );
$$;
revoke all on function public.get_ai_acquisition_usage_summary(uuid) from public,anon,authenticated;

commit;
