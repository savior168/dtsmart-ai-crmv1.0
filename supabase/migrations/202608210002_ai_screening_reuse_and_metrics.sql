-- AI screening result reuse, readable evidence, contact provenance and accurate timing.
-- Additive only: the customers table is intentionally unchanged.

alter table if exists public.ai_screening_tasks
  add column if not exists finished_at timestamptz,
  add column if not exists elapsed_ms bigint,
  add column if not exists pause_started_at timestamptz,
  add column if not exists paused_duration_ms bigint not null default 0;

alter table if exists public.ai_screening_task_items
  add column if not exists cache_reused boolean not null default false,
  add column if not exists reuse_source_result_id uuid references public.ai_screening_results(id) on delete set null;

alter table if exists public.ai_screening_evidence
  add column if not exists source_record_id text,
  add column if not exists captured_at timestamptz not null default now(),
  add column if not exists identity_match_status text not null default 'unverified',
  add column if not exists raw_excerpt text,
  add column if not exists normalized_fact text,
  add column if not exists supports text,
  add column if not exists contradicts text,
  add column if not exists evidence_confidence integer,
  add column if not exists extractor_version text not null default '2026.08.21',
  add column if not exists snapshot_reference text,
  add column if not exists failure_reason text;

alter table if exists public.customer_contacts
  add column if not exists source_url text,
  add column if not exists captured_at timestamptz not null default now(),
  add column if not exists identity_match_status text not null default 'unverified',
  add column if not exists verification_status text not null default 'SOURCE_CONFIRMED';

create unique index if not exists customer_contacts_ai_normalized_uidx
  on public.customer_contacts(customer_id, type, value_normalized, source)
  where value_normalized is not null;

create table if not exists public.ai_analysis_reuse_cache (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null,
  source_customer_id uuid references public.customers(id) on delete set null,
  source_result_id uuid references public.ai_screening_results(id) on delete set null,
  strategy text not null,
  rule_version text not null,
  field_mapping_version text not null,
  source_signature text not null,
  analysis_result jsonb not null,
  evidence_snapshot jsonb not null default '[]'::jsonb,
  discovered_contacts jsonb not null default '{}'::jsonb,
  model_snapshot jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(identity_key, strategy, rule_version, source_signature)
);

create index if not exists ai_analysis_reuse_cache_lookup_idx
  on public.ai_analysis_reuse_cache(identity_key, strategy, rule_version, expires_at desc);

alter table public.ai_analysis_reuse_cache enable row level security;
-- Intentionally no authenticated policy: cache lookup/write is service-role only.

