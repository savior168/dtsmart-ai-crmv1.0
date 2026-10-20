begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

alter table public.customers add column if not exists shipping_contact_entries jsonb not null default '[]'::jsonb;
alter table public.sales_orders add column if not exists forwarder_address text;

create or replace function public.valid_shipping_contact_entries(p_entries jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare entry jsonb; digits text; addresses text[] := '{}'::text[]; address_text text;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 10 then return false; end if;
  for entry in select value from jsonb_array_elements(p_entries) loop
    if jsonb_typeof(entry) <> 'object' then return false; end if;
    address_text := btrim(coalesce(entry->>'address', ''));
    digits := regexp_replace(coalesce(entry->>'phone', ''), '[^0-9]', '', 'g');
    if jsonb_typeof(entry->'address') <> 'string'
      or jsonb_typeof(entry->'recipient') <> 'string'
      or jsonb_typeof(entry->'phone') <> 'string'
      or char_length(address_text) not between 1 and 500 or address_text = any(addresses)
      or char_length(btrim(coalesce(entry->>'recipient', ''))) not between 1 and 200
      or coalesce(entry->>'phone', '') !~ '^[+]?[0-9 ().-]{6,25}$'
      or char_length(digits) not between 7 and 15
      or replace(digits, left(digits, 1), '') = '' then return false; end if;
    addresses := array_append(addresses, address_text);
  end loop;
  return true;
end $$;

alter table public.customers add constraint customers_shipping_contact_entries_valid
  check (public.valid_shipping_contact_entries(shipping_contact_entries));
grant select (shipping_contact_entries), insert (shipping_contact_entries), update (shipping_contact_entries)
  on table public.customers to authenticated;
grant select (forwarder_address) on table public.sales_orders to authenticated;
revoke all on function public.valid_shipping_contact_entries(jsonb) from public, anon;
grant execute on function public.valid_shipping_contact_entries(jsonb) to authenticated, service_role;

create or replace function public.apply_direct_pi_fees(p_order_id uuid, p_fees jsonb)
returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare
  target public.sales_orders;
  result public.sales_orders;
  balance numeric[]; discount numeric[]; other_fee numeric[];
  rate_percent numeric; fee_cny numeric(14,2); fee_payment numeric(14,2);
  base_cny numeric(14,2); base_payment numeric(14,2);
begin
  select * into target from public.sales_orders where id = p_order_id for update;
  if target.id is null or target.confirmation_method <> 'DIRECT_PI' or target.status <> 'DRAFT'
    or target.fx_rate_cny_to_payment is null or target.fx_rate_cny_to_payment <= 0 then
    raise exception 'PI草稿不可更新费用';
  end if;
  if p_fees is null or jsonb_typeof(p_fees) <> 'object' then raise exception 'PI附加费用格式不正确'; end if;
  if p_fees ? 'show_dual_currency_prices' and jsonb_typeof(p_fees->'show_dual_currency_prices') <> 'boolean' then
    raise exception 'PI双币种展示选项不正确';
  end if;
  if p_fees ? 'forwarder_address' then
    if nullif(btrim(coalesce(p_fees->>'forwarder_address', '')), '') is not null
      and btrim(p_fees->>'forwarder_address') is distinct from target.forwarder_address and
      not exists (select 1 from public.customers c where c.id = target.customer_id
        and btrim(p_fees->>'forwarder_address') = any(c.forwarder_addresses)) then
      raise exception '所选货代地址不属于当前客户';
    end if;
    if exists (select 1 from public.customers c where c.id = target.customer_id
      and cardinality(c.forwarder_addresses) > 0)
      and nullif(btrim(coalesce(p_fees->>'forwarder_address', '')), '') is null then
      raise exception '请选择客户货代地址';
    end if;
  end if;
  balance := public.pi_fee_pair(p_fees->'last_balance', target.fx_rate_cny_to_payment);
  discount := public.pi_fee_pair(p_fees->'discount', target.fx_rate_cny_to_payment);
  other_fee := public.pi_fee_pair(p_fees->'other', target.fx_rate_cny_to_payment);
  if coalesce(p_fees->>'paypal_rate_percent', '') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]{1,4})?$' then
    raise exception 'PayPal手续费百分比格式不正确';
  end if;
  rate_percent := (p_fees->>'paypal_rate_percent')::numeric;
  if rate_percent > 100 then raise exception 'PayPal手续费百分比不能超过100%%'; end if;
  if target.payment_method is distinct from 'PayPal' then rate_percent := 0; end if;
  base_cny := target.subtotal_cny + target.shipping_cny + balance[1] + other_fee[1] - discount[1];
  base_payment := target.subtotal + target.shipping_cost + balance[2] + other_fee[2] - discount[2];
  if base_cny < 0 or base_payment < 0 then raise exception '折扣不得超过本单应付金额'; end if;
  fee_cny := round(base_cny * rate_percent / 100, 2);
  fee_payment := round(base_payment * rate_percent / 100, 2);
  update public.sales_orders set
    forwarder_address = case when p_fees ? 'forwarder_address' then nullif(btrim(p_fees->>'forwarder_address'), '') else target.forwarder_address end,
    show_dual_currency_prices = coalesce((p_fees->>'show_dual_currency_prices')::boolean, false),
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = base_cny + fee_cny, total_amount = base_payment + fee_payment
  where id = target.id returning * into result;
  update public.quotes set
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = result.total_cny, total_amount = result.total_amount, amount = result.total_amount
  where id = target.quote_id;
  return result;
end $$;
revoke all on function public.apply_direct_pi_fees(uuid,jsonb) from public, anon, authenticated;
comment on column public.customers.shipping_contact_entries is '每条客户收货地址对应的收货人和联系电话；历史地址在补全前保留于 shipping_addresses。';
comment on column public.sales_orders.forwarder_address is '创建或修改 PI 草稿时选定的客户货代地址快照，不随客户资料后续修改而变化。';
commit;
