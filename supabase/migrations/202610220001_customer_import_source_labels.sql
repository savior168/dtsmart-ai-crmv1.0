begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.customers
  add column source_stage_label text,
  add column source_grade_label text;

alter table public.customers
  add constraint customers_source_stage_label_length_check
    check (source_stage_label is null or char_length(source_stage_label) <= 100),
  add constraint customers_source_grade_label_length_check
    check (source_grade_label is null or char_length(source_grade_label) <= 50);

grant select (source_stage_label, source_grade_label) on table public.customers to authenticated;

do $migration$
begin
  if has_column_privilege('authenticated', 'public.customers', 'source_stage_label', 'INSERT')
    or has_column_privilege('authenticated', 'public.customers', 'source_stage_label', 'UPDATE')
    or has_column_privilege('authenticated', 'public.customers', 'source_grade_label', 'INSERT')
    or has_column_privilege('authenticated', 'public.customers', 'source_grade_label', 'UPDATE')
    or not has_column_privilege('authenticated', 'public.customers', 'source_stage_label', 'SELECT')
    or not has_column_privilege('authenticated', 'public.customers', 'source_grade_label', 'SELECT') then
    raise exception 'customer import source label column privilege verification failed';
  end if;
end
$migration$;

comment on column public.customers.source_stage_label is 'Imported customer stage from source files; informational only and never drives public-pool workflow status.';
comment on column public.customers.source_grade_label is 'Imported customer grade from source files; informational only and never drives public-pool workflow status.';

commit;
