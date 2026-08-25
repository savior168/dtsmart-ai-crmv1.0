-- DTSmart AI screening v3: durable stages, evidence provenance and one accounting source.
-- Additive/idempotent. Existing results, evidence and customer source fields are preserved.

alter table if exists public.ai_screening_task_items
  add column if not exists analysis_status text not null default 'PENDING',
  add column if not exists writeback_status text not null default 'PENDING',
  add column if not exists pipeline_stage text not null default 'NORMALIZED',
  add column if not exists stage_timings jsonb not null default '{}'::jsonb,
  add column if not exists checkpoint jsonb not null default '{}'::jsonb,
  add column if not exists error_context jsonb not null default '{}'::jsonb,
  add column if not exists result_id uuid references public.ai_screening_results(id) on delete set null,
  add column if not exists active_attempt_number integer not null default 1,
  add column if not exists analysis_version text not null default '2026.08.24.3',
  add column if not exists writeback_warning_count integer not null default 0;

update public.ai_screening_task_items
set analysis_status = case
      when status = 'COMPLETED' then 'COMPLETED'
      when status = 'FAILED' then 'FAILED'
      when status = 'RUNNING' then 'RUNNING'
      else 'PENDING'
    end,
    writeback_status = case when status = 'COMPLETED' then 'COMPLETED' else 'PENDING' end,
    pipeline_stage = case
      when status = 'COMPLETED' then 'COMPLETED'
      when status = 'FAILED' then 'FAILED'
      when status = 'RUNNING' then coalesce(nullif(current_step, ''), 'EVIDENCE_COLLECTED')
      else 'NORMALIZED'
    end,
    active_attempt_number = greatest(coalesce(attempt_count, 1), 1)
where analysis_status = 'PENDING' and status <> 'PENDING';

alter table if exists public.ai_screening_results
  add column if not exists verified_industry text,
  add column if not exists target_fit text not null default 'UNCERTAIN',
  add column if not exists lead_priority text not null default 'LOW',
  add column if not exists purchase_scale text not null default 'UNKNOWN',
  add column if not exists decision_status text not null default 'NEEDS_REVIEW',
  add column if not exists evidence_ids jsonb not null default '[]'::jsonb,
  add column if not exists contradiction_evidence_ids jsonb not null default '[]'::jsonb,
  add column if not exists short_reason text,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists is_latest_valid boolean not null default true,
  add column if not exists writeback_status text not null default 'PENDING',
  add column if not exists writeback_warnings jsonb not null default '[]'::jsonb;

alter table if exists public.ai_screening_evidence
  add column if not exists task_item_id uuid references public.ai_screening_task_items(id) on delete cascade,
  add column if not exists source_channel text,
  add column if not exists source_name text,
  add column if not exists source_type text,
  add column if not exists canonical_url text,
  add column if not exists verification_url text,
  add column if not exists source_title text,
  add column if not exists source_account text,
  add column if not exists source_entity_id text,
  add column if not exists observed_at timestamptz,
  add column if not exists entity_match_score integer,
  add column if not exists original_excerpt text,
  add column if not exists media_type text,
  add column if not exists original_media_url text,
  add column if not exists thumbnail_url text,
  add column if not exists extraction_method text,
  add column if not exists source_status text,
  add column if not exists failure_code text,
  add column if not exists verification_status text not null default 'PENDING',
  add column if not exists verification_checked_at timestamptz;

update public.ai_screening_evidence
set source_channel = coalesce(source_channel, channel),
    source_name = coalesce(source_name, page_title, title, channel),
    source_type = coalesce(source_type, 'PUBLIC_WEB'),
    canonical_url = coalesce(canonical_url, source_url),
    verification_url = coalesce(verification_url, source_url),
    source_title = coalesce(source_title, page_title, title),
    observed_at = coalesce(observed_at, captured_at, fetched_at),
    original_excerpt = coalesce(original_excerpt, raw_excerpt, original_fact),
    source_status = coalesce(source_status, fetch_status, status),
    failure_code = coalesce(failure_code, error_code)
where source_channel is null
   or verification_url is null
   or original_excerpt is null;

alter table if exists public.customer_contacts
  add column if not exists verification_url text,
  add column if not exists fetched_at timestamptz;

update public.customer_contacts
set verification_url = coalesce(verification_url, exact_source_url, source_url),
    fetched_at = coalesce(fetched_at, captured_at)
where verification_url is null or fetched_at is null;

alter table if exists public.ai_screening_model_calls
  add column if not exists provider text not null default 'openai',
  add column if not exists request_id text,
  add column if not exists http_status integer,
  add column if not exists retryable boolean,
  add column if not exists error_details jsonb not null default '{}'::jsonb,
  add column if not exists pipeline_stage text;

create table if not exists public.ai_screening_stage_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_screening_tasks(id) on delete cascade,
  task_item_id uuid not null references public.ai_screening_task_items(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  attempt_number integer not null default 1,
  stage text not null,
  status text not null,
  channel text,
  provider text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_ms integer,
  checkpoint jsonb not null default '{}'::jsonb,
  error_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_item_id, attempt_number, stage)
);

create index if not exists ai_stage_events_task_created_idx
  on public.ai_screening_stage_events(task_id, created_at desc);
create index if not exists ai_stage_events_item_attempt_idx
  on public.ai_screening_stage_events(task_item_id, attempt_number, created_at);
create index if not exists ai_results_task_latest_idx
  on public.ai_screening_results(task_id, is_latest_valid, created_at desc);
create index if not exists ai_evidence_verification_idx
  on public.ai_screening_evidence(result_id, verification_status, evidence_strength);

alter table public.ai_screening_stage_events enable row level security;
drop policy if exists ai_stage_events_self on public.ai_screening_stage_events;
create policy ai_stage_events_self on public.ai_screening_stage_events
for select to authenticated using (
  exists (
    select 1 from public.ai_screening_tasks t
    where t.id = task_id and t.user_id = auth.uid()
  )
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
    with items as (
      select i.*,
             exists (
               select 1 from public.ai_screening_results r
               where r.task_item_id = i.id and coalesce(r.is_latest_valid, true)
             ) as has_valid_result
      from public.ai_screening_task_items i
      where i.task_id = p_task_id
    ), calls as (
      select
        coalesce(sum(input_tokens), 0)::bigint input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint output_tokens,
        coalesce(sum(total_tokens), 0)::bigint total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd,
        count(*)::integer call_count
      from public.ai_screening_model_calls
      where task_id = p_task_id
    ), item_totals as (
      select
        count(*) filter (where analysis_status = 'COMPLETED' or has_valid_result)::integer success_count,
        count(*) filter (where analysis_status = 'FAILED' and not has_valid_result)::integer failed_count,
        count(*) filter (where analysis_status in ('COMPLETED','FAILED') or has_valid_result)::integer processed_count,
        count(*) filter (where analysis_status in ('PENDING','RUNNING') and not has_valid_result)::integer pending_count,
        coalesce(sum(input_tokens), 0)::bigint input_tokens,
        coalesce(sum(cached_input_tokens), 0)::bigint cached_input_tokens,
        coalesce(sum(output_tokens), 0)::bigint output_tokens,
        coalesce(sum(total_tokens), 0)::bigint total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(14,6) total_cost_usd
      from items
    )
    select i.success_count, i.failed_count, i.processed_count, i.pending_count,
           case when c.call_count > 0 then c.input_tokens else i.input_tokens end input_tokens,
           case when c.call_count > 0 then c.cached_input_tokens else i.cached_input_tokens end cached_input_tokens,
           case when c.call_count > 0 then c.output_tokens else i.output_tokens end output_tokens,
           case when c.call_count > 0 then c.total_tokens else i.total_tokens end total_tokens,
           case when c.call_count > 0 then c.total_cost_usd else i.total_cost_usd end total_cost_usd
    from item_totals i cross join calls c
  ) x
  where t.id = p_task_id;
end;
$$;

revoke execute on function public.refresh_ai_screening_task_totals(uuid) from public, anon, authenticated;
