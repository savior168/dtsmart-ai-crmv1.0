-- AI筛选费用策略必须在服务端持久化并在每次付费调用前原子校验。
-- 免费模式仍允许明确免费的Google IDs Only请求，但禁止任何正金额调用。

alter table public.cost_center_settings
  add column if not exists google_paid_enabled boolean not null default true,
  add column if not exists openai_paid_enabled boolean not null default true,
  add column if not exists google_max_paid_calls_per_customer integer not null default 2,
  add column if not exists openai_max_paid_calls_per_customer integer not null default 1;

alter table public.cost_center_settings drop constraint if exists cost_center_ai_call_caps_check;
alter table public.cost_center_settings add constraint cost_center_ai_call_caps_check check (
  google_max_paid_calls_per_customer between 0 and 2 and
  openai_max_paid_calls_per_customer between 0 and 1
);

alter table public.ai_screening_tasks
  add column if not exists cost_mode text not null default 'ADAPTIVE',
  add column if not exists task_cost_limit_usd numeric(14,6);

alter table public.ai_screening_tasks drop constraint if exists ai_screening_tasks_cost_mode_check;
alter table public.ai_screening_tasks add constraint ai_screening_tasks_cost_mode_check
  check (cost_mode in ('ADAPTIVE','FREE_ONLY'));
alter table public.ai_screening_tasks drop constraint if exists ai_screening_tasks_cost_limit_check;
alter table public.ai_screening_tasks add constraint ai_screening_tasks_cost_limit_check
  check (task_cost_limit_usd is null or task_cost_limit_usd >= 0);

alter table public.api_cost_budget_events drop constraint if exists api_cost_budget_events_blocked_period_check;
alter table public.api_cost_budget_events add constraint api_cost_budget_events_blocked_period_check
  check(blocked_period in ('DAY','WEEK','MONTH','TASK','CUSTOMER','FREE_MODE','PROVIDER_DISABLED'));

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
  v_day_limit numeric; v_week_limit numeric; v_month_limit numeric;
  v_day_used numeric; v_week_used numeric; v_month_used numeric;
  v_task_limit numeric; v_task_used numeric := 0; v_task_mode text := 'ADAPTIVE';
  v_provider_enabled boolean := true; v_customer_limit integer := 0; v_customer_used integer := 0;
  v_reservation_id uuid;
  v_amount numeric := greatest(coalesce(p_amount_usd,0),0);
begin
  if p_provider not in ('GOOGLE_PLACES','OPENAI') then raise exception 'UNSUPPORTED_COST_PROVIDER'; end if;

  -- 同一任务中Google与OpenAI共享一个任务预算，先锁任务再锁平台，避免并发超支。
  if p_task_id is not null then
    perform pg_advisory_xact_lock(hashtext('ai-task-cost:' || p_task_id::text));
  end if;
  perform pg_advisory_xact_lock(hashtext('api-cost-budget:' || p_provider));

  select * into v_settings from public.cost_center_settings where id=true;
  if p_provider='GOOGLE_PLACES' then
    v_day_limit:=v_settings.google_daily_limit_usd;
    v_week_limit:=v_settings.google_weekly_limit_usd;
    v_month_limit:=v_settings.google_monthly_limit_usd;
    v_provider_enabled:=v_settings.google_paid_enabled;
    v_customer_limit:=v_settings.google_max_paid_calls_per_customer;
  else
    v_day_limit:=v_settings.openai_daily_limit_usd;
    v_week_limit:=v_settings.openai_weekly_limit_usd;
    v_month_limit:=v_settings.openai_monthly_limit_usd;
    v_provider_enabled:=v_settings.openai_paid_enabled;
    v_customer_limit:=v_settings.openai_max_paid_calls_per_customer;
  end if;

  if p_task_id is not null then
    select coalesce(cost_mode,'ADAPTIVE'), task_cost_limit_usd
      into v_task_mode, v_task_limit
      from public.ai_screening_tasks where id=p_task_id;
  end if;

  -- 零金额请求必须继续放行，确保免费模式仍可使用IDs Only等明确免费渠道。
  if v_amount > 0 and v_task_mode='FREE_ONLY' then
    insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd)
      values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'FREE_MODE',0,0);
    return jsonb_build_object('allowed',false,'period','FREE_MODE','used_usd',0,'limit_usd',0);
  end if;
  if v_amount > 0 and not v_provider_enabled then
    insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd)
      values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'PROVIDER_DISABLED',0,0);
    return jsonb_build_object('allowed',false,'period','PROVIDER_DISABLED','used_usd',0,'limit_usd',0);
  end if;

  if v_amount > 0 and p_customer_id is not null and p_task_id is not null then
    select count(*) into v_customer_used from public.api_cost_ledger
      where provider=p_provider and task_id=p_task_id and customer_id=p_customer_id
        and (p_provider='OPENAI' or model_or_sku in ('PLACES_DETAILS_PRO','PLACES_DETAILS_ENTERPRISE','PLACES_DETAILS_ENTERPRISE_ATMOSPHERE'));
    select v_customer_used + count(*) into v_customer_used from public.api_cost_budget_reservations
      where provider=p_provider and task_id=p_task_id and customer_id=p_customer_id
        and released_at is null and expires_at>now() and amount_usd>0;
    if v_customer_used >= v_customer_limit then
      insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd)
        values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'CUSTOMER',v_customer_used,v_customer_limit);
      return jsonb_build_object('allowed',false,'period','CUSTOMER','used_usd',v_customer_used,'limit_usd',v_customer_limit);
    end if;
  end if;

  if v_amount > 0 and p_task_id is not null and v_task_limit is not null then
    select coalesce(sum(amount_usd),0) into v_task_used from public.api_cost_ledger where task_id=p_task_id;
    select v_task_used + coalesce(sum(amount_usd),0) into v_task_used from public.api_cost_budget_reservations
      where task_id=p_task_id and released_at is null and expires_at>now();
    if v_task_used + v_amount > v_task_limit then
      insert into public.api_cost_budget_events(provider,user_id,customer_id,task_id,operation,attempted_amount_usd,blocked_period,used_usd,limit_usd)
        values(p_provider,p_user_id,p_customer_id,p_task_id,p_operation,v_amount,'TASK',v_task_used,v_task_limit);
      return jsonb_build_object('allowed',false,'period','TASK','used_usd',v_task_used,'limit_usd',v_task_limit);
    end if;
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
  return jsonb_build_object('allowed',true,'reservation_id',v_reservation_id,'day_used_usd',v_day_used,'week_used_usd',v_week_used,'month_used_usd',v_month_used,'task_used_usd',v_task_used);
end $$;

revoke all on function public.reserve_api_cost_budget(text,numeric,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.reserve_api_cost_budget(text,numeric,uuid,uuid,uuid,text) to service_role;

insert into public.role_permission_settings(role_code,permission_code,enabled)
values
  ('ADMIN','ai.settings.manage',true),
  ('SUPERVISOR','ai.settings.manage',false),
  ('SALES','ai.settings.manage',false),
  ('WAREHOUSE','ai.settings.manage',false)
on conflict(role_code,permission_code)
do update set enabled=excluded.enabled,updated_at=now();
