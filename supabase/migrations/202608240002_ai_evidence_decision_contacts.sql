-- Evidence-gated AI decisions, identity resolution and verified contact provenance.
-- Additive and idempotent; existing customer source fields are not changed.

alter table if exists public.ai_screening_results
  add column if not exists automation_status text not null default 'AUTO_HOLD',
  add column if not exists primary_industry text not null default 'UNKNOWN',
  add column if not exists secondary_industries jsonb not null default '[]'::jsonb,
  add column if not exists business_activities jsonb not null default '[]'::jsonb,
  add column if not exists industry_confidence integer,
  add column if not exists identity_confidence integer,
  add column if not exists decision_confidence integer,
  add column if not exists scale_confidence integer,
  add column if not exists contact_confidence integer,
  add column if not exists evidence_sufficiency_score integer,
  add column if not exists identity_status text not null default 'NOT_FOUND',
  add column if not exists identity_details jsonb not null default '{}'::jsonb,
  add column if not exists verified_business_name text,
  add column if not exists verified_address text,
  add column if not exists verified_website text,
  add column if not exists verified_google_maps_url text,
  add column if not exists place_id text,
  add column if not exists candidate_count integer,
  add column if not exists match_signals jsonb not null default '[]'::jsonb,
  add column if not exists mismatch_signals jsonb not null default '[]'::jsonb,
  add column if not exists parent_brand text,
  add column if not exists branch_name text,
  add column if not exists branch_place_id text,
  add column if not exists headquarters_relationship text,
  add column if not exists former_business_name text,
  add column if not exists relationship_type text,
  add column if not exists relationship_confidence integer,
  add column if not exists industry_evidence_ids jsonb not null default '[]'::jsonb,
  add column if not exists industry_conflicts jsonb not null default '[]'::jsonb,
  add column if not exists scale_analysis jsonb not null default '{"scale_level":"UNKNOWN"}'::jsonb,
  add column if not exists preferred_contact_type text,
  add column if not exists preferred_contact_value text,
  add column if not exists preferred_contact_source_url text,
  add column if not exists preferred_contact_reason text,
  add column if not exists preferred_contact_confidence integer,
  add column if not exists analysis_version text not null default '2026.08.24.2',
  add column if not exists retry_at timestamptz;

alter table if exists public.ai_screening_evidence
  add column if not exists source_id text,
  add column if not exists page_title text,
  add column if not exists original_fact text,
  add column if not exists translated_fact text,
  add column if not exists content_date timestamptz,
  add column if not exists source_reliability text,
  add column if not exists evidence_strength text,
  add column if not exists fetch_status text;

drop index if exists public.ai_screening_evidence_source_id_uidx;
create unique index ai_screening_evidence_source_id_uidx
  on public.ai_screening_evidence(result_id, source_id) where source_id is not null;

alter table if exists public.customer_contacts
  add column if not exists source_channel text,
  add column if not exists exact_source_url text,
  add column if not exists source_page_title text,
  add column if not exists contact_status text not null default 'ACTIVE_UNKNOWN',
  add column if not exists content_hash text,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.ai_screening_task_items
  add column if not exists automation_status text,
  add column if not exists retry_at timestamptz;

create unique index if not exists customer_contacts_content_hash_uidx
  on public.customer_contacts(customer_id, content_hash) where content_hash is not null;

create table if not exists public.ai_contact_audit_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_screening_tasks(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  result_id uuid references public.ai_screening_results(id) on delete cascade,
  action text not null,
  old_value text,
  new_value text,
  source_url text,
  captured_at timestamptz not null default now(),
  analysis_version text not null,
  created_at timestamptz not null default now()
);

create index if not exists ai_contact_audit_customer_created_idx
  on public.ai_contact_audit_logs(customer_id, created_at desc);

alter table public.ai_contact_audit_logs enable row level security;
drop policy if exists ai_contact_audit_self on public.ai_contact_audit_logs;
create policy ai_contact_audit_self on public.ai_contact_audit_logs
for select to authenticated using (
  exists (select 1 from public.ai_screening_tasks t where t.id = task_id and t.user_id = auth.uid())
);

alter table if exists public.ai_analysis_reuse_cache
  add column if not exists evidence_schema_version text not null default '2026.08.24.2',
  add column if not exists original_captured_at timestamptz,
  add column if not exists reused_at timestamptz;

update public.ai_analysis_reuse_cache
set original_captured_at = coalesce(original_captured_at, captured_at)
where original_captured_at is null;

