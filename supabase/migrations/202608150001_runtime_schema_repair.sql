-- Idempotent compatibility migration for optional AI enrichment fields.
alter table public.customers add column if not exists ai_screening_done boolean not null default false;
alter table public.customers add column if not exists is_target_customer boolean;
alter table public.customers add column if not exists website_email text;
alter table public.customers add column if not exists website_phone text;
alter table public.customers add column if not exists business_relevance text;
alter table public.customers add column if not exists customer_value text;
alter table public.customers add column if not exists followup_suggestion text;

create index if not exists customers_ai_pending_idx
  on public.customers (created_at desc)
  where deleted_at is null and ai_score is null;
