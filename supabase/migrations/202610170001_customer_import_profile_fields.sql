begin;

alter table public.customers
  add column if not exists manual_grade text,
  add column if not exists wechat text,
  add column if not exists tax_number text,
  add column if not exists tally_requirements text,
  add column if not exists forwarder_address text,
  add column if not exists other_address text;

alter table public.customers
  add constraint customers_manual_grade_check
  check (manual_grade is null or manual_grade in ('S', 'A', 'B', 'C', 'D'));

comment on column public.customers.manual_grade is '人工业务等级，独立于 AI 等级';

commit;
