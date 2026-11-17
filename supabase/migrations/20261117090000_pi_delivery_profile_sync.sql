-- A PI keeps its own delivery snapshot. Also remember newly entered delivery
-- profiles on the customer so the next PI can select them without retyping.
-- Existing snapshots fill blanks from a selected customer profile, but must not
-- erase a recipient or phone explicitly entered for a new forwarder address.
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
  new.forwarder_recipient := coalesce(nullif(btrim(coalesce(new.forwarder_recipient, '')), ''),
    nullif(btrim(coalesce(selected->>'recipient', '')), ''));
  new.forwarder_phone := coalesce(nullif(btrim(coalesce(new.forwarder_phone, '')), ''),
    nullif(btrim(coalesce(selected->>'phone', '')), ''));
  return new;
end;
$$;

create function public.sync_pi_delivery_profiles()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  customer_row public.customers;
  channel integer;
  address_value text;
  recipient_value text;
  phone_value text;
  address_key text;
  existing_key text;
  addresses text[];
  contacts jsonb;
  merged_contacts jsonb;
  contact_row jsonb;
  seen_contact boolean;
  matched_address boolean;
  canonical_address text;
  position integer;
begin
  if new.confirmation_method is distinct from 'DIRECT_PI' then return new; end if;
  if tg_op = 'UPDATE' and row(new.delivery_address,new.delivery_recipient,new.delivery_phone,
      new.forwarder_address,new.forwarder_recipient,new.forwarder_phone) is not distinct from
      row(old.delivery_address,old.delivery_recipient,old.delivery_phone,
      old.forwarder_address,old.forwarder_recipient,old.forwarder_phone) then return new; end if;
  select * into customer_row from public.customers
    where id = new.customer_id and deleted_at is null for update;
  if customer_row.id is null then return new; end if;

  for channel in 1..2 loop
    if channel = 1 then
      address_value := btrim(coalesce(new.delivery_address,''));
      recipient_value := btrim(coalesce(new.delivery_recipient,''));
      phone_value := btrim(coalesce(new.delivery_phone,''));
      addresses := coalesce(customer_row.shipping_addresses, '{}'::text[]);
      if cardinality(addresses) = 0 and nullif(btrim(coalesce(customer_row.shipping_address,'')),'') is not null then
        addresses := array[btrim(customer_row.shipping_address)];
      end if;
      contacts := case when jsonb_typeof(customer_row.shipping_contact_entries) = 'array'
        then customer_row.shipping_contact_entries else '[]'::jsonb end;
    else
      address_value := btrim(coalesce(new.forwarder_address,''));
      recipient_value := btrim(coalesce(new.forwarder_recipient,''));
      phone_value := btrim(coalesce(new.forwarder_phone,''));
      addresses := coalesce(customer_row.forwarder_addresses, '{}'::text[]);
      if cardinality(addresses) = 0 and nullif(btrim(coalesce(customer_row.forwarder_address,'')),'') is not null then
        addresses := array[btrim(customer_row.forwarder_address)];
      end if;
      contacts := case when jsonb_typeof(customer_row.forwarder_contact_entries) = 'array'
        then customer_row.forwarder_contact_entries else '[]'::jsonb end;
    end if;
    if address_value = '' or recipient_value = '' or phone_value = '' then continue; end if;
    address_key := regexp_replace(lower(address_value), '[[:space:]]+', ' ', 'g');
    matched_address := false;
    canonical_address := address_value;
    for position in 1..cardinality(addresses) loop
      if regexp_replace(lower(btrim(addresses[position])), '[[:space:]]+', ' ', 'g') = address_key then
        matched_address := true;
        canonical_address := addresses[position];
        exit;
      end if;
    end loop;
    if not matched_address then
      if cardinality(addresses) >= 10 then
        raise exception '客户收货或货代地址已达10条，请先在客户资料中整理地址';
      end if;
      addresses := array_append(addresses, address_value);
    end if;
    merged_contacts := '[]'::jsonb;
    seen_contact := false;
    for contact_row in select value from jsonb_array_elements(contacts) loop
      existing_key := regexp_replace(lower(btrim(coalesce(contact_row->>'address',''))), '[[:space:]]+', ' ', 'g');
      if existing_key = address_key then
        if not seen_contact then
          merged_contacts := merged_contacts || jsonb_build_array(jsonb_build_object(
            'address', canonical_address,
            'recipient', recipient_value, 'phone', phone_value));
          seen_contact := true;
        end if;
      else
        merged_contacts := merged_contacts || jsonb_build_array(contact_row);
      end if;
    end loop;
    if not seen_contact then
      merged_contacts := merged_contacts || jsonb_build_array(jsonb_build_object(
        'address', canonical_address,
        'recipient', recipient_value, 'phone', phone_value));
    end if;
    if channel = 1 then
      if addresses is distinct from customer_row.shipping_addresses
        or merged_contacts is distinct from customer_row.shipping_contact_entries then
        update public.customers set shipping_addresses = addresses,
          shipping_address = addresses[1], shipping_contact_entries = merged_contacts,
          updated_at = now() where id = customer_row.id;
      end if;
    else
      if addresses is distinct from customer_row.forwarder_addresses
        or merged_contacts is distinct from customer_row.forwarder_contact_entries then
        update public.customers set forwarder_addresses = addresses,
          forwarder_address = addresses[1], forwarder_contact_entries = merged_contacts,
          updated_at = now() where id = customer_row.id;
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.sync_pi_delivery_profiles() from public, anon, authenticated;
create trigger sync_pi_delivery_profiles_after_order_save
after insert or update of delivery_address,delivery_recipient,delivery_phone,
  forwarder_address,forwarder_recipient,forwarder_phone on public.sales_orders
for each row execute function public.sync_pi_delivery_profiles();
