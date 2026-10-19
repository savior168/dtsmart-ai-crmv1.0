begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- customers uses column-level grants so the private AI evidence column stays
-- inaccessible through the Data API. Newly added profile fields need their
-- own explicit grants; do not grant table-wide access here.
grant select (manual_grade, wechat, tax_number, tally_requirements,
              forwarder_address, other_address, shipping_address),
      insert (manual_grade, wechat, tax_number, tally_requirements,
              forwarder_address, other_address, shipping_address),
      update (manual_grade, wechat, tax_number, tally_requirements,
              forwarder_address, other_address, shipping_address)
on table public.customers to authenticated;

do $migration$
begin
  if not has_column_privilege('authenticated', 'public.customers', 'manual_grade', 'SELECT')
    or not has_column_privilege('authenticated', 'public.customers', 'shipping_address', 'SELECT')
    or not has_column_privilege('authenticated', 'public.customers', 'tax_number', 'UPDATE')
    or has_column_privilege('authenticated', 'public.customers', 'company_scale_evidence', 'SELECT')
    or has_column_privilege('anon', 'public.customers', 'shipping_address', 'SELECT') then
    raise exception 'customer profile column privilege verification failed';
  end if;
end
$migration$;

commit;
