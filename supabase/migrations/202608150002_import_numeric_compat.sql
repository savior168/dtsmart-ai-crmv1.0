-- Import compatibility: external templates may contain ratings such as 10,
-- 10.0 or 100. Keep the field numeric and wide enough for legacy rows;
-- application validation still normalizes ratings to 0-5 before insert.
alter table if exists public.customers
  alter column rating type numeric(5,2)
  using case
    when rating is null then null
    else rating::numeric(5,2)
  end;

