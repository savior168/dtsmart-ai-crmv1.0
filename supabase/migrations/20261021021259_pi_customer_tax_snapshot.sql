-- Preserve the customer tax number used when a PI is created. Historical rows
-- intentionally stay null: today's customer profile cannot prove their value.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.sales_orders
  add column if not exists customer_tax_number_snapshot text,
  add column if not exists customer_name_snapshot text;

grant select (customer_tax_number_snapshot, customer_name_snapshot) on table public.sales_orders to authenticated;

create or replace function public.snapshot_pi_customer_tax_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.customer_id is not distinct from old.customer_id then
    new.customer_tax_number_snapshot := old.customer_tax_number_snapshot;
    new.customer_name_snapshot := old.customer_name_snapshot;
    return new;
  end if;

  select nullif(btrim(c.tax_number), ''), nullif(btrim(c.contact_name), '')
    into new.customer_tax_number_snapshot, new.customer_name_snapshot
  from public.customers c
  where c.id = new.customer_id;
  return new;
end $$;

drop trigger if exists sales_orders_snapshot_customer_tax_number on public.sales_orders;
create trigger sales_orders_snapshot_customer_tax_number
before insert or update of customer_id, customer_tax_number_snapshot on public.sales_orders
for each row execute function public.snapshot_pi_customer_tax_number();

revoke all on function public.snapshot_pi_customer_tax_number() from public, anon, authenticated;
comment on column public.sales_orders.customer_tax_number_snapshot is
  'PI 创建时客户税号快照；历史未留存的单据保持 null，不用当前客户资料回填。';
comment on column public.sales_orders.customer_name_snapshot is
  'PI 创建时客户名称快照；历史未留存的单据保持 null，不用当前客户资料回填。';
commit;
