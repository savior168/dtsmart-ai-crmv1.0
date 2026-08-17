-- Separate customer follow-up stage used by the customer list filters.
-- Additive and repeatable; existing customer stage/status is unchanged.
alter table public.customers
  add column if not exists followup_status text not null default 'WAITING_CONTACT';

update public.customers
set followup_status = 'WAITING_CONTACT'
where followup_status is null or followup_status = '';

create index if not exists idx_customers_followup_status
  on public.customers(followup_status);
