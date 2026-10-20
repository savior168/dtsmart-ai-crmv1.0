-- Applied as 20261020102810 on the shared database before candidate validation.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.sales_orders
  add column if not exists forwarder_recipient text,
  add column if not exists forwarder_phone text;

grant select (forwarder_recipient, forwarder_phone) on table public.sales_orders to authenticated;

create or replace function public.snapshot_pi_forwarder_contact()
returns trigger language plpgsql security definer set search_path = '' as $$
declare selected jsonb;
begin
  selected := null;
  if nullif(btrim(coalesce(new.forwarder_address, '')), '') is not null then
    select entry.value into selected
    from public.customers c,
         jsonb_array_elements(c.forwarder_contact_entries) as entry(value)
    where c.id = new.customer_id
      and btrim(entry.value->>'address') = btrim(new.forwarder_address)
    limit 1;
  end if;
  new.forwarder_recipient := nullif(btrim(coalesce(selected->>'recipient', '')), '');
  new.forwarder_phone := nullif(btrim(coalesce(selected->>'phone', '')), '');
  return new;
end $$;

drop trigger if exists sales_orders_snapshot_forwarder_contact on public.sales_orders;
create trigger sales_orders_snapshot_forwarder_contact
before insert or update of forwarder_address, customer_id on public.sales_orders
for each row execute function public.snapshot_pi_forwarder_contact();

create or replace view public.stock_orders_with_pi_preparer
  with (security_invoker = true) as
select stock.*, pi.prepared_by as pi_prepared_by, pi.updated_at as pi_updated_at
from public.stock_orders stock
left join public.sales_orders pi on pi.id = stock.sales_order_id;
revoke all on public.stock_orders_with_pi_preparer from public, anon;
grant select on public.stock_orders_with_pi_preparer to authenticated;

revoke all on function public.snapshot_pi_forwarder_contact() from public, anon, authenticated;
comment on column public.sales_orders.forwarder_recipient is '本单选定货代收货人的历史快照。';
comment on column public.sales_orders.forwarder_phone is '本单选定货代收货电话的历史快照。';
commit;
