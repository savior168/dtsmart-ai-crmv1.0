begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.customers
  add column if not exists shipping_addresses text[] not null default '{}'::text[],
  add column if not exists forwarder_addresses text[] not null default '{}'::text[];

create or replace function public.valid_customer_address_list(p_addresses text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item text;
  seen text[] := '{}'::text[];
begin
  if p_addresses is null or cardinality(p_addresses) > 10 then return false; end if;
  foreach item in array p_addresses loop
    if item is null or char_length(btrim(item)) not between 1 and 500 or btrim(item) = any(seen) then
      return false;
    end if;
    seen := array_append(seen, btrim(item));
  end loop;
  return true;
end;
$$;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'customers_shipping_addresses_limit' and conrelid = 'public.customers'::regclass) then
    alter table public.customers add constraint customers_shipping_addresses_limit check (public.valid_customer_address_list(shipping_addresses));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'customers_forwarder_addresses_limit' and conrelid = 'public.customers'::regclass) then
    alter table public.customers add constraint customers_forwarder_addresses_limit check (public.valid_customer_address_list(forwarder_addresses));
  end if;
end;
$constraints$;

create or replace function public.sync_customer_address_lists()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.shipping_addresses) > 0 then
      new.shipping_address := nullif(btrim(new.shipping_addresses[1]), '');
    elsif nullif(btrim(new.shipping_address), '') is not null then
      new.shipping_addresses := array[btrim(new.shipping_address)];
    end if;
    if cardinality(new.forwarder_addresses) > 0 then
      new.forwarder_address := nullif(btrim(new.forwarder_addresses[1]), '');
    elsif nullif(btrim(new.forwarder_address), '') is not null then
      new.forwarder_addresses := array[btrim(new.forwarder_address)];
    end if;
  else
    if new.shipping_addresses is distinct from old.shipping_addresses then
      new.shipping_address := nullif(btrim(new.shipping_addresses[1]), '');
    elsif new.shipping_address is distinct from old.shipping_address then
      if nullif(btrim(new.shipping_address), '') is null then
        new.shipping_addresses := '{}'::text[];
      else
        new.shipping_addresses := array[btrim(new.shipping_address)] || coalesce(new.shipping_addresses[2:10], '{}'::text[]);
      end if;
    end if;
    if new.forwarder_addresses is distinct from old.forwarder_addresses then
      new.forwarder_address := nullif(btrim(new.forwarder_addresses[1]), '');
    elsif new.forwarder_address is distinct from old.forwarder_address then
      if nullif(btrim(new.forwarder_address), '') is null then
        new.forwarder_addresses := '{}'::text[];
      else
        new.forwarder_addresses := array[btrim(new.forwarder_address)] || coalesce(new.forwarder_addresses[2:10], '{}'::text[]);
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_sync_address_lists on public.customers;
create trigger customers_sync_address_lists
before insert or update of shipping_address, shipping_addresses, forwarder_address, forwarder_addresses
on public.customers for each row execute function public.sync_customer_address_lists();

grant select (shipping_addresses, forwarder_addresses),
      insert (shipping_addresses, forwarder_addresses),
      update (shipping_addresses, forwarder_addresses)
on table public.customers to authenticated;

revoke all on function public.valid_customer_address_list(text[]) from public, anon;
grant execute on function public.valid_customer_address_list(text[]) to authenticated, service_role;

comment on column public.customers.shipping_addresses is '有序客户收货地址；第一条同步至 shipping_address，作为 PI 默认地址。';
comment on column public.customers.forwarder_addresses is '有序货代地址；第一条同步至 forwarder_address。';

commit;
