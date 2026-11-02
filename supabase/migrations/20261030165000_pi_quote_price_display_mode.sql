begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Leave historical rows untouched; null preserves their legacy show_dual_currency_prices setting.
-- New direct PI orders write their explicit mode through apply_direct_pi_fees.
alter table public.sales_orders add column price_display_mode text;
alter table public.sales_orders add constraint sales_orders_price_display_mode_check
  check (price_display_mode in ('PAYMENT_ONLY', 'CNY_ONLY', 'DUAL'));

create or replace function public.apply_direct_pi_fees(p_order_id uuid, p_fees jsonb)
returns public.sales_orders language plpgsql security definer set search_path = '' as $$
declare
  target public.sales_orders;
  result public.sales_orders;
  balance numeric[]; discount numeric[]; other_fee numeric[]; shipping_pair numeric[];
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
  if p_fees ? 'price_display_mode' and p_fees->>'price_display_mode' not in ('PAYMENT_ONLY', 'CNY_ONLY', 'DUAL') then
    raise exception 'PI报价展示方式不正确';
  end if;
  if p_fees ? 'forwarder_address' then
    if p_fees ? 'forwarder_recipient' or p_fees ? 'forwarder_phone' then
      if char_length(btrim(coalesce(p_fees->>'forwarder_address', ''))) > 500
        or char_length(btrim(coalesce(p_fees->>'forwarder_recipient', ''))) > 200
        or char_length(btrim(coalesce(p_fees->>'forwarder_phone', ''))) > 100 then
        raise exception '货代收货信息超出允许长度';
      end if;
      if (nullif(btrim(coalesce(p_fees->>'forwarder_address', '')), '') is null)
        <> (nullif(btrim(coalesce(p_fees->>'forwarder_recipient', '')), '') is null)
        or (nullif(btrim(coalesce(p_fees->>'forwarder_address', '')), '') is null)
        <> (nullif(btrim(coalesce(p_fees->>'forwarder_phone', '')), '') is null) then
        raise exception '货代收货人、电话和地址须同时填写或全部留空';
      end if;
    elsif nullif(btrim(coalesce(p_fees->>'forwarder_address', '')), '') is not null
      and btrim(p_fees->>'forwarder_address') is distinct from target.forwarder_address and
      not exists (select 1 from public.customers c where c.id = target.customer_id
        and btrim(p_fees->>'forwarder_address') = any(c.forwarder_addresses)) then
      raise exception '所选货代地址不属于当前客户';
    end if;
  end if;
  balance := public.pi_fee_pair(p_fees->'last_balance', target.fx_rate_cny_to_payment);
  discount := public.pi_fee_pair(p_fees->'discount', target.fx_rate_cny_to_payment);
  other_fee := public.pi_fee_pair(p_fees->'other', target.fx_rate_cny_to_payment);
  shipping_pair := case when p_fees ? 'shipping'
    then public.pi_fee_pair(p_fees->'shipping', target.fx_rate_cny_to_payment)
    else array[target.shipping_cny, target.shipping_cost] end;
  if abs(shipping_pair[1] - target.shipping_cny) > 0.001 then
    raise exception '运费双币种换算不一致';
  end if;
  if coalesce(p_fees->>'paypal_rate_percent', '') !~ '^(0|[1-9][0-9]?|100)(\.[0-9]{1,4})?$' then
    raise exception 'PayPal手续费百分比格式不正确';
  end if;
  rate_percent := (p_fees->>'paypal_rate_percent')::numeric;
  if rate_percent > 100 then raise exception 'PayPal手续费百分比不能超过100%%'; end if;
  if target.payment_method is distinct from 'PayPal' then rate_percent := 0; end if;
  base_cny := target.subtotal_cny + shipping_pair[1] + balance[1] + other_fee[1] - discount[1];
  base_payment := target.subtotal + shipping_pair[2] + balance[2] + other_fee[2] - discount[2];
  if base_cny < 0 or base_payment < 0 then raise exception '折扣不得超过本单应付金额'; end if;
  fee_cny := round(base_cny * rate_percent / 100, 2);
  fee_payment := round(base_payment * rate_percent / 100, 2);
  update public.sales_orders set
    forwarder_address = case when p_fees ? 'forwarder_address' then nullif(btrim(p_fees->>'forwarder_address'), '') else target.forwarder_address end,
    show_dual_currency_prices = coalesce((p_fees->>'show_dual_currency_prices')::boolean, false),
    price_display_mode = coalesce(p_fees->>'price_display_mode', case when coalesce((p_fees->>'show_dual_currency_prices')::boolean, false) then 'DUAL' else 'PAYMENT_ONLY' end),
    shipping_cny = shipping_pair[1], shipping_cost = shipping_pair[2],
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = base_cny + fee_cny, total_amount = base_payment + fee_payment
  where id = target.id returning * into result;
  -- The existing address trigger first populates saved customer contacts. Override
  -- them only for new requests that explicitly supply this PI's own contact fields.
  if p_fees ? 'forwarder_recipient' and p_fees ? 'forwarder_phone' then
    update public.sales_orders set
      forwarder_recipient = nullif(btrim(p_fees->>'forwarder_recipient'), ''),
      forwarder_phone = nullif(btrim(p_fees->>'forwarder_phone'), '')
    where id = target.id returning * into result;
  end if;
  update public.quotes set
    shipping_cny = shipping_pair[1], shipping_cost = shipping_pair[2],
    last_balance_cny = balance[1], last_balance_amount = balance[2], last_balance_source = p_fees->'last_balance'->>'source',
    discount_cny = discount[1], discount_amount = discount[2], discount_source = p_fees->'discount'->>'source',
    other_charge_cny = other_fee[1], other_charge_amount = other_fee[2], other_charge_source = p_fees->'other'->>'source',
    paypal_fee_percent = rate_percent, paypal_fee_cny = fee_cny, paypal_fee_amount = fee_payment,
    total_cny = result.total_cny, total_amount = result.total_amount, amount = result.total_amount
  where id = target.quote_id;
  return result;
end $$;
revoke all on function public.apply_direct_pi_fees(uuid,jsonb) from public, anon, authenticated;
commit;


