-- Durable hybrid execution for AI screening.
-- Existing workflow-backed tasks remain Vercel-owned; newly created tasks
-- explicitly choose AUTO, LOCAL_ONLY or VERCEL_ONLY in the application API.

alter table public.ai_screening_tasks
  add column if not exists execution_mode text not null default 'AUTO',
  add column if not exists active_executor text,
  add column if not exists executor_heartbeat_at timestamptz,
  add column if not exists last_dispatch_at timestamptz,
  add column if not exists dispatch_error text;

update public.ai_screening_tasks
set execution_mode = 'VERCEL_ONLY'
where workflow_run_id is not null
  and created_at < timestamptz '2026-09-10 10:41:13+00';

alter table public.ai_screening_tasks drop constraint if exists ai_screening_tasks_execution_mode_check;
alter table public.ai_screening_tasks add constraint ai_screening_tasks_execution_mode_check
  check (execution_mode in ('AUTO','LOCAL_ONLY','VERCEL_ONLY'));

alter table public.ai_screening_task_items
  add column if not exists lease_owner text,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists executor_type text,
  add column if not exists executor_heartbeat_at timestamptz;

create index if not exists ai_screening_items_local_queue_idx
  on public.ai_screening_task_items(status, lease_expires_at, updated_at)
  where status in ('PENDING','RUNNING');

create table if not exists public.ai_worker_nodes (
  worker_id text primary key,
  display_name text not null,
  host_name text,
  worker_version text not null,
  status text not null default 'ONLINE',
  concurrency integer not null default 1 check (concurrency between 1 and 16),
  active_count integer not null default 0 check (active_count between 0 and 16),
  last_heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ai_worker_nodes enable row level security;
-- Worker registry is service-role only. Browser APIs expose a redacted status.

create index if not exists ai_worker_nodes_heartbeat_idx
  on public.ai_worker_nodes(last_heartbeat_at desc);

create or replace function public.heartbeat_ai_worker(
  p_worker_id text,
  p_display_name text,
  p_host_name text,
  p_worker_version text,
  p_concurrency integer,
  p_active_count integer,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.ai_worker_nodes(
    worker_id,display_name,host_name,worker_version,status,concurrency,
    active_count,last_heartbeat_at,started_at,stopped_at,metadata,updated_at
  ) values (
    p_worker_id,coalesce(nullif(p_display_name,''),p_worker_id),p_host_name,
    p_worker_version,'ONLINE',least(16,greatest(1,p_concurrency)),
    least(16,greatest(0,p_active_count)),now(),now(),null,coalesce(p_metadata,'{}'::jsonb),now()
  )
  on conflict(worker_id) do update set
    display_name=excluded.display_name,
    host_name=excluded.host_name,
    worker_version=excluded.worker_version,
    status='ONLINE',
    concurrency=excluded.concurrency,
    active_count=excluded.active_count,
    last_heartbeat_at=now(),
    stopped_at=null,
    metadata=excluded.metadata,
    updated_at=now();
end $$;

create or replace function public.stop_ai_worker(p_worker_id text)
returns void
language plpgsql security definer set search_path=public as $$
begin
  update public.ai_worker_nodes
  set status='OFFLINE', stopped_at=now(), updated_at=now()
  where worker_id=p_worker_id;
end $$;

create or replace function public.claim_next_ai_screening_item(
  p_worker_id text,
  p_lease_seconds integer default 1800
) returns table(
  task_id uuid,
  task_item_id uuid,
  customer_id uuid,
  strategy text,
  attempt_number integer,
  lease_token uuid
)
language plpgsql security definer set search_path=public as $$
declare
  v_item_id uuid;
  v_task_id uuid;
  v_token uuid := gen_random_uuid();
begin
  select i.id, i.task_id into v_item_id, v_task_id
  from public.ai_screening_task_items i
  join public.ai_screening_tasks t on t.id=i.task_id
  where t.status in ('QUEUED','RUNNING')
    and not coalesce(t.cancel_requested,false)
    and t.execution_mode in ('AUTO','LOCAL_ONLY')
    and (t.scheduled_at is null or t.scheduled_at<=now())
    and (
      i.status='PENDING'
      or (
        i.status='RUNNING'
        and i.analysis_status <> 'COMPLETED'
        and i.lease_owner is not null
        and i.lease_expires_at < now()
      )
    )
  order by t.created_at, i.attempt_count, i.updated_at, i.id
  for update of i skip locked
  limit 1;

  if v_item_id is null then return; end if;

  update public.ai_screening_task_items i set
    status='RUNNING',
    analysis_status='RUNNING',
    writeback_status='PENDING',
    progress=greatest(coalesce(i.progress,0),5),
    current_step='COLLECTING_EVIDENCE',
    pipeline_stage='COLLECTING_EVIDENCE',
    attempt_count=coalesce(i.attempt_count,0)+1,
    started_at=coalesce(i.started_at,now()),
    lease_owner=p_worker_id,
    lease_token=v_token,
    lease_expires_at=now()+make_interval(secs=>least(3600,greatest(120,p_lease_seconds))),
    executor_type='LOCAL_NODE',
    executor_heartbeat_at=now(),
    updated_at=now()
  where i.id=v_item_id;

  update public.ai_screening_tasks t set
    status='RUNNING',
    started_at=coalesce(t.started_at,now()),
    finished_at=null,
    active_executor='LOCAL_NODE',
    executor_heartbeat_at=now(),
    dispatch_error=null,
    updated_at=now()
  where t.id=v_task_id and t.status in ('QUEUED','RUNNING');

  return query
  select i.task_id,i.id,i.customer_id,i.strategy,i.attempt_count,i.lease_token
  from public.ai_screening_task_items i where i.id=v_item_id;
end $$;

create or replace function public.claim_ai_screening_task_item(
  p_task_id uuid,
  p_item_id uuid,
  p_executor_type text,
  p_executor_id text,
  p_lease_seconds integer default 1800
) returns table(
  task_id uuid,
  task_item_id uuid,
  customer_id uuid,
  strategy text,
  attempt_number integer,
  lease_token uuid
)
language plpgsql security definer set search_path=public as $$
declare
  v_token uuid := gen_random_uuid();
begin
  if p_executor_type not in ('LOCAL_NODE','VERCEL_WORKFLOW') then
    raise exception 'INVALID_EXECUTOR_TYPE';
  end if;

  return query
  with candidate as (
    select i.id
    from public.ai_screening_task_items i
    join public.ai_screening_tasks t on t.id=i.task_id
    where i.id=p_item_id and i.task_id=p_task_id
      and t.status in ('QUEUED','RUNNING')
      and not coalesce(t.cancel_requested,false)
      and (
        (p_executor_type='LOCAL_NODE' and t.execution_mode in ('AUTO','LOCAL_ONLY'))
        or (p_executor_type='VERCEL_WORKFLOW' and t.execution_mode in ('AUTO','VERCEL_ONLY'))
      )
      and (
        i.status='PENDING'
        or (
          i.status='RUNNING'
          and i.analysis_status <> 'COMPLETED'
          and i.lease_owner is not null
          and i.lease_expires_at < now()
        )
      )
    for update of i skip locked
  ), claimed as (
    update public.ai_screening_task_items i set
      status='RUNNING',analysis_status='RUNNING',writeback_status='PENDING',
      progress=greatest(coalesce(i.progress,0),5),current_step='COLLECTING_EVIDENCE',
      pipeline_stage='COLLECTING_EVIDENCE',attempt_count=coalesce(i.attempt_count,0)+1,
      started_at=coalesce(i.started_at,now()),lease_owner=p_executor_id,
      lease_token=v_token,
      lease_expires_at=now()+make_interval(secs=>least(3600,greatest(120,p_lease_seconds))),
      executor_type=p_executor_type,executor_heartbeat_at=now(),updated_at=now()
    from candidate c where i.id=c.id
    returning i.task_id,i.id,i.customer_id,i.strategy,i.attempt_count,i.lease_token
  )
  select c.task_id,c.id,c.customer_id,c.strategy,c.attempt_count,c.lease_token from claimed c;

  if found then
    update public.ai_screening_tasks set
      status='RUNNING',started_at=coalesce(started_at,now()),finished_at=null,
      active_executor=p_executor_type,executor_heartbeat_at=now(),dispatch_error=null,updated_at=now()
    where id=p_task_id;
  end if;
end $$;

create or replace function public.renew_ai_screening_item_lease(
  p_item_id uuid,
  p_lease_token uuid,
  p_executor_id text,
  p_lease_seconds integer default 1800
) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_updated integer;
begin
  update public.ai_screening_task_items set
    lease_expires_at=now()+make_interval(secs=>least(3600,greatest(120,p_lease_seconds))),
    executor_heartbeat_at=now(),updated_at=now()
  where id=p_item_id and lease_token=p_lease_token and lease_owner=p_executor_id and status='RUNNING';
  get diagnostics v_updated=row_count;
  if v_updated=1 then
    update public.ai_screening_tasks t set executor_heartbeat_at=now(),updated_at=now()
    where exists(select 1 from public.ai_screening_task_items i where i.id=p_item_id and i.task_id=t.id);
  end if;
  return v_updated=1;
end $$;

create or replace function public.release_ai_screening_item_lease(
  p_item_id uuid,
  p_lease_token uuid,
  p_executor_id text
) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_updated integer;
begin
  update public.ai_screening_task_items set
    lease_owner=null,lease_token=null,lease_expires_at=null,
    executor_heartbeat_at=now(),updated_at=now()
  where id=p_item_id and lease_token=p_lease_token and lease_owner=p_executor_id;
  get diagnostics v_updated=row_count;
  return v_updated=1;
end $$;

create or replace function public.has_healthy_ai_worker(p_max_age_seconds integer default 45)
returns boolean
language sql security definer set search_path=public stable as $$
  select exists(
    select 1 from public.ai_worker_nodes
    where status='ONLINE'
      and last_heartbeat_at>=now()-make_interval(secs=>least(300,greatest(10,p_max_age_seconds)))
  );
$$;

create or replace function public.claim_stalled_ai_tasks_for_vercel(p_limit integer default 3)
returns table(task_id uuid, strategy text, scheduled_at timestamptz)
language plpgsql security definer set search_path=public as $$
begin
  if public.has_healthy_ai_worker(45) then return; end if;
  return query
  with candidates as (
    select t.id
    from public.ai_screening_tasks t
    where t.execution_mode='AUTO'
      and t.status in ('QUEUED','RUNNING')
      and not coalesce(t.cancel_requested,false)
      and (t.scheduled_at is null or t.scheduled_at<=now())
      and coalesce(t.executor_heartbeat_at,t.last_dispatch_at,t.created_at)<now()-interval '75 seconds'
    order by t.created_at
    for update skip locked
    limit least(10,greatest(1,p_limit))
  ), claimed as (
    update public.ai_screening_tasks t set
      active_executor='VERCEL_DISPATCHING',last_dispatch_at=now(),updated_at=now()
    from candidates c where t.id=c.id
    returning t.id,t.strategy,t.scheduled_at
  )
  select c.id,c.strategy,c.scheduled_at from claimed c;
end $$;

revoke all on function public.heartbeat_ai_worker(text,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function public.stop_ai_worker(text) from public,anon,authenticated;
revoke all on function public.claim_next_ai_screening_item(text,integer) from public,anon,authenticated;
revoke all on function public.claim_ai_screening_task_item(uuid,uuid,text,text,integer) from public,anon,authenticated;
revoke all on function public.renew_ai_screening_item_lease(uuid,uuid,text,integer) from public,anon,authenticated;
revoke all on function public.release_ai_screening_item_lease(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.has_healthy_ai_worker(integer) from public,anon,authenticated;
revoke all on function public.claim_stalled_ai_tasks_for_vercel(integer) from public,anon,authenticated;

grant execute on function public.heartbeat_ai_worker(text,text,text,text,integer,integer,jsonb) to service_role;
grant execute on function public.stop_ai_worker(text) to service_role;
grant execute on function public.claim_next_ai_screening_item(text,integer) to service_role;
grant execute on function public.claim_ai_screening_task_item(uuid,uuid,text,text,integer) to service_role;
grant execute on function public.renew_ai_screening_item_lease(uuid,uuid,text,integer) to service_role;
grant execute on function public.release_ai_screening_item_lease(uuid,uuid,text) to service_role;
grant execute on function public.has_healthy_ai_worker(integer) to service_role;
grant execute on function public.claim_stalled_ai_tasks_for_vercel(integer) to service_role;
