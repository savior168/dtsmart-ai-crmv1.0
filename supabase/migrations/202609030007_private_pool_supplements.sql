begin;

create table if not exists public.customer_private_supplements (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  submitted_by uuid not null references public.users(id) on delete cascade,
  field_name text not null check (field_name in ('contact_name','phone','email','website','google_url','address')),
  value_raw text not null check (nullif(btrim(value_raw),'') is not null),
  value_normalized text not null check (nullif(btrim(value_normalized),'') is not null),
  source_type text not null check (source_type in ('BATCH_IMPORT','MANUAL_CREATE')),
  source_batch text,
  source_batch_id uuid references public.import_tasks(id) on delete set null,
  source_row integer,
  created_at timestamptz not null default now(),
  unique(customer_id,submitted_by,field_name,value_normalized)
);

create index if not exists customer_private_supplements_owner_idx
  on public.customer_private_supplements(submitted_by,customer_id,created_at desc);

alter table public.customer_private_supplements enable row level security;
drop policy if exists customer_private_supplements_own_select on public.customer_private_supplements;
create policy customer_private_supplements_own_select on public.customer_private_supplements
  for select to authenticated using (submitted_by=auth.uid());

revoke insert,update,delete on public.customer_private_supplements from authenticated;
grant select on public.customer_private_supplements to authenticated;

commit;
