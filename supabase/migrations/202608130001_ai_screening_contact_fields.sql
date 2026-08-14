alter table public.customers add column if not exists website_email text;
alter table public.customers add column if not exists website_phone text;
alter table public.customers add column if not exists ai_screening_done boolean not null default false;
alter table public.customers add column if not exists is_target_customer boolean;
alter table public.customers add column if not exists business_relevance text;
alter table public.customers add column if not exists customer_value text;
alter table public.customers add column if not exists followup_suggestion text;
alter table public.customers add column if not exists notes text;
alter table public.users add column if not exists avatar_url text;

create index if not exists idx_customers_ai_screening_done on public.customers(ai_screening_done);
create index if not exists idx_customers_website_email on public.customers(website_email);
