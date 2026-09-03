begin;

alter table public.customers
  add column if not exists followup_status text;

update public.customers
set followup_status='WAITING_CONTACT'
where followup_status is null or btrim(followup_status)='';

alter table public.customers
  alter column followup_status set default 'WAITING_CONTACT',
  alter column followup_status set not null;

alter table public.customers
  drop constraint if exists customers_followup_status_check;

alter table public.customers
  add constraint customers_followup_status_check
  check (followup_status in ('WAITING_CONTACT','FOLLOWUP_REQUIRED','WAITING_REPLY','PAUSED','NO_FOLLOWUP'));

commit;
