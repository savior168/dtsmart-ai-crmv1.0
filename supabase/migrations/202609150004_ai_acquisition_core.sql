begin;

create table if not exists public.ai_acquisition_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  task_number text not null unique,
  name text not null,
  cost_mode text not null check (cost_mode in ('FREE_ONLY','ADAPTIVE')),
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','PAUSING','PAUSED','COMPLETED','FAILED','CANCELLED')),
  countries text[] not null,
  industry text not null,
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  target_count integer not null check (target_count between 1 and 500),
  task_cost_limit_usd numeric(12,4),
  discovered_count integer not null default 0,
  processed_count integer not null default 0,
  accepted_count integer not null default 0,
  review_count integer not null default 0,
  rejected_count integer not null default 0,
  duplicate_count integer not null default 0,
  workflow_run_id text,
  active_executor text,
  executor_heartbeat_at timestamptz,
  last_dispatch_at timestamptz,
  recovery_count integer not null default 0,
  cancel_requested boolean not null default false,
  started_at timestamptz,
  pause_started_at timestamptz,
  paused_duration_ms bigint not null default 0,
  elapsed_ms bigint not null default 0,
  finished_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(countries) between 1 and 8),
  check (cost_mode <> 'FREE_ONLY' or coalesce(task_cost_limit_usd,0)=0)
);

create table if not exists public.ai_acquisition_candidates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_acquisition_tasks(id) on delete cascade,
  screening_task_id uuid references public.ai_screening_tasks(id) on delete set null,
  screening_task_item_id uuid references public.ai_screening_task_items(id) on delete set null,
  staging_customer_id uuid references public.customers(id) on delete set null,
  imported_customer_id uuid references public.customers(id) on delete set null,
  place_id text,
  company_name text,
  country text not null,
  address text,
  website text,
  google_url text,
  phone text,
  source_query text not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  decision text not null default 'DISCOVERED' check (decision in ('DISCOVERED','ANALYZING','ACCEPTED','REVIEW','REJECTED','DUPLICATE','FAILED')),
  decision_reason text,
  ai_score integer check (ai_score is null or ai_score between 0 and 100),
  ai_level text check (ai_level is null or ai_level in ('A','B','C','D')),
  is_target_customer boolean,
  has_actionable_contact boolean not null default false,
  evidence_complete boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ai_acquisition_candidates_task_place_uidx
  on public.ai_acquisition_candidates(task_id,place_id) where place_id is not null;
create index if not exists ai_acquisition_tasks_user_updated_idx on public.ai_acquisition_tasks(user_id,updated_at desc);
create index if not exists ai_acquisition_tasks_recovery_idx on public.ai_acquisition_tasks(status,executor_heartbeat_at)
  where status in ('QUEUED','RUNNING','PAUSING','PAUSED');
create index if not exists ai_acquisition_candidates_task_decision_idx on public.ai_acquisition_candidates(task_id,decision,updated_at desc);

alter table public.ai_acquisition_tasks enable row level security;
alter table public.ai_acquisition_candidates enable row level security;
-- Browser clients never read these tables directly. All reads and mutations
-- pass through permission-checked server routes using the service role.
revoke all on public.ai_acquisition_tasks, public.ai_acquisition_candidates from anon, authenticated;

create or replace function public.claim_stalled_ai_acquisition_tasks(p_limit integer default 3)
returns table(task_id uuid)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with candidates as (
    select t.id
    from public.ai_acquisition_tasks t
    where t.status in ('QUEUED','RUNNING','PAUSING')
      and not t.cancel_requested
      and (t.last_dispatch_at is null or t.last_dispatch_at < now() - interval '3 minutes')
      and (t.executor_heartbeat_at is null or t.executor_heartbeat_at < now() - interval '3 minutes')
    order by t.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  ), claimed as (
    update public.ai_acquisition_tasks t
    set elapsed_ms = t.elapsed_ms + case when t.started_at is not null then greatest(0,(extract(epoch from (coalesce(t.executor_heartbeat_at,t.started_at)-t.started_at))*1000)::bigint) else 0 end,
        started_at = null,
        active_executor = 'VERCEL_DISPATCHING',
        last_dispatch_at = now(),
        recovery_count = t.recovery_count + 1,
        updated_at = now()
    from candidates c where t.id=c.id
    returning t.id
  ) select claimed.id from claimed;
end;
$$;
revoke all on function public.claim_stalled_ai_acquisition_tasks(integer) from public, anon, authenticated;

-- Staging rows are deliberately invisible to customer lists until the final
-- evidence gate promotes them to PUBLIC_POOL/AVAILABLE.
alter table public.customers drop constraint if exists customers_pool_status_check;
alter table public.customers add constraint customers_pool_status_check
  check (pool_status is null or pool_status in ('AVAILABLE','CLAIMED','PENDING_ALLOCATION','INVALID','AI_STAGING'));

commit;
