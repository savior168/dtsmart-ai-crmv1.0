-- Preserve AI usage and completed-customer metrics independently from mutable
-- CRM rows. These audit ledgers deliberately have no task/customer foreign
-- keys, so physical deletion cannot erase historical cost or throughput.

create table if not exists public.ai_screening_usage_ledger (
  source_call_id uuid primary key,
  user_id uuid not null,
  task_id uuid not null,
  task_name text not null default '已删除的AI筛选任务',
  task_number text,
  task_status text,
  task_total_count integer not null default 0,
  task_created_at timestamptz,
  customer_id uuid not null,
  channel text not null,
  model text,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  cost_usd numeric(14,6) not null default 0,
  call_status text not null default 'COMPLETED',
  duration_ms integer,
  error_message text,
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists ai_usage_ledger_user_occurred_idx
  on public.ai_screening_usage_ledger(user_id, occurred_at desc);
create index if not exists ai_usage_ledger_user_task_idx
  on public.ai_screening_usage_ledger(user_id, task_id);

create table if not exists public.ai_screening_completion_ledger (
  source_task_item_id uuid primary key,
  user_id uuid not null,
  task_id uuid not null,
  task_name text not null default '已删除的AI筛选任务',
  task_number text,
  task_status text,
  task_total_count integer not null default 0,
  task_created_at timestamptz,
  customer_id uuid not null,
  strategy text,
  completed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

create index if not exists ai_completion_ledger_user_completed_idx
  on public.ai_screening_completion_ledger(user_id, completed_at desc);
create index if not exists ai_completion_ledger_user_task_idx
  on public.ai_screening_completion_ledger(user_id, task_id);

create or replace function public.capture_ai_screening_usage_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.ai_screening_tasks%rowtype;
begin
  select * into task_row from public.ai_screening_tasks where id = new.task_id;
  if not found then return new; end if;

  insert into public.ai_screening_usage_ledger (
    source_call_id, user_id, task_id, task_name, task_number, task_status,
    task_total_count, task_created_at, customer_id, channel, model,
    input_tokens, cached_input_tokens, output_tokens, total_tokens, cost_usd,
    call_status, duration_ms, error_message, occurred_at, updated_at
  ) values (
    new.id, task_row.user_id, new.task_id, coalesce(task_row.name, 'AI筛选任务'),
    task_row.task_number, task_row.status, coalesce(task_row.total_count, 0),
    task_row.created_at, new.customer_id, new.channel, new.model,
    coalesce(new.input_tokens, 0), coalesce(new.cached_input_tokens, 0),
    coalesce(new.output_tokens, 0), coalesce(new.total_tokens, 0),
    coalesce(new.cost_usd, 0), new.status, new.duration_ms, new.error_message,
    coalesce(new.created_at, now()), now()
  )
  on conflict (source_call_id) do update set
    task_name = excluded.task_name,
    task_number = excluded.task_number,
    task_status = excluded.task_status,
    task_total_count = excluded.task_total_count,
    model = excluded.model,
    input_tokens = excluded.input_tokens,
    cached_input_tokens = excluded.cached_input_tokens,
    output_tokens = excluded.output_tokens,
    total_tokens = excluded.total_tokens,
    cost_usd = excluded.cost_usd,
    call_status = excluded.call_status,
    duration_ms = excluded.duration_ms,
    error_message = excluded.error_message,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_model_calls_usage_ledger_trigger on public.ai_screening_model_calls;
create trigger ai_model_calls_usage_ledger_trigger
after insert or update on public.ai_screening_model_calls
for each row execute function public.capture_ai_screening_usage_ledger();

create or replace function public.capture_ai_screening_completion_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.ai_screening_tasks%rowtype;
begin
  if new.status <> 'COMPLETED' or new.completed_at is null then return new; end if;
  select * into task_row from public.ai_screening_tasks where id = new.task_id;
  if not found then return new; end if;

  insert into public.ai_screening_completion_ledger (
    source_task_item_id, user_id, task_id, task_name, task_number, task_status,
    task_total_count, task_created_at, customer_id, strategy, completed_at
  ) values (
    new.id, task_row.user_id, new.task_id, coalesce(task_row.name, 'AI筛选任务'),
    task_row.task_number, task_row.status, coalesce(task_row.total_count, 0),
    task_row.created_at, new.customer_id, new.strategy, new.completed_at
  )
  on conflict (source_task_item_id) do update set
    task_name = excluded.task_name,
    task_number = excluded.task_number,
    task_status = excluded.task_status,
    task_total_count = excluded.task_total_count,
    strategy = excluded.strategy,
    completed_at = least(public.ai_screening_completion_ledger.completed_at, excluded.completed_at);
  return new;
end;
$$;

drop trigger if exists ai_task_items_completion_ledger_trigger on public.ai_screening_task_items;
create trigger ai_task_items_completion_ledger_trigger
after insert or update of status, completed_at on public.ai_screening_task_items
for each row execute function public.capture_ai_screening_completion_ledger();

create or replace function public.sync_ai_screening_ledger_task_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_screening_usage_ledger set
    task_name = coalesce(new.name, task_name), task_number = new.task_number,
    task_status = new.status, task_total_count = coalesce(new.total_count, 0),
    task_created_at = new.created_at, updated_at = now()
  where task_id = new.id;
  update public.ai_screening_completion_ledger set
    task_name = coalesce(new.name, task_name), task_number = new.task_number,
    task_status = new.status, task_total_count = coalesce(new.total_count, 0),
    task_created_at = new.created_at
  where task_id = new.id;
  return new;
end;
$$;

drop trigger if exists ai_tasks_ledger_snapshot_trigger on public.ai_screening_tasks;
create trigger ai_tasks_ledger_snapshot_trigger
after update of name, task_number, status, total_count on public.ai_screening_tasks
for each row execute function public.sync_ai_screening_ledger_task_snapshot();

insert into public.ai_screening_usage_ledger (
  source_call_id, user_id, task_id, task_name, task_number, task_status,
  task_total_count, task_created_at, customer_id, channel, model,
  input_tokens, cached_input_tokens, output_tokens, total_tokens, cost_usd,
  call_status, duration_ms, error_message, occurred_at
)
select c.id, t.user_id, c.task_id, coalesce(t.name, 'AI筛选任务'), t.task_number,
  t.status, coalesce(t.total_count, 0), t.created_at, c.customer_id, c.channel,
  c.model, coalesce(c.input_tokens, 0), coalesce(c.cached_input_tokens, 0),
  coalesce(c.output_tokens, 0), coalesce(c.total_tokens, 0), coalesce(c.cost_usd, 0),
  c.status, c.duration_ms, c.error_message, c.created_at
from public.ai_screening_model_calls c
join public.ai_screening_tasks t on t.id = c.task_id
on conflict (source_call_id) do nothing;

insert into public.ai_screening_completion_ledger (
  source_task_item_id, user_id, task_id, task_name, task_number, task_status,
  task_total_count, task_created_at, customer_id, strategy, completed_at
)
select i.id, t.user_id, i.task_id, coalesce(t.name, 'AI筛选任务'), t.task_number,
  t.status, coalesce(t.total_count, 0), t.created_at, i.customer_id, i.strategy,
  i.completed_at
from public.ai_screening_task_items i
join public.ai_screening_tasks t on t.id = i.task_id
where i.status = 'COMPLETED' and i.completed_at is not null
on conflict (source_task_item_id) do nothing;

alter table public.ai_screening_usage_ledger enable row level security;
alter table public.ai_screening_completion_ledger enable row level security;

drop policy if exists ai_usage_ledger_self on public.ai_screening_usage_ledger;
create policy ai_usage_ledger_self on public.ai_screening_usage_ledger
for select to authenticated using (user_id = auth.uid());

drop policy if exists ai_completion_ledger_self on public.ai_screening_completion_ledger;
create policy ai_completion_ledger_self on public.ai_screening_completion_ledger
for select to authenticated using (user_id = auth.uid());

revoke insert, update, delete on public.ai_screening_usage_ledger from anon, authenticated;
revoke insert, update, delete on public.ai_screening_completion_ledger from anon, authenticated;

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
  select
    (select count(*) from public.ai_screening_completion_ledger c where c.user_id = p_user_id),
    (select coalesce(sum(u.input_tokens), 0) from public.ai_screening_usage_ledger u where u.user_id = p_user_id),
    (select coalesce(sum(u.cached_input_tokens), 0) from public.ai_screening_usage_ledger u where u.user_id = p_user_id),
    (select coalesce(sum(u.output_tokens), 0) from public.ai_screening_usage_ledger u where u.user_id = p_user_id),
    (select coalesce(sum(u.total_tokens), 0) from public.ai_screening_usage_ledger u where u.user_id = p_user_id),
    (select coalesce(sum(u.cost_usd), 0) from public.ai_screening_usage_ledger u where u.user_id = p_user_id);
$$;

revoke all on function public.ai_screening_usage_totals(uuid) from public;
grant execute on function public.ai_screening_usage_totals(uuid) to service_role;
