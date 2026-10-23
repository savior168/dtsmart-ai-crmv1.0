begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.valid_shipping_contact_entries(p_entries jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  entry jsonb;
  recipient_text text;
  phone_text text;
  address_text text;
  digits text;
  addresses text[] := '{}'::text[];
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 10 then
    return false;
  end if;

  for entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(entry) <> 'object'
      or jsonb_typeof(entry->'address') is distinct from 'string'
      or jsonb_typeof(entry->'recipient') is distinct from 'string'
      or jsonb_typeof(entry->'phone') is distinct from 'string' then
      return false;
    end if;

    recipient_text := btrim(entry->>'recipient');
    phone_text := btrim(entry->>'phone');
    address_text := btrim(entry->>'address');
    if recipient_text = '' and phone_text = '' and address_text = '' then
      return false;
    end if;
    if char_length(recipient_text) > 200
      or char_length(phone_text) > 100
      or char_length(address_text) > 500 then
      return false;
    end if;
    if address_text <> '' then
      if address_text = any(addresses) then return false; end if;
      addresses := array_append(addresses, address_text);
    end if;
    if phone_text <> '' then
      if phone_text !~ '^[+]?[0-9 ().-]{6,25}$' then return false; end if;
      digits := regexp_replace(phone_text, '[^0-9]', '', 'g');
      if char_length(digits) not between 7 and 15
        or replace(digits, left(digits, 1), '') = '' then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function public.valid_shipping_contact_entries(jsonb) from public, anon;
grant execute on function public.valid_shipping_contact_entries(jsonb) to authenticated, service_role;

comment on function public.valid_shipping_contact_entries(jsonb) is
  'Validates up to ten optional customer/forwarder delivery contact entries; each field may be blank, but a non-empty entry must contain at least one value and any supplied phone must be valid.';

commit;
