create extension if not exists "pgcrypto";

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  industry text,
  city text,
  company_size text,
  contact_name text,
  contact_role text,
  ai_score integer not null default 0 check (ai_score between 0 and 100),
  intent_level text not null default '培育中',
  status text not null default '待联系',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;
create policy "authenticated users can read leads" on public.leads for select to authenticated using (true);
