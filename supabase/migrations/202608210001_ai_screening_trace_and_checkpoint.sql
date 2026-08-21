-- AI screening trace, source checkpoints and model-call accounting.
-- AI-only additive migration: the customers table is intentionally untouched.

alter table if exists public.ai_screening_task_items
  add column if not exists channel_checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists checkpoint_version text not null default '1.0',
  add column if not exists last_completed_channel text,
  add column if not exists last_checkpoint_at timestamptz;

alter table if exists public.ai_screening_tasks
  add column if not exists request_key text;

create unique index if not exists ai_screening_tasks_user_request_key_uidx
  on public.ai_screening_tasks(user_id, request_key)
  where request_key is not null;

alter table if exists public.ai_screening_results
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists entity_match jsonb not null default '{}'::jsonb,
  add column if not exists manual_review_status text not null default 'NOT_REVIEWED',
  add column if not exists manual_review_note text,
  add column if not exists manual_reviewed_by uuid references auth.users(id),
  add column if not exists manual_reviewed_at timestamptz,
  add column if not exists suggested_contact_order jsonb not null default '[]'::jsonb,
  add column if not exists discovered_contacts jsonb not null default '{}'::jsonb,
  add column if not exists model_version text,
  add column if not exists rule_version text not null default '2026.08.21',
  add column if not exists field_mapping_version text not null default '2026.08.21';

create table if not exists public.ai_screening_model_calls (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_screening_tasks(id) on delete cascade,
  task_item_id uuid not null references public.ai_screening_task_items(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null,
  attempt_number integer not null default 1,
  model text,
  model_version text,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  cost_usd numeric(14,6) not null default 0,
  status text not null default 'COMPLETED',
  cache_hit boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique(task_item_id, channel, attempt_number)
);

create index if not exists ai_screening_model_calls_task_created_idx
  on public.ai_screening_model_calls(task_id, created_at desc);
create index if not exists ai_screening_model_calls_customer_created_idx
  on public.ai_screening_model_calls(customer_id, created_at desc);

alter table public.ai_screening_model_calls enable row level security;
drop policy if exists ai_model_calls_self on public.ai_screening_model_calls;
create policy ai_model_calls_self on public.ai_screening_model_calls
for select to authenticated using (
  exists (
    select 1 from public.ai_screening_tasks t
    where t.id = task_id and t.user_id = auth.uid()
  )
);
