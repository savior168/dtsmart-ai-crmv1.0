-- Keep finance filters and the budget dashboard consistent with the
-- concurrency-safe reservation logic used before every paid API call.

create or replace function public.api_cost_budget_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_settings public.cost_center_settings%rowtype;
  v_day_start timestamptz := date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_week_start timestamptz := date_trunc('week', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_month_start timestamptz := date_trunc('month', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_result jsonb := '{}'::jsonb;
  v_provider text;
  v_day_committed numeric; v_week_committed numeric; v_month_committed numeric;
  v_day_reserved numeric; v_week_reserved numeric; v_month_reserved numeric;
  v_day_limit numeric; v_week_limit numeric; v_month_limit numeric;
  v_blocked bigint;
begin
  select * into v_settings from public.cost_center_settings where id=true;
  foreach v_provider in array array['GOOGLE_PLACES','OPENAI'] loop
    if v_provider='GOOGLE_PLACES' then
      v_day_limit:=v_settings.google_daily_limit_usd; v_week_limit:=v_settings.google_weekly_limit_usd; v_month_limit:=v_settings.google_monthly_limit_usd;
    else
      v_day_limit:=v_settings.openai_daily_limit_usd; v_week_limit:=v_settings.openai_weekly_limit_usd; v_month_limit:=v_settings.openai_monthly_limit_usd;
    end if;
    select coalesce(sum(amount_usd),0) into v_day_committed from public.api_cost_ledger where provider=v_provider and occurred_at>=v_day_start;
    select coalesce(sum(amount_usd),0) into v_week_committed from public.api_cost_ledger where provider=v_provider and occurred_at>=v_week_start;
    select coalesce(sum(amount_usd),0) into v_month_committed from public.api_cost_ledger where provider=v_provider and occurred_at>=v_month_start;
    select coalesce(sum(amount_usd),0) into v_day_reserved from public.api_cost_budget_reservations where provider=v_provider and released_at is null and expires_at>now() and created_at>=v_day_start;
    select coalesce(sum(amount_usd),0) into v_week_reserved from public.api_cost_budget_reservations where provider=v_provider and released_at is null and expires_at>now() and created_at>=v_week_start;
    select coalesce(sum(amount_usd),0) into v_month_reserved from public.api_cost_budget_reservations where provider=v_provider and released_at is null and expires_at>now() and created_at>=v_month_start;
    select count(*) into v_blocked from public.api_cost_budget_events where provider=v_provider and created_at>=v_month_start;
    v_result := v_result || jsonb_build_object(v_provider, jsonb_build_object(
      'daily_committed_usd',v_day_committed,'weekly_committed_usd',v_week_committed,'monthly_committed_usd',v_month_committed,
      'daily_reserved_usd',v_day_reserved,'weekly_reserved_usd',v_week_reserved,'monthly_reserved_usd',v_month_reserved,
      'daily_used_usd',v_day_committed+v_day_reserved,'weekly_used_usd',v_week_committed+v_week_reserved,'monthly_used_usd',v_month_committed+v_month_reserved,
      'monthly_blocked_count',v_blocked,'daily_limit_usd',v_day_limit,'weekly_limit_usd',v_week_limit,'monthly_limit_usd',v_month_limit
    ));
  end loop;
  return v_result;
end $$;

revoke all on function public.api_cost_budget_status() from public, anon, authenticated;
grant execute on function public.api_cost_budget_status() to service_role;

create or replace function public.cost_center_summary_multi_filtered(
  p_from timestamptz,
  p_to timestamptz,
  p_provider text default null,
  p_operation text default null,
  p_user_id uuid default null,
  p_task_ids uuid[] default null,
  p_customer_ids uuid[] default null
) returns jsonb language sql stable security invoker set search_path=public as $$
  with filtered as (
    select * from public.api_cost_ledger
    where occurred_at>=p_from and occurred_at<p_to
      and (p_provider is null or provider=p_provider)
      and (p_operation is null or operation ilike '%'||p_operation||'%' or model_or_sku ilike '%'||p_operation||'%')
      and (p_user_id is null or user_id=p_user_id)
      and (p_task_ids is null or task_id=any(p_task_ids))
      and (p_customer_ids is null or customer_id=any(p_customer_ids))
  ), provider_rows as (
    select provider,service,count(*) request_count,coalesce(sum(amount_usd),0) total_usd,
      coalesce(sum(amount_usd) filter(where amount_type='ESTIMATED'),0) estimated_usd
    from filtered group by provider,service order by total_usd desc
  )
  select jsonb_build_object(
    'total_usd',coalesce(sum(amount_usd),0),'request_count',count(*),
    'input_tokens',coalesce(sum(input_tokens),0),'cached_input_tokens',coalesce(sum(cached_input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),
    'estimated_usd',coalesce(sum(amount_usd) filter(where amount_type='ESTIMATED'),0),
    'final_usd',coalesce(sum(amount_usd) filter(where amount_type='FINAL'),0),
    'unknown_pricing_count',count(*) filter(where amount_type='ESTIMATED' and coalesce((pricing_snapshot->>'pricing_configured')::boolean,false)=false),
    'providers',coalesce((select jsonb_agg(to_jsonb(provider_rows)) from provider_rows),'[]'::jsonb)
  ) from filtered;
$$;

grant execute on function public.cost_center_summary_multi_filtered(timestamptz,timestamptz,text,text,uuid,uuid[],uuid[]) to authenticated;
