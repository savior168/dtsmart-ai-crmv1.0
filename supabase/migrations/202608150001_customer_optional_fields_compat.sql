-- 兼容线上早期 customers 表。可重复执行。
alter table if exists public.customers add column if not exists website_email text;
alter table if exists public.customers add column if not exists website_phone text;
alter table if exists public.customers add column if not exists ai_screening_done boolean not null default false;
alter table if exists public.customers add column if not exists is_target_customer boolean;
alter table if exists public.customers add column if not exists business_relevance text;
alter table if exists public.customers add column if not exists customer_value text;
alter table if exists public.customers add column if not exists followup_suggestion text;
alter table if exists public.customers add column if not exists notes text;
create index if not exists idx_customers_ai_screening_done on public.customers(ai_screening_done);
