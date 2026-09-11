-- Configurable executor policy plus durable task/item execution attribution.
-- A task stores the policy snapshot used at creation time. Each item already
-- stores its actual executor_type; executor_history makes mixed handoffs
-- visible at task level without losing earlier executors.

alter table public.cost_center_settings
  add column if not exists ai_default_dispatch_policy text not null default 'VERCEL_FIRST';

alter table public.cost_center_settings
  drop constraint if exists cost_center_ai_default_dispatch_policy_check;
alter table public.cost_center_settings
  add constraint cost_center_ai_default_dispatch_policy_check
  check (ai_default_dispatch_policy in ('VERCEL_FIRST','LOCAL_FIRST','VERCEL_ONLY','LOCAL_ONLY'));

alter table public.ai_screening_tasks
  add column if not exists dispatch_policy text not null default 'VERCEL_FIRST',
  add column if not exists executor_history text[] not null default '{}'::text[];

alter table public.ai_screening_tasks
  drop constraint if exists ai_screening_tasks_dispatch_policy_check;
alter table public.ai_screening_tasks
  add constraint ai_screening_tasks_dispatch_policy_check
  check (dispatch_policy in ('VERCEL_FIRST','LOCAL_FIRST','VERCEL_ONLY','LOCAL_ONLY'));

alter table public.ai_screening_tasks
  drop constraint if exists ai_screening_tasks_executor_history_check;
alter table public.ai_screening_tasks
  add constraint ai_screening_tasks_executor_history_check
  check (executor_history <@ array['LOCAL_NODE','VERCEL_WORKFLOW']::text[]);

update public.ai_screening_tasks
set dispatch_policy = case execution_mode
  when 'LOCAL_ONLY' then 'LOCAL_ONLY'
  when 'VERCEL_ONLY' then 'VERCEL_ONLY'
  else 'LOCAL_FIRST'
end
where dispatch_policy = 'VERCEL_FIRST';

create or replace function public.record_ai_task_item_executor()
returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.executor_type in ('LOCAL_NODE','VERCEL_WORKFLOW')
     and (tg_op = 'INSERT' or old.executor_type is distinct from new.executor_type) then
    update public.ai_screening_tasks
    set executor_history = case
      when new.executor_type = any(executor_history) then executor_history
      else array_append(executor_history,new.executor_type)
    end,
    updated_at = now()
    where id = new.task_id;
  end if;
  return new;
end $$;

drop trigger if exists ai_task_item_record_executor on public.ai_screening_task_items;
create trigger ai_task_item_record_executor
after insert or update of executor_type on public.ai_screening_task_items
for each row execute function public.record_ai_task_item_executor();

update public.ai_screening_tasks t
set executor_history = history.executors
from (
  select task_id, array_agg(distinct executor_type order by executor_type) as executors
  from public.ai_screening_task_items
  where executor_type in ('LOCAL_NODE','VERCEL_WORKFLOW')
  group by task_id
) history
where history.task_id=t.id;

-- A process heartbeat alone is insufficient: the local node must also report
-- successful no-charge connectivity probes for all analysis dependencies.
create or replace function public.has_healthy_ai_worker(p_max_age_seconds integer default 45)
returns boolean
language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.ai_worker_nodes
    where status='ONLINE'
      and last_heartbeat_at>=now()-make_interval(secs=>least(300,greatest(10,p_max_age_seconds)))
      and coalesce((metadata->>'analysis_ready')::boolean,false)
  );
$$;

revoke all on function public.has_healthy_ai_worker(integer) from public,anon,authenticated;
grant execute on function public.has_healthy_ai_worker(integer) to service_role;

create or replace function public.archive_ai_screening_tasks(
  p_task_ids uuid[],p_actor_id uuid,p_is_admin boolean default false
) returns integer
language plpgsql security definer set search_path=public as $$
declare v_expected integer; v_valid integer; v_updated integer;
begin
  select count(distinct value) into v_expected from unnest(coalesce(p_task_ids,'{}'::uuid[])) as ids(value);
  if v_expected=0 or v_expected>100 then raise exception 'INVALID_BATCH_SIZE'; end if;
  select count(*) into v_valid from (
    select id from public.ai_screening_tasks
    where id=any(p_task_ids) and archived_at is null
      and status in ('COMPLETED','CANCELLED','FAILED')
      and (p_is_admin or user_id=p_actor_id)
    for update
  ) locked;
  if v_valid<>v_expected then raise exception 'BATCH_ARCHIVE_VALIDATION_FAILED'; end if;
  update public.ai_screening_tasks set archived_at=now(),updated_at=now()
  where id=any(p_task_ids) and archived_at is null;
  get diagnostics v_updated=row_count;
  if v_updated<>v_expected then raise exception 'BATCH_ARCHIVE_CONCURRENT_CHANGE'; end if;
  return v_updated;
end $$;

revoke all on function public.archive_ai_screening_tasks(uuid[],uuid,boolean) from public,anon,authenticated;
grant execute on function public.archive_ai_screening_tasks(uuid[],uuid,boolean) to service_role;
