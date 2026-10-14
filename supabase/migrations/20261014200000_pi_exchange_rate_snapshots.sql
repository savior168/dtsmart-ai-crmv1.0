begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Only the server-side scheduled task may write market reference rates.
create table public.pi_exchange_rate_snapshots (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  cny_per_unit numeric(24,12) not null check (cny_per_unit > 0),
  source text not null check (source in ('CFETS', 'AGGREGATED')),
  reference_date date not null,
  synced_at timestamptz not null default now()
);
alter table public.pi_exchange_rate_snapshots enable row level security;
revoke all on public.pi_exchange_rate_snapshots from anon, authenticated;
grant select, insert, update on public.pi_exchange_rate_snapshots to service_role;

commit;
