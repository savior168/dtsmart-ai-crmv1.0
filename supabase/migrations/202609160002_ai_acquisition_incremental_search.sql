begin;

create table if not exists public.ai_acquisition_search_scopes (
  scope_key text primary key,
  country text not null,
  query_text text not null,
  strategy_version text not null default 'GOOGLE_TEXT_V1',
  state text not null default 'AVAILABLE' check (state in ('AVAILABLE','RUNNING','COMPLETED')),
  active_task_id uuid references public.ai_acquisition_tasks(id) on delete set null,
  last_completed_task_id uuid references public.ai_acquisition_tasks(id) on delete set null,
  last_completed_at timestamptz,
  last_result_count integer not null default 0,
  run_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_acquisition_search_scopes_active_task_idx
  on public.ai_acquisition_search_scopes(active_task_id) where active_task_id is not null;
create index if not exists ai_acquisition_search_scopes_completed_idx
  on public.ai_acquisition_search_scopes(last_completed_at desc) where last_completed_at is not null;

alter table public.ai_acquisition_search_scopes enable row level security;
revoke all on public.ai_acquisition_search_scopes from anon, authenticated;

-- Preserve completed discovery work from tasks created before this ledger was
-- introduced, so the first deployment does not pay to search it all again.
insert into public.ai_acquisition_search_scopes(
  scope_key,country,query_text,state,last_completed_task_id,last_completed_at,last_result_count,run_count
)
select distinct on ('GOOGLE_TEXT_V1'||chr(10)||country||chr(10)||lower(trim(query_text)))
  'GOOGLE_TEXT_V1'||chr(10)||country||chr(10)||lower(trim(query_text)),
  country,query_text,'COMPLETED',task_id,updated_at,result_count,1
from public.ai_acquisition_discovery_checkpoints
where status='COMPLETED'
order by 'GOOGLE_TEXT_V1'||chr(10)||country||chr(10)||lower(trim(query_text)),updated_at desc
on conflict (scope_key) do nothing;

create or replace function public.claim_ai_acquisition_search_scope(
  p_scope_key text,
  p_task_id uuid,
  p_country text,
  p_query_text text,
  p_refresh_days integer default 90
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope public.ai_acquisition_search_scopes%rowtype;
  v_active_status text;
begin
  insert into public.ai_acquisition_search_scopes(scope_key,country,query_text)
  values (p_scope_key,p_country,p_query_text)
  on conflict (scope_key) do nothing;

  select * into v_scope from public.ai_acquisition_search_scopes
  where scope_key=p_scope_key for update;

  if v_scope.active_task_id is not null and v_scope.active_task_id<>p_task_id then
    select status into v_active_status from public.ai_acquisition_tasks where id=v_scope.active_task_id;
    if v_active_status in ('QUEUED','RUNNING','PAUSING','PAUSED') then
      return 'ACTIVE_ELSEWHERE';
    end if;
  end if;

  if v_scope.last_completed_at is not null
     and v_scope.last_completed_at >= now() - make_interval(days => greatest(1,least(coalesce(p_refresh_days,90),365))) then
    return 'RECENTLY_COMPLETED';
  end if;

  update public.ai_acquisition_search_scopes
  set state='RUNNING', active_task_id=p_task_id, run_count=run_count+1, updated_at=now()
  where scope_key=p_scope_key;
  return 'CLAIMED';
end;
$$;

create or replace function public.complete_ai_acquisition_search_scope(
  p_scope_key text,
  p_task_id uuid,
  p_result_count integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_acquisition_search_scopes
  set state='COMPLETED', active_task_id=null, last_completed_task_id=p_task_id,
      last_completed_at=now(), last_result_count=greatest(0,coalesce(p_result_count,0)), updated_at=now()
  where scope_key=p_scope_key and active_task_id=p_task_id;
  return found;
end;
$$;

revoke all on function public.claim_ai_acquisition_search_scope(text,uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.complete_ai_acquisition_search_scope(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_ai_acquisition_search_scope(text,uuid,text,text,integer) to service_role;
grant execute on function public.complete_ai_acquisition_search_scope(text,uuid,integer) to service_role;

alter table public.ai_acquisition_discovery_checkpoints drop constraint if exists ai_acquisition_discovery_checkpoints_status_check;
alter table public.ai_acquisition_discovery_checkpoints add constraint ai_acquisition_discovery_checkpoints_status_check
  check (status in ('PENDING','RUNNING','PAUSED','COMPLETED','BUDGET_LIMITED','SKIPPED_RECENT','SKIPPED_ACTIVE'));

commit;
