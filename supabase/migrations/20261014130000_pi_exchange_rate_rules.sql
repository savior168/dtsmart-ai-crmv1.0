begin;

create table public.pi_exchange_rate_rules (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  adjustment_mode text not null default 'OFFSET' check (adjustment_mode in ('OFFSET','PERCENT','FIXED')),
  adjustment_value numeric(18,6) not null default 0,
  manual_reference_cny numeric(18,6) check (manual_reference_cny > 0),
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.pi_exchange_rate_rules enable row level security;
create policy pi_exchange_rate_rules_read on public.pi_exchange_rate_rules for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.status='ACTIVE' and u.role in ('ADMIN','SUPERVISOR','SALES')));
create policy pi_exchange_rate_rules_admin_insert on public.pi_exchange_rate_rules for insert to authenticated
  with check (public.current_user_is_admin());
create policy pi_exchange_rate_rules_admin_update on public.pi_exchange_rate_rules for update to authenticated
  using (public.current_user_is_admin()) with check (public.current_user_is_admin());
grant select,insert,update on public.pi_exchange_rate_rules to authenticated;

commit;
