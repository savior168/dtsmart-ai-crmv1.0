-- One customer master record is retained. A duplicate import creates a
-- private conflict record containing only the importing user's original fields.
create table if not exists public.customer_conflicts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  conflict_type text not null default 'DUPLICATE_IMPORT',
  status text not null default 'OPEN',
  details jsonb not null default '{}'::jsonb,
  reported_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.customer_conflicts add column if not exists reported_by uuid references auth.users(id);
alter table public.customer_conflicts add column if not exists conflict_type text not null default 'DUPLICATE_IMPORT';
alter table public.customer_conflicts add column if not exists status text not null default 'OPEN';
alter table public.customer_conflicts add column if not exists details jsonb not null default '{}'::jsonb;
create index if not exists customer_conflicts_reported_by_idx on public.customer_conflicts(reported_by, created_at desc);
create index if not exists customer_conflicts_customer_idx on public.customer_conflicts(customer_id, created_at desc);

alter table public.customer_conflicts enable row level security;
drop policy if exists customer_conflicts_select on public.customer_conflicts;
drop policy if exists customer_conflicts_insert on public.customer_conflicts;
drop policy if exists customer_conflicts_update on public.customer_conflicts;

-- Importer sees only their submitted field snapshot; the customer owner and
-- administrators can see the conflict for resolution. No follow-up or AI data
-- is stored in this table.
create policy customer_conflicts_select on public.customer_conflicts for select to authenticated using (
  reported_by = auth.uid()
  or public.current_user_role() = 'ADMIN'
  or exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = auth.uid())
);
create policy customer_conflicts_insert on public.customer_conflicts for insert to authenticated with check (reported_by = auth.uid());
create policy customer_conflicts_update on public.customer_conflicts for update to authenticated using (
  public.current_user_role() = 'ADMIN'
) with check (public.current_user_role() = 'ADMIN');

