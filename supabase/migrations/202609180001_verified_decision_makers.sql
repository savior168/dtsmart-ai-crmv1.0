-- Evidence-backed people who can make or influence a purchase decision.
-- AI suggestions are persisted only after source-text validation in the worker.
create table if not exists public.customer_decision_makers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  screening_result_id uuid references public.ai_screening_results(id) on delete set null,
  full_name text not null,
  job_title text not null,
  role_type text not null check (role_type in ('PROCUREMENT','OWNER','EXECUTIVE','OPERATIONS','OTHER')),
  contact_type text not null default 'NONE' check (contact_type in ('EMAIL','PHONE','WHATSAPP','NONE')),
  contact_value text,
  exact_source_url text not null,
  source_excerpt text not null,
  verification_status text not null default 'SOURCE_VERIFIED' check (verification_status in ('SOURCE_VERIFIED','STALE','REVOKED')),
  confidence integer not null check (confidence between 0 and 100),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, full_name, job_title, exact_source_url)
);

create index if not exists customer_decision_makers_customer_rank_idx
  on public.customer_decision_makers(customer_id, role_type, confidence desc, verified_at desc);

alter table public.customer_decision_makers enable row level security;
drop policy if exists customer_decision_makers_read on public.customer_decision_makers;
create policy customer_decision_makers_read on public.customer_decision_makers
for select to authenticated using (
  exists (
    select 1 from public.customers c
    where c.id = customer_id
      and (c.owner_id = auth.uid() or c.owner_id is null or exists (
        select 1 from public.users u where u.id = auth.uid() and u.role = 'ADMIN'
      ))
  )
);
