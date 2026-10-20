begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.customers
  add column if not exists forwarder_contact_entries jsonb not null default '[]'::jsonb;

alter table public.customers
  add constraint customers_forwarder_contact_entries_valid
  check (public.valid_shipping_contact_entries(forwarder_contact_entries));

grant select (forwarder_contact_entries), insert (forwarder_contact_entries), update (forwarder_contact_entries)
  on table public.customers to authenticated;

comment on column public.customers.forwarder_contact_entries is
  '货代收货人、联系电话与详细地址；历史地址在补全前仍保留于 forwarder_addresses。';
commit;
