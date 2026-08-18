-- Compatibility migration for databases initialized before followup_status existed.
alter table public.customers add column if not exists followup_status text;
update public.customers
set followup_status = 'WAITING_CONTACT'
where followup_status is null or followup_status = '';
alter table public.customers alter column followup_status set default 'WAITING_CONTACT';
create index if not exists idx_customers_followup_status on public.customers(followup_status);
