begin;

alter table public.customers
  drop constraint if exists customers_manual_grade_check;

alter table public.customers
  add constraint customers_manual_grade_check
  check (manual_grade is null or manual_grade in ('S', 'KA', 'MA', 'A', 'B', 'C', 'D'));

commit;
