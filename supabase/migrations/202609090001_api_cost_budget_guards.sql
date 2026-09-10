-- Paid API budgets are enforced in the database so concurrent workers cannot
-- overspend merely because they all read the same stale total.
alter table public.cost_center_settings
  add column if not exists google_daily_limit_usd numeric(14,6),
  add column if not exists google_weekly_limit_usd numeric(14,6),
  add column if not exists google_monthly_limit_usd numeric(14,6),
  add column if not exists openai_daily_limit_usd numeric(14,6),
  add column if not exists openai_weekly_limit_usd numeric(14,6),
  add column if not exists openai_monthly_limit_usd numeric(14,6);

alter table public.cost_center_settings drop constraint if exists cost_center_nonnegative_limits;
alter table public.cost_center_settings add constraint cost_center_nonnegative_limits check (
  (google_daily_limit_usd is null or google_daily_limit_usd >= 0) and
  (google_weekly_limit_usd is null or google_weekly_limit_usd >= 0) and
  (google_monthly_limit_usd is null or google_monthly_limit_usd >= 0) and
  (openai_daily_limit_usd is null or openai_daily_limit_usd >= 0) and
  (openai_weekly_limit_usd is null or openai_weekly_limit_usd >= 0) and
  (openai_monthly_limit_usd is null or openai_monthly_limit_usd >= 0)
);

create table if not exists public.api_cost_budget_reservations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('GOOGLE_PLACES','OPENAI')),
  amount_usd numeric(14,6) not null check(amount_usd >= 0),
  user_id uuid,
  customer_id uuid,
  task_id uuid,
  operation text,
  expires_at timestamptz not null default now() + interval '10 minutes',
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_cost_budget_reservations_active_idx
  on public.api_cost_budget_reservations(provider, created_at)
  where released_at is null;

create table if not exists public.api_cost_budget_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('GOOGLE_PLACES','OPENAI')),
  user_id uuid,
  customer_id uuid,
  task_id uuid,
  operation text,
  attempted_amount_usd numeric(14,6) not null default 0,
  blocked_period text not null check(blocked_period in ('DAY','WEEK','MONTH')),
  used_usd numeric(14,6) not null default 0,
  limit_usd numeric(14,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists api_cost_budget_events_provider_created_idx
  on public.api_cost_budget_events(provider, created_at desc);
create index if not exists api_cost_ledger_provider_occurred_idx
  on public.api_cost_ledger(provider, occurred_at desc);
create index if not exists api_cost_ledger_service_user_idx
  on public.api_cost_ledger(service, user_id);

alter table public.api_cost_budget_reservations enable row level security;
alter table public.api_cost_budget_events enable row level security;
revoke all on public.api_cost_budget_reservations from anon, authenticated;
revoke all on public.api_cost_budget_events from anon, authenticated;

create or replace function public.reserve_api_cost_budget(
  p_provider text,
  p_amount_usd numeric,
  p_user_id uuid default null,
  p_customer_id uuid default null,
  p_task_id uuid default null,
  p_operation text default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_settings public.cost_center_settings%rowtype;
  v_day_start timestamptz := date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_week_start timestamptz := date_trunc('week', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_month_start timestamptz := date_trunc('month', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_day_limit numeric;
  v_week_limit numeric;
  v_month_limit numeric;
  v_day_used numeric;
  v_week_used numeric;
  v_month_used numeric;
  v_reservation_id uuid;
  v_amount numeric := greatest(coalesce(p_amount_usd,0),0);
begin
  if p_provider not in ('GOOGLE_PLACES','OPENAI') then raise exception 'UNSUPPORTED_COST_PROVIDER'; end if;
  perform pg_advisory_xact_lock(hashtext('api-cost-budget:' || p_provider));
  select * into v_settings from public.cost_center_settings where id=true;
  if p_provider='GOOGLE_PLACES' then
    v_day_limit:=v_settings.google_daily_limit_usd; v_week_limit:=v_settings.google_weekly_limit_usd; v_month_limit:=v_settings.google_monthly_limit_usd;
  else
    v_day_limit:=v_settings.openai_daily_limit_usd; v_week_limit:=v_settings.openai_weekly_limit_usd; v_month_limit:=v_settings.openai_monthly_limit_usd;
  end if;
  select coalesce(sum(amount_usd),0) into v_day_used from public.api_cost_ledger where provider=p_provider and occurred_at>=v_day_start;
  select v_day_used + coalesce(sum(amount_usd),0) into v_day_used from public.api_cost_budget_reservations where provider=p_provider and released_at is null and expires_at>now() and created_at>=v_day_start;
  select coalesce(sum(amount_usd),0) into v_week_used from public.api_cost_ledger where provider=p_provider and occurred_at>=v_week_start;
  select v_week_used + coalesce(sum(amount_usd),0) into v_week_used from public.api_cost_budget_reservations where provider=p_provider and released_at is null and expires_at>now() and created_at>=v_week_start;
  select coalesce(sum(amount_usd),0) into v_month_used from public.api_cost_ledger where provider=p_provider and occurred_at>=v_month_start;
  select v_month_used + coalesce(sum(amount_usd),0) into v_month_used from public.api_cost_budget_reservations where provider=p_provider and released_at is null and expires_at>now() and created_at>=v_month_start;
  if v_day_limit is not null and v_day_used + v_amount > v_day_limit then
    insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd) values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'DAY',v_day_used,v_day_limit);
    return jsonb_build_object('allowed',false,'period','DAY','used_usd',v_day_used,'limit_usd',v_day_limit);
  elsif v_week_limit is not null and v_week_used + v_amount > v_week_limit then
    insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd) values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'WEEK',v_week_used,v_week_limit);
    return jsonb_build_object('allowed',false,'period','WEEK','used_usd',v_week_used,'limit_usd',v_week_limit);
  elsif v_month_limit is not null and v_month_used + v_amount > v_month_limit then
    insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd) values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'MONTH',v_month_used,v_month_limit);
    return jsonb_build_object('allowed',false,'period','MONTH','used_usd',v_month_used,'limit_usd',v_month_limit);
  end if;
  if v_amount > 0 then
    insert into public.api_cost_budget_reservations(provider,amount_usd,user_id,customer_id,task_id,operation)
      values(p_provider,v_amount,p_user_id,p_customer_id,p_task_id,p_operation) returning id into v_reservation_id;
  end if;
  return jsonb_build_object('allowed',true,'reservation_id',v_reservation_id,'day_used_usd',v_day_used,'week_used_usd',v_week_used,'month_used_usd',v_month_used);
end $$;

create or replace function public.release_api_cost_budget(p_reservation_id uuid)
returns void language sql security definer set search_path=public as $$
  update public.api_cost_budget_reservations set released_at=coalesce(released_at,now()) where id=p_reservation_id;
$$;

revoke all on function public.reserve_api_cost_budget(text,numeric,uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.release_api_cost_budget(uuid) from public, anon, authenticated;
grant execute on function public.reserve_api_cost_budget(text,numeric,uuid,uuid,uuid,text) to service_role;
grant execute on function public.release_api_cost_budget(uuid) to service_role;

create or replace function public.api_cost_budget_status()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_settings public.cost_center_settings%rowtype;
  v_day_start timestamptz := date_trunc('day', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_week_start timestamptz := date_trunc('week', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_month_start timestamptz := date_trunc('month', timezone('Asia/Shanghai', now())) at time zone 'Asia/Shanghai';
  v_result jsonb := '{}'::jsonb;
  v_provider text;
  v_day numeric; v_week numeric; v_month numeric; v_blocked bigint;
begin
  select * into v_settings from public.cost_center_settings where id=true;
  foreach v_provider in array array['GOOGLE_PLACES','OPENAI'] loop
    select coalesce(sum(amount_usd),0) into v_day from public.api_cost_ledger where provider=v_provider and occurred_at>=v_day_start;
    select coalesce(sum(amount_usd),0) into v_week from public.api_cost_ledger where provider=v_provider and occurred_at>=v_week_start;
    select coalesce(sum(amount_usd),0) into v_month from public.api_cost_ledger where provider=v_provider and occurred_at>=v_month_start;
    select count(*) into v_blocked from public.api_cost_budget_events where provider=v_provider and created_at>=v_month_start;
    v_result := v_result || jsonb_build_object(v_provider, jsonb_build_object(
      'daily_used_usd',v_day,'weekly_used_usd',v_week,'monthly_used_usd',v_month,'monthly_blocked_count',v_blocked,
      'daily_limit_usd',case when v_provider='GOOGLE_PLACES' then v_settings.google_daily_limit_usd else v_settings.openai_daily_limit_usd end,
      'weekly_limit_usd',case when v_provider='GOOGLE_PLACES' then v_settings.google_weekly_limit_usd else v_settings.openai_weekly_limit_usd end,
      'monthly_limit_usd',case when v_provider='GOOGLE_PLACES' then v_settings.google_monthly_limit_usd else v_settings.openai_monthly_limit_usd end
    ));
  end loop;
  return v_result;
end $$;
revoke all on function public.api_cost_budget_status() from public, anon, authenticated;
grant execute on function public.api_cost_budget_status() to service_role;

create or replace function public.cost_center_summary_filtered(
  p_from timestamptz,
  p_to timestamptz,
  p_provider text default null,
  p_operation text default null,
  p_user_id uuid default null,
  p_task_id uuid default null,
  p_customer_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not public.current_user_is_admin() then raise exception '仅系统管理员可以查看费用中心'; end if;
  with scoped as (
    select * from public.api_cost_ledger
    where occurred_at>=p_from and occurred_at<p_to
      and (p_provider is null or provider=p_provider)
      and (p_operation is null or operation ilike '%'||p_operation||'%' or coalesce(model_or_sku,'') ilike '%'||p_operation||'%')
      and (p_user_id is null or user_id=p_user_id)
      and (p_task_id is null or task_id=p_task_id)
      and (p_customer_id is null or customer_id=p_customer_id)
  )
  select jsonb_build_object(
    'total_usd',coalesce(sum(amount_usd),0),'request_count',count(*),
    'input_tokens',coalesce(sum(input_tokens),0),'cached_input_tokens',coalesce(sum(cached_input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0),
    'estimated_usd',coalesce(sum(amount_usd) filter(where amount_type='ESTIMATED'),0),
    'final_usd',coalesce(sum(amount_usd) filter(where amount_type='FINAL'),0),
    'unknown_pricing_count',count(*) filter(where amount_type='ESTIMATED' and coalesce((pricing_snapshot->>'pricing_configured')::boolean,false)=false),
    'providers',coalesce((select jsonb_agg(x order by x.total_usd desc) from (select provider,service,count(*) request_count,sum(amount_usd) total_usd,sum(case when amount_type='ESTIMATED' then amount_usd else 0 end) estimated_usd from scoped group by provider,service)x),'[]'::jsonb)
  ) into result from scoped;
  return result;
end $$;
grant execute on function public.cost_center_summary_filtered(timestamptz,timestamptz,text,text,uuid,uuid,uuid) to authenticated;

create or replace function public.ai_screening_historical_cost_summary(p_user_id uuid default null)
returns jsonb language sql security definer set search_path=public as $$
  with completion as (
    select count(*)::bigint as processed_customers
    from public.ai_screening_completion_ledger
    where p_user_id is null or user_id=p_user_id
  ), provider_costs as (
    select provider, coalesce(sum(amount_usd),0)::numeric as total_usd
    from public.api_cost_ledger
    where service='AI筛选' and (p_user_id is null or user_id=p_user_id)
    group by provider
  ), totals as (
    select coalesce(sum(total_usd),0)::numeric as total_usd,
      coalesce(jsonb_object_agg(provider,total_usd),'{}'::jsonb) as providers
    from provider_costs
  )
  select jsonb_build_object(
    'processed_customers',completion.processed_customers,
    'total_third_party_cost_usd',totals.total_usd,
    'average_cost_per_customer_usd',case when completion.processed_customers>0 then totals.total_usd/completion.processed_customers else 0 end,
    'provider_costs',totals.providers
  ) from completion cross join totals;
$$;
revoke all on function public.ai_screening_historical_cost_summary(uuid) from public, anon, authenticated;
grant execute on function public.ai_screening_historical_cost_summary(uuid) to service_role;
