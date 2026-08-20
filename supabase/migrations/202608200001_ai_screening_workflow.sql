-- DTSmart AI screening durable task workflow and traceable result archive.
-- Safe to run repeatedly in Supabase SQL Editor.

alter table if exists public.customers
  add column if not exists source_channel text,
  add column if not exists source_batch text,
  add column if not exists linkedin_url text,
  add column if not exists facebook_url text,
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists other_public_urls text[] not null default '{}'::text[],
  add column if not exists ai_last_result_id uuid,
  add column if not exists ai_last_screened_at timestamptz;

alter table if exists public.ai_screening_tasks
  add column if not exists task_number text,
  add column if not exists name text,
  add column if not exists strategy text not null default 'SMART',
  add column if not exists strategy_version text not null default '1.0',
  add column if not exists selection_mode text not null default 'FILTERED',
  add column if not exists filters jsonb not null default '{}'::jsonb,
  add column if not exists scheduled_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists workflow_run_id text,
  add column if not exists processed_count integer not null default 0,
  add column if not exists pending_count integer not null default 0,
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists cached_input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists total_cost_usd numeric(14,6) not null default 0,
  add column if not exists notification_mode text not null default 'IN_APP';

update public.ai_screening_tasks
set task_number = coalesce(task_number, 'AI-' || to_char(created_at, 'YYYYMMDD') || '-' || upper(substr(replace(id::text, '-', ''), 1, 6))),
    name = coalesce(nullif(name, ''), 'AI筛选任务'),
    processed_count = coalesce(success_count, 0) + coalesce(failed_count, 0),
    pending_count = greatest(coalesce(total_count, 0) - coalesce(success_count, 0) - coalesce(failed_count, 0), 0)
where task_number is null or name is null;

create unique index if not exists ai_screening_tasks_task_number_idx
  on public.ai_screening_tasks(task_number) where task_number is not null;
create index if not exists ai_screening_tasks_user_status_idx
  on public.ai_screening_tasks(user_id, status, created_at desc);

alter table if exists public.ai_screening_task_items
  add column if not exists current_step text not null default 'WAITING',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists max_attempts integer not null default 3,
  add column if not exists error_code text,
  add column if not exists retryable boolean not null default true,
  add column if not exists strategy text not null default 'SMART',
  add column if not exists strategy_version text not null default '1.0',
  add column if not exists analyzed_channels jsonb not null default '[]'::jsonb,
  add column if not exists skipped_channels jsonb not null default '[]'::jsonb,
  add column if not exists early_stop_reason text,
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists cached_input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists cost_usd numeric(14,6) not null default 0,
  add column if not exists duration_ms integer,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists ai_screening_task_items_customer_status_idx
  on public.ai_screening_task_items(customer_id, status);

alter table if exists public.ai_screening_results
  add column if not exists task_id uuid references public.ai_screening_tasks(id) on delete cascade,
  add column if not exists strategy text not null default 'SMART',
  add column if not exists strategy_version text not null default '1.0',
  add column if not exists confidence_score integer,
  add column if not exists evidence_sufficiency text,
  add column if not exists evidence_conflicts jsonb not null default '[]'::jsonb,
  add column if not exists business_relevance text,
  add column if not exists customer_value text,
  add column if not exists industry_type text,
  add column if not exists ai_reason text,
  add column if not exists analyzed_channels jsonb not null default '[]'::jsonb,
  add column if not exists skipped_channels jsonb not null default '[]'::jsonb,
  add column if not exists early_stop_reason text,
  add column if not exists model_calls integer not null default 0,
  add column if not exists input_tokens bigint not null default 0,
  add column if not exists cached_input_tokens bigint not null default 0,
  add column if not exists output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0,
  add column if not exists cost_usd numeric(14,6) not null default 0,
  add column if not exists pricing_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists model_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists completed_at timestamptz;

create index if not exists ai_screening_results_task_created_idx
  on public.ai_screening_results(task_id, created_at desc);
create index if not exists ai_screening_results_customer_created_idx
  on public.ai_screening_results(customer_id, created_at desc);

alter table if exists public.ai_screening_evidence
  add column if not exists task_id uuid references public.ai_screening_tasks(id) on delete cascade,
  add column if not exists customer_id uuid references public.customers(id) on delete cascade,
  add column if not exists channel text,
  add column if not exists status text not null default 'COLLECTED',
  add column if not exists error_code text,
  add column if not exists content_hash text;

drop policy if exists ai_task_items_self on public.ai_screening_task_items;
create policy ai_task_items_self on public.ai_screening_task_items
for select to authenticated using (
  exists (select 1 from public.ai_screening_tasks t where t.id = task_id and t.user_id = auth.uid())
);

drop policy if exists ai_results_self on public.ai_screening_results;
create policy ai_results_self on public.ai_screening_results
for select to authenticated using (
  exists (select 1 from public.ai_screening_tasks t where t.id = task_id and t.user_id = auth.uid())
);

drop policy if exists ai_evidence_self on public.ai_screening_evidence;
create policy ai_evidence_self on public.ai_screening_evidence
for select to authenticated using (
  exists (select 1 from public.ai_screening_tasks t where t.id = task_id and t.user_id = auth.uid())
);

create or replace function public.refresh_ai_screening_task_totals(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_screening_tasks t
  set success_count = x.success_count,
      failed_count = x.failed_count,
      processed_count = x.processed_count,
      pending_count = x.pending_count,
      input_tokens = x.input_tokens,
      cached_input_tokens = x.cached_input_tokens,
      output_tokens = x.output_tokens,
      total_tokens = x.total_tokens,
      total_cost_usd = x.total_cost_usd,
      updated_at = now()
  from (
    select
      count(*) filter (where status = 'COMPLETED')::integer success_count,
      count(*) filter (where status = 'FAILED')::integer failed_count,
      count(*) filter (where status in ('COMPLETED','FAILED'))::integer processed_count,
      count(*) filter (where status in ('PENDING','RUNNING'))::integer pending_count,
      coalesce(sum(input_tokens), 0)::bigint input_tokens,
      coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
      coalesce(sum(output_tokens), 0)::bigint output_tokens,
      coalesce(sum(total_tokens), 0)::bigint total_tokens,
      coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd
    from public.ai_screening_task_items where task_id = p_task_id
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid) from public, anon, authenticated;

