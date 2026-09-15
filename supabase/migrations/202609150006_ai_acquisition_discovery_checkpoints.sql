begin;

create table if not exists public.ai_acquisition_discovery_checkpoints (
  task_id uuid not null references public.ai_acquisition_tasks(id) on delete cascade,
  country text not null,
  query_text text not null,
  next_page integer not null default 1 check (next_page between 1 and 4),
  next_page_token text,
  status text not null default 'PENDING' check (status in ('PENDING','RUNNING','PAUSED','COMPLETED','BUDGET_LIMITED')),
  stop_reason text,
  result_count integer not null default 0,
  results jsonb not null default '[]'::jsonb,
  last_request_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (task_id,country,query_text)
);

create index if not exists ai_acquisition_discovery_checkpoints_task_status_idx
  on public.ai_acquisition_discovery_checkpoints(task_id,status,updated_at);

alter table public.ai_acquisition_discovery_checkpoints enable row level security;
revoke all on public.ai_acquisition_discovery_checkpoints from anon, authenticated;

commit;
